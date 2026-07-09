// Receive side: decode a peer's FLAC stream and route it through a
// prebuffering playback worklet into a MediaStream, which we swap onto that
// peer's existing <audio> element. Because playback still flows through
// <audio>, per-participant volume (entry.audio.volume) and the audio-reactive
// UI (audioLevels reads entry.audio.srcObject) keep working unchanged.
import { refs } from './refs.ts';
import { parseMessage, type StreamParams } from './audioProtocol.ts';
import { flacReady } from './flacLoader.ts';
import { FlacStreamDecoder } from './flacCodec.ts';

type Rx = {
  decoder: FlacStreamDecoder;
  node: AudioWorkletNode;
  dest: MediaStreamAudioDestinationNode;
};

const receivers = new Map<string, Rx>();
let moduleAdded = false;

async function ensurePlaybackModule(ctx: AudioContext) {
  if (moduleAdded) return;
  await ctx.audioWorklet.addModule(
    new URL('./pcm-playback.worklet.ts', import.meta.url)
  );
  moduleAdded = true;
}

async function start(peerId: string, params: StreamParams) {
  const ctx = refs.audioContext;
  const entry = refs.peers.get(peerId);
  if (!ctx || !entry) return;
  teardownReceiver(peerId); // idempotent restart

  await ensurePlaybackModule(ctx);
  const flac = await flacReady();
  const decoder = new FlacStreamDecoder(flac);

  const node = new AudioWorkletNode(ctx, 'pcm-playback', {
    outputChannelCount: [params.channels],
  });
  const prebufferSamples = Math.round(params.sampleRate * 0.2); // 200ms
  node.port.postMessage({
    config: {
      channels: params.channels,
      prebufferSamples,
      capacitySamples: params.sampleRate * 2, // 2s ceiling
    },
  });

  const dest = new MediaStreamAudioDestinationNode(ctx);
  node.connect(dest);
  // Wire the decoded stream onto the peer's <audio>; volume + metering follow.
  entry.audio.srcObject = dest.stream;

  receivers.set(peerId, { decoder, node, dest });
}

function pushFrame(peerId: string, bytes: ArrayBuffer) {
  const rx = receivers.get(peerId);
  if (!rx) return;
  const blocks = rx.decoder.decodeChunk(new Uint8Array(bytes));
  for (const perChannel of blocks) {
    // Int32 (16-bit range) -> Float32 [-1, 1) for the worklet.
    const channels = perChannel.map((chan) => {
      const f = new Float32Array(chan.length);
      for (let i = 0; i < chan.length; i++) f[i] = chan[i] / 32768;
      return f;
    });
    rx.node.port.postMessage({ channels });
  }
}

export function teardownReceiver(peerId: string): void {
  const rx = receivers.get(peerId);
  if (!rx) return;
  rx.node.disconnect();
  rx.dest.disconnect();
  rx.decoder.finish();
  receivers.delete(peerId);
  const entry = refs.peers.get(peerId);
  if (entry) entry.audio.srcObject = entry.rtpStream; // back to Opus
}

export function handleAudioMessage(peerId: string, data: unknown): void {
  const parsed = parseMessage(data);
  if (!parsed) return;
  if (parsed.kind === 'frame') {
    pushFrame(peerId, parsed.bytes);
  } else if (parsed.message.lossless === 'start') {
    start(peerId, parsed.message.params).catch((err) => console.error(err));
  } else {
    teardownReceiver(peerId);
  }
}
