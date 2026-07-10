import { refs, type FileWritable, type IncomingTransfer } from '../rtc/refs.ts';

// Peer-to-peer file transfer over each pair's reliable, ordered `files`
// channel — PULL model. A file's existence is announced separately as a chat
// message; here we move only bytes, on demand:
//   receiver → {t:'request', msgId}
//   holder   → {t:'start', msgId}, <binary chunks...>, {t:'end', msgId}
//   holder   → {t:'unavailable', msgId}   (no such blob / it left)
// Sends to one peer are serialised through a per-peer queue (shared uplink);
// the 'start' marker tells the receiver which request the next chunks answer.

const CHUNK_SIZE = 16 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

const sendQueues = new Map<string, string[]>(); // peerId → msgIds to stream
const draining = new Set<string>();

function getSaveFilePicker() {
  return (
    window as unknown as {
      showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<{
        createWritable(): Promise<FileWritable>;
      }>;
    }
  ).showSaveFilePicker;
}

function openChannelTo(peerId: string): RTCDataChannel | undefined {
  const channel = refs.peers.get(peerId)?.fileChannel;
  return channel && channel.readyState === 'open' ? channel : undefined;
}

// --- Sender side ------------------------------------------------------------

export function holdFile(msgId: string, file: File): void {
  refs.heldFiles.set(msgId, { file });
}

async function streamOne(peerId: string, msgId: string) {
  const held = refs.heldFiles.get(msgId);
  const channel = openChannelTo(peerId);
  if (!channel) return;
  if (!held) {
    channel.send(JSON.stringify({ t: 'unavailable', msgId }));
    return;
  }
  channel.bufferedAmountLowThreshold = LOW_WATER;
  channel.send(JSON.stringify({ t: 'start', msgId }));
  const { file } = held;
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    if (channel.readyState !== 'open') return;
    if (channel.bufferedAmount > HIGH_WATER) {
      await new Promise<void>((resolve) =>
        channel.addEventListener('bufferedamountlow', () => resolve(), { once: true })
      );
    }
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    channel.send(chunk);
  }
  channel.send(JSON.stringify({ t: 'end', msgId }));
}

async function drain(peerId: string) {
  if (draining.has(peerId)) return;
  draining.add(peerId);
  try {
    const queue = sendQueues.get(peerId);
    while (queue && queue.length) {
      const msgId = queue.shift()!;
      await streamOne(peerId, msgId);
    }
  } finally {
    draining.delete(peerId);
  }
}

// --- Receiver side ----------------------------------------------------------

export async function requestFile(
  msgId: string,
  from: string,
  name: string,
  size: number,
  mime: string
): Promise<void> {
  const channel = openChannelTo(from);
  if (!channel) return;
  const transfer: IncomingTransfer = {
    msgId,
    from,
    name,
    size,
    mime,
    received: 0,
    chunks: [],
    status: 'idle',
  };
  // Open the save dialog inside the click's user activation (first await).
  const showSaveFilePicker = getSaveFilePicker();
  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: name });
      transfer.writable = await handle.createWritable();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user cancelled
      console.error(e);
      transfer.writable = null;
    }
  }
  refs.incomingTransfers.set(msgId, transfer);
  channel.send(JSON.stringify({ t: 'request', msgId }));
}

export function fileTransferState(msgId: string): IncomingTransfer | undefined {
  return refs.incomingTransfers.get(msgId);
}

function finalizeInMemory(transfer: IncomingTransfer) {
  if (transfer.received !== transfer.size) {
    transfer.chunks = [];
    transfer.status = 'failed';
    return;
  }
  const blob = new Blob(transfer.chunks, {
    type: transfer.mime || 'application/octet-stream',
  });
  transfer.chunks = [];
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = transfer.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  transfer.status = 'done';
}

export function abortTransfersFrom(peerId: string): void {
  const activeMsgId = refs.activeIncoming.get(peerId);
  refs.activeIncoming.delete(peerId);
  if (activeMsgId) {
    const active = refs.incomingTransfers.get(activeMsgId);
    if (active?.writable) {
      const writable = active.writable;
      (active.writeChain ?? Promise.resolve()).then(() => writable.abort()).catch(() => {});
    }
  }
  for (const transfer of refs.incomingTransfers.values()) {
    if (transfer.from === peerId && (transfer.status === 'receiving' || transfer.status === 'idle')) {
      if (transfer.writable) {
        const writable = transfer.writable;
        transfer.writeChain = (transfer.writeChain ?? Promise.resolve())
          .then(() => writable.abort())
          .catch(() => {});
      }
      transfer.status = 'unavailable';
    }
  }
}

// --- Protocol handler (both roles share the files channel) ------------------

export function handleFileMessage(fromPeerId: string, data: unknown): void {
  if (typeof data === 'string') {
    let msg: { t: string; msgId: string };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'request') {
      // Holder side: queue this blob for streaming to the requester.
      if (!refs.heldFiles.has(msg.msgId)) {
        openChannelTo(fromPeerId)?.send(
          JSON.stringify({ t: 'unavailable', msgId: msg.msgId })
        );
        return;
      }
      const queue = sendQueues.get(fromPeerId) ?? [];
      queue.push(msg.msgId);
      sendQueues.set(fromPeerId, queue);
      drain(fromPeerId);
    } else if (msg.t === 'start') {
      const transfer = refs.incomingTransfers.get(msg.msgId);
      if (transfer) {
        transfer.status = 'receiving';
        refs.activeIncoming.set(fromPeerId, msg.msgId);
      }
    } else if (msg.t === 'end') {
      const transfer = refs.incomingTransfers.get(msg.msgId);
      if (!transfer || transfer.status !== 'receiving') return;
      refs.activeIncoming.delete(fromPeerId);
      if (transfer.writable) {
        const writable = transfer.writable;
        const truncated = transfer.received !== transfer.size;
        transfer.writeChain = (transfer.writeChain ?? Promise.resolve())
          .then(() => (truncated ? writable.abort() : writable.close()))
          .then(() => {
            if (transfer.status !== 'failed') {
              transfer.status = truncated ? 'failed' : 'done';
            }
          })
          .catch((err) => {
            console.error(err);
            transfer.status = 'failed';
          });
      } else {
        finalizeInMemory(transfer);
      }
    } else if (msg.t === 'unavailable') {
      const transfer = refs.incomingTransfers.get(msg.msgId);
      if (transfer) transfer.status = 'unavailable';
    }
  } else if (data instanceof ArrayBuffer) {
    const msgId = refs.activeIncoming.get(fromPeerId);
    if (!msgId) return;
    const transfer = refs.incomingTransfers.get(msgId);
    if (!transfer || transfer.status !== 'receiving') return;
    transfer.received += data.byteLength;
    if (transfer.writable) {
      const writable = transfer.writable;
      transfer.writeChain = (transfer.writeChain ?? Promise.resolve())
        .then(() => writable.write(data))
        .catch((err) => {
          console.error(err);
          transfer.status = 'failed';
        });
    } else {
      transfer.chunks.push(data);
    }
  }
}
