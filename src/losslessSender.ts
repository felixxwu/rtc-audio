// Send side of lossless mode. Taps the same mixed node the RTP track uses
// (refs.micDestination), blocks the PCM, encodes to FLAC in a worker, and
// fans identical frames to every peer's audioChannel. Toggling silences the
// Opus track via replaceTrack(null) — no SDP renegotiation.
import { refs } from './refs.ts';
import { PcmBlocker } from './pcmBlocker.ts';
import { encodeControl } from './audioProtocol.ts';
import { updateTransmission } from './transmission.ts';
import type { FlacParams } from './flacCodec.ts';

export const STREAM_PARAMS: FlacParams = {
  sampleRate: 48000,
  channels: 2,
  blockSize: 4096,
};

let captureNode: AudioWorkletNode | null = null;
let captureSource: MediaStreamAudioSourceNode | null = null;
let encoderWorker: Worker | null = null;
let blocker: PcmBlocker | null = null;
// The FLAC STREAMINFO header (first frames emitted). Cached so late-joining
// peers can start decoding mid-stream.
let header: ArrayBuffer | null = null;
let moduleAdded = false;

async function ensureCaptureModule(ctx: AudioContext) {
  if (moduleAdded) return;
  // Served from public/ as plain JS (see the worklet file for why).
  await ctx.audioWorklet.addModule(
    `${import.meta.env.BASE_URL}pcm-capture.worklet.js`
  );
  moduleAdded = true;
}

function broadcastFrame(bytes: ArrayBuffer) {
  for (const peer of refs.peers.values()) {
    if (peer.audioChannel?.readyState === 'open') {
      peer.audioChannel.send(bytes);
    }
  }
}

function sendStart(channel: RTCDataChannel | undefined) {
  if (channel?.readyState !== 'open') return;
  channel.send(encodeControl({ lossless: 'start', params: STREAM_PARAMS }));
  if (header) channel.send(header.slice(0));
}

export async function startLossless(): Promise<void> {
  const ctx = refs.audioContext;
  // No audio graph yet (not in a session): just record the preference so the
  // stream starts once peers connect (onAudioChannelOpen). Nothing to roll
  // back, so it's safe to commit the codec here.
  if (!ctx || !refs.micDestination || captureNode) {
    refs.audioCodec = 'flac';
    return;
  }
  header = null;

  // Everything below can throw (worklet load, worker spawn, node creation).
  // Don't commit refs.audioCodec or detach Opus until it all succeeds, so a
  // failure leaves us cleanly on Opus rather than in a half-switched state.
  try {
    await ensureCaptureModule(ctx);
    blocker = new PcmBlocker(STREAM_PARAMS.channels, STREAM_PARAMS.blockSize);

    encoderWorker = new Worker(
      new URL('./flacEncoder.worker.ts', import.meta.url),
      { type: 'module' }
    );
    encoderWorker.onmessage = (
      e: MessageEvent<{ type: 'frames'; bytes: ArrayBuffer }>
    ) => {
      if (e.data.type !== 'frames') return;
      if (!header) header = e.data.bytes.slice(0); // first output carries STREAMINFO
      broadcastFrame(e.data.bytes);
    };
    encoderWorker.postMessage({ type: 'init', params: STREAM_PARAMS });

    captureSource = new MediaStreamAudioSourceNode(ctx, {
      mediaStream: refs.micDestination.stream,
    });
    captureNode = new AudioWorkletNode(ctx, 'pcm-capture');
    captureNode.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
      if (!blocker || !encoderWorker) return;
      for (const block of blocker.push(e.data)) {
        encoderWorker.postMessage({ type: 'block', block }, [block.buffer]);
      }
    };
    captureSource.connect(captureNode);
    // Keep the node pulled by the graph. The capture processor never writes to
    // its outputs, so this connection emits silence (no local echo).
    captureNode.connect(ctx.destination);
  } catch (err) {
    // Roll back any partial setup and stay on Opus.
    captureNode?.disconnect();
    captureSource?.disconnect();
    encoderWorker?.terminate();
    captureNode = null;
    captureSource = null;
    encoderWorker = null;
    blocker = null;
    header = null;
    throw err;
  }

  // Commit: switch the codec, detach the Opus uplink for every peer
  // (updateTransmission keeps it detached while the codec is 'flac'), and
  // announce the FLAC stream.
  refs.audioCodec = 'flac';
  updateTransmission();
  for (const peer of refs.peers.values()) {
    sendStart(peer.audioChannel);
  }
}

export function stopLossless(): void {
  refs.audioCodec = 'opus';
  captureNode?.disconnect();
  captureSource?.disconnect();
  captureNode = null;
  captureSource = null;
  blocker = null;
  header = null;
  if (encoderWorker) {
    encoderWorker.postMessage({ type: 'stop' });
    encoderWorker.terminate();
    encoderWorker = null;
  }
  // Restore the Opus uplink (respecting current mute/volume state) and tell
  // each peer to stop expecting FLAC.
  updateTransmission();
  for (const peer of refs.peers.values()) {
    if (peer.audioChannel?.readyState === 'open') {
      peer.audioChannel.send(encodeControl({ lossless: 'stop' }));
    }
  }
}

// A peer whose channel opens while we're already streaming (late joiner) needs
// the header + start before frames make sense.
export function onAudioChannelOpen(peerId: string): void {
  if (refs.audioCodec !== 'flac') return;
  const peer = refs.peers.get(peerId);
  if (!peer) return;
  peer.sender.replaceTrack(null).catch((err) => console.error(err));
  sendStart(peer.audioChannel);
}
