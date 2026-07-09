import { refs } from './refs.ts';

// Level source key for our own (post-mute) mic signal.
export const SELF = '__self__';

type Meter = {
  analyser: AnalyserNode;
  data: Float32Array;
  // The stream this analyser is tapping. A peer's srcObject is swapped when it
  // switches codec (Opus RTP stream <-> FLAC playback stream), so the meter
  // must be rebuilt when this no longer matches the current srcObject.
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
};
const meters = new Map<string, Meter>();

function streamFor(id: string): MediaStream | null {
  if (id === SELF) return refs.micDestination?.stream ?? null;
  const src = refs.peers.get(id)?.audio.srcObject;
  return src instanceof MediaStream ? src : null;
}

// Lazily build the analyser once the stream exists (peer streams arrive on
// ontrack, after the box first renders). Rebuilt if the peer's srcObject is
// later swapped (codec switch) so the meter keeps tracking the live stream.
// Not connected to destination — the audio already plays through the peer's
// <audio> element.
function ensureMeter(id: string): Meter | null {
  const ctx = refs.audioContext;
  const stream = streamFor(id);
  if (!ctx || !stream || stream.getAudioTracks().length === 0) return null;
  const existing = meters.get(id);
  if (existing && existing.stream === stream) return existing;
  // Stream changed (or first build): tear down any stale source and rebuild.
  existing?.source.disconnect();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  const meter = {
    analyser,
    data: new Float32Array(analyser.fftSize),
    stream,
    source,
  };
  meters.set(id, meter);
  return meter;
}

// Peak absolute amplitude this instant, 0..1. Peak (not RMS) so transients
// read immediately, matching the "very reactionary" requirement.
export function levelFor(id: string): number {
  const meter = ensureMeter(id);
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.data);
  let peak = 0;
  for (let i = 0; i < meter.data.length; i++) {
    const v = Math.abs(meter.data[i]);
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

export function releaseMeter(id: string): void {
  meters.delete(id);
}
