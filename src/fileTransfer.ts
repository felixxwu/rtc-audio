import {
  refs,
  type FileWritable,
  type IncomingFile,
  type OutgoingFile,
} from './refs.ts';

// File System Access API, if the browser has it (Chromium). Looked up at
// call time (cast rather than rely on lib types). When absent we fall back
// to buffering in memory.
function getSaveFilePicker() {
  return (
    window as unknown as {
      showSaveFilePicker?: (opts?: {
        suggestedName?: string;
      }) => Promise<{ createWritable(): Promise<FileWritable> }>;
    }
  ).showSaveFilePicker;
}

// Peer-to-peer file transfer over each pair's reliable, ordered data
// channel. Protocol (JSON control strings + binary chunks on the same
// channel):
//   sender → {t:'offer', id, name, size, mime}
//   receiver → {t:'accept'|'reject', id}
//   sender → {t:'start', id}, <binary chunks...>, {t:'end', id}
//
// Multiple files can be offered and accepted at once. Sends to a single peer
// are serialised through a per-peer queue (they share one uplink, so there's
// no speed gain in interleaving); the 'start' marker tells the receiver which
// accepted transfer the next run of chunks belongs to. Transfers to/from
// different peers proceed concurrently on their own channels.

const CHUNK_SIZE = 16 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

let nextId = 0;
// Monotonic local ordering for the newest-first file list (shared across
// incoming and outgoing so the combined list sorts correctly).
let seqCounter = 0;

// Per-peer send queue of accepted transferIds, and the set of peers whose
// queue is currently being drained.
const sendQueues = new Map<string, string[]>();
const draining = new Set<string>();

const keyOf = (from: string, id: string) => `${from}:${id}`;

function openChannelTo(peerId: string): RTCDataChannel | undefined {
  const channel = refs.peers.get(peerId)?.fileChannel;
  return channel && channel.readyState === 'open' ? channel : undefined;
}

// Sender: offer one or more files to every connected peer.
export function sendFilesToAll(files: File[]) {
  for (const file of files) {
    const id = String(nextId++);
    const outgoing: OutgoingFile = {
      id,
      name: file.name,
      size: file.size,
      file,
      perPeer: new Map(),
      seq: seqCounter++,
    };
    let offered = 0;
    for (const [peerId] of refs.peers) {
      const channel = openChannelTo(peerId);
      if (!channel) continue;
      outgoing.perPeer.set(peerId, { status: 'offered', sent: 0 });
      channel.send(
        JSON.stringify({
          t: 'offer',
          id,
          name: file.name,
          size: file.size,
          mime: file.type,
        })
      );
      offered++;
    }
    if (offered > 0) refs.outgoingFiles.set(id, outgoing);
  }
}

// Re-offer still-tracked outgoing files to a peer whose file channel just
// opened — i.e. someone who joined after the offer was made. Skips peers
// already offered (so it doesn't double-send to the original recipients).
export function reofferTo(peerId: string) {
  const channel = openChannelTo(peerId);
  if (!channel) return;
  for (const outgoing of refs.outgoingFiles.values()) {
    if (outgoing.perPeer.has(peerId)) continue;
    outgoing.perPeer.set(peerId, { status: 'offered', sent: 0 });
    channel.send(
      JSON.stringify({
        t: 'offer',
        id: outgoing.id,
        name: outgoing.name,
        size: outgoing.size,
        mime: outgoing.file.type,
      })
    );
  }
}

export async function acceptIncoming(key: string) {
  const incoming = refs.incomingFiles.get(key);
  if (!incoming || incoming.status !== 'offered') return;
  // Open the save dialog to stream to disk. This MUST run inside the click's
  // user activation, so it's the first thing awaited. If the browser lacks
  // the API we fall through to the in-memory path.
  const showSaveFilePicker = getSaveFilePicker();
  if (showSaveFilePicker) {
    try {
      const handle = await showSaveFilePicker({ suggestedName: incoming.name });
      incoming.writable = await handle.createWritable();
    } catch (e) {
      // User dismissed the save dialog — leave the offer standing, don't
      // accept. Any other error falls back to in-memory buffering.
      if ((e as Error).name === 'AbortError') return;
      console.error(e);
      incoming.writable = null;
    }
  }
  incoming.status = 'accepted';
  openChannelTo(incoming.from)?.send(
    JSON.stringify({ t: 'accept', id: incoming.id })
  );
}

// The sender left: abort any in-progress write and drop all files that peer
// offered us (files persist in the list until their host disconnects).
export function peerDisconnected(peerId: string) {
  const activeKey = refs.activeIncoming.get(peerId);
  refs.activeIncoming.delete(peerId);
  if (activeKey) {
    const active = refs.incomingFiles.get(activeKey);
    if (active?.writable) {
      const writable = active.writable;
      (active.writeChain ?? Promise.resolve())
        .then(() => writable.abort())
        .catch(() => {});
    }
  }
  for (const [key, incoming] of refs.incomingFiles) {
    if (incoming.from === peerId) refs.incomingFiles.delete(key);
  }
}

