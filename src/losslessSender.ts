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
  await ctx.audioWorklet.addModule(
    new URL('./pcm-capture.worklet.ts', import.meta.url)
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
  refs.audioCodec = 'flac';
  const ctx = refs.audioContext;
  if (!ctx || !refs.micDestination || captureNode) return;
  header = null;

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

  // Detach the Opus uplink for every peer (updateTransmission keeps it
  // detached while the codec is 'flac'), then announce the FLAC stream.
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
