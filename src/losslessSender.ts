// Transmit-side reconciler. There is ONE entry point, reconcileTransmission(),
// and it is idempotent: given refs.audioCodec + the current audio graph + the
// current peers, it brings everything into the matching state — the FLAC
// encoder pipeline up or down, each peer's Opus sender attached or detached,
// and each peer told (once) which codec to expect on its audio channel.
//
// Every trigger (codec dropdown, audio-enable/reload, peer connect, channel
// open, mute/volume/share change) calls reconcileTransmission() and nothing
// else. This replaces the previous scatter of start/stop/announce logic across
// call sites, where each new trigger or consumer was a chance to forget a step.
import { refs, type Peer } from './refs.ts';
import { PcmBlocker } from './pcmBlocker.ts';
import { encodeControl } from './audioProtocol.ts';
import { shouldSendOpus } from './transmission.ts';
import { saveAudioCodec } from './audioCodec.ts';
import type { FlacParams } from './flacCodec.ts';

export const STREAM_PARAMS: FlacParams = {
  sampleRate: 48000,
  channels: 2,
  blockSize: 4096,
};

type PipelineState = 'down' | 'starting' | 'up';
let pipeline: PipelineState = 'down';
let captureNode: AudioWorkletNode | null = null;
let captureSource: MediaStreamAudioSourceNode | null = null;
let encoderWorker: Worker | null = null;
let blocker: PcmBlocker | null = null;
// The FLAC STREAMINFO header (first frames emitted). Cached so peers whose
// channel opens mid-stream can start decoding.
let header: ArrayBuffer | null = null;
let captureModuleAdded = false;
// Resolves when the most recent pipeline bring-up (and any fallback) settles.
// Callers that need the effective codec afterwards (the UI) await this.
let pipelineStart: Promise<void> = Promise.resolve();
// What we last told each peer to expect on its audio channel, so 'start'/'stop'
// are sent once per transition rather than on every reconcile.
const announced = new Map<string, 'opus' | 'flac'>();

async function ensureCaptureModule(ctx: AudioContext) {
  if (captureModuleAdded) return;
  // Served from public/ as plain JS (see the worklet file for why).
  await ctx.audioWorklet.addModule(
    `${import.meta.env.BASE_URL}pcm-capture.worklet.js`
  );
  captureModuleAdded = true;
}

function broadcastFrame(bytes: ArrayBuffer) {
  for (const peer of refs.peers.values()) {
    if (peer.audioChannel?.readyState === 'open') peer.audioChannel.send(bytes);
  }
}

async function startPipeline(ctx: AudioContext): Promise<void> {
  pipeline = 'starting';
  header = null;
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
    // A module worker's load failure and any runtime crash surface here
    // (async — the try/catch can't see them). Without this, a dead worker
    // means Opus is detached but no FLAC frames flow: silent audio. Recover to
    // Opus instead.
    encoderWorker.onerror = (event) => {
      fallbackToOpus('FLAC encoder worker error', event.message);
    };
    encoderWorker.postMessage({ type: 'init', params: STREAM_PARAMS });

    captureSource = new MediaStreamAudioSourceNode(ctx, {
      mediaStream: refs.micDestination!.stream,
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
    pipeline = 'up';
  } catch (err) {
    // Couldn't start (e.g. worklet failed to load) — fall back to Opus so
    // audio still works, and record it so the UI reflects the real state.
    fallbackToOpus('Lossless pipeline failed to start', err);
    return; // fallbackToOpus already reconciled
  }
  // Apply the resulting state: detach Opus + announce FLAC on success.
  reconcileTransmission();
}

// Tear the FLAC pipeline down and revert to Opus, reconciling so the Opus
// uplink reattaches and peers are told to stop. Used for both startup failure
// and a runtime worker crash.
function fallbackToOpus(reason: string, detail?: unknown) {
  console.error(`${reason}, falling back to Opus`, detail);
  teardownPipeline();
  refs.audioCodec = 'opus';
  saveAudioCodec('opus');
  reconcileTransmission();
}

function teardownPipeline() {
  captureNode?.disconnect();
  captureSource?.disconnect();
  encoderWorker?.terminate();
  captureNode = null;
  captureSource = null;
  encoderWorker = null;
  blocker = null;
  header = null;
  pipeline = 'down';
}

function stopPipeline() {
  encoderWorker?.postMessage({ type: 'stop' });
  teardownPipeline();
}

function announceTo(peerId: string, peer: Peer, want: 'opus' | 'flac') {
  const channel = peer.audioChannel;
  if (channel?.readyState !== 'open') return;
  const last = announced.get(peerId);
  if (want === 'flac' && last !== 'flac') {
    channel.send(encodeControl({ lossless: 'start', params: STREAM_PARAMS }));
    if (header) channel.send(header.slice(0));
    announced.set(peerId, 'flac');
  } else if (want === 'opus' && last === 'flac') {
    channel.send(encodeControl({ lossless: 'stop' }));
    announced.set(peerId, 'opus');
  }
}

// The single idempotent reconcile. Safe to call any number of times.
export function reconcileTransmission(): void {
  const ctx = refs.audioContext;
  const graphReady = !!ctx && !!refs.micDestination;
  const wantFlac = refs.audioCodec === 'flac' && graphReady;

  // Bring the encoder pipeline toward the desired state. 'starting' is left
  // alone (a bring-up is in flight and re-runs reconcile when it settles).
  if (wantFlac && pipeline === 'down') {
    pipelineStart = startPipeline(ctx!);
  } else if (!wantFlac && pipeline === 'up') {
    stopPipeline();
  }

  const flacLive = refs.audioCodec === 'flac' && pipeline === 'up';
  const sendOpus = shouldSendOpus({
    codec: refs.audioCodec,
    flacPipelineUp: pipeline === 'up',
    micVolume: refs.micVolume,
    hasShare: refs.shareStream !== null,
    shareVolume: refs.shareVolume,
  });

  for (const [peerId, peer] of refs.peers) {
    const isAttached = peer.sender.track !== null;
    if (sendOpus !== isAttached) {
      peer.sender
        .replaceTrack(sendOpus ? refs.micTrack : null)
        .catch((err) => console.error(err));
    }
    announceTo(peerId, peer, flacLive ? 'flac' : 'opus');
  }
}

// Awaits any in-flight pipeline bring-up (including fallback). The UI awaits
// this after changing the codec, then reads refs.audioCodec for the result.
export function whenTransmissionSettled(): Promise<void> {
  return pipelineStart;
}

// Drop per-peer announce state when a peer leaves.
export function releaseTransmission(peerId: string): void {
  announced.delete(peerId);
}