// In-memory fallback: assemble the buffered chunks into a Blob and download.
function finalize(incoming: IncomingFile) {
  const blob = new Blob(incoming.chunks, {
    type: incoming.mime || 'application/octet-stream',
  });
  incoming.chunks = []; // release the assembled buffers
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = incoming.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  incoming.status = 'done';
  refs.activeIncoming.delete(incoming.from);
}

async function streamOne(peerId: string, outgoing: OutgoingFile) {
  const state = outgoing.perPeer.get(peerId);
  const channel = openChannelTo(peerId);
  if (!state) return;
  if (!channel) {
    state.status = 'failed';
    return;
  }
  state.status = 'sending';
  channel.bufferedAmountLowThreshold = LOW_WATER;
  channel.send(JSON.stringify({ t: 'start', id: outgoing.id }));
  for (let offset = 0; offset < outgoing.size; offset += CHUNK_SIZE) {
    if (channel.readyState !== 'open') {
      state.status = 'failed';
      return;
    }
    if (channel.bufferedAmount > HIGH_WATER) {
      await new Promise<void>((resolve) =>
        channel.addEventListener('bufferedamountlow', () => resolve(), {
          once: true,
        })
      );
    }
    const chunk = await outgoing.file
      .slice(offset, offset + CHUNK_SIZE)
      .arrayBuffer();
    channel.send(chunk);
    state.sent = Math.min(outgoing.size, offset + chunk.byteLength);
  }
  channel.send(JSON.stringify({ t: 'end', id: outgoing.id }));
  state.status = 'done';
}

// Drain a peer's accepted-transfer queue one file at a time.
async function drain(peerId: string) {
  if (draining.has(peerId)) return;
  draining.add(peerId);
  try {
    const queue = sendQueues.get(peerId);
    while (queue && queue.length) {
      const id = queue.shift()!;
      const outgoing = refs.outgoingFiles.get(id);
      if (outgoing) await streamOne(peerId, outgoing);
    }
  } finally {
    draining.delete(peerId);
  }
}

export function handleFileMessage(fromPeerId: string, data: unknown) {
  if (typeof data === 'string') {
    let msg: { t: string; id: string; name?: string; size?: number; mime?: string };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'offer') {
      refs.incomingFiles.set(keyOf(fromPeerId, msg.id), {
        from: fromPeerId,
        id: msg.id,
        name: msg.name ?? 'file',
        size: msg.size ?? 0,
        mime: msg.mime ?? '',
        received: 0,
        chunks: [],
        status: 'offered',
        seq: seqCounter++,
      });
    } else if (msg.t === 'accept') {
      const outgoing = refs.outgoingFiles.get(msg.id);
      const state = outgoing?.perPeer.get(fromPeerId);
      if (outgoing && state && state.status === 'offered') {
        state.status = 'queued';
        const queue = sendQueues.get(fromPeerId) ?? [];
        queue.push(msg.id);
        sendQueues.set(fromPeerId, queue);
        drain(fromPeerId);
      }
    } else if (msg.t === 'start') {
      const incoming = refs.incomingFiles.get(keyOf(fromPeerId, msg.id));
      if (incoming) {
        incoming.status = 'receiving';
        refs.activeIncoming.set(fromPeerId, keyOf(fromPeerId, msg.id));
      }
    } else if (msg.t === 'end') {
      const incoming = refs.incomingFiles.get(keyOf(fromPeerId, msg.id));
      if (!incoming || incoming.status !== 'receiving') return;
      refs.activeIncoming.delete(fromPeerId);
      if (incoming.writable) {
        // Flush the ordered write chain, then close the file on disk.
        const writable = incoming.writable;
        incoming.writeChain = (incoming.writeChain ?? Promise.resolve())
          .then(() => writable.close())
          .then(() => {
            incoming.status = 'done';
          })
          .catch((err) => {
            console.error(err);
            incoming.status = 'failed';
          });
      } else {
        finalize(incoming);
      }
    }
  } else if (data instanceof ArrayBuffer) {
    const key = refs.activeIncoming.get(fromPeerId);
    if (!key) return;
    const incoming = refs.incomingFiles.get(key);
    if (!incoming || incoming.status !== 'receiving') return;
    incoming.received += data.byteLength;
    if (incoming.writable) {
      // Chain disk writes so they land in arrival order even though each
      // onmessage handler is async. Keeps receiver memory flat.
      const writable = incoming.writable;
      incoming.writeChain = (incoming.writeChain ?? Promise.resolve())
        .then(() => writable.write(data))
        .catch((err) => console.error(err));
    } else {
      incoming.chunks.push(data);
    }
  }
}
