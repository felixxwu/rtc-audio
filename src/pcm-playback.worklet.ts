/// <reference lib="dom" />
// Runs on the audio render thread. Buffers decoded PCM per channel and plays
// it out, starting only once `prebufferSamples` have queued (jitter cushion)
// and emitting silence on underrun. Overflow drops oldest (see RingBuffer).
import { RingBuffer } from './ringBuffer.ts';

declare const registerProcessor: (name: string, ctor: unknown) => void;
declare const AudioWorkletProcessor: {
  new (): { readonly port: MessagePort };
};

type ConfigMsg = {
  config: { channels: number; prebufferSamples: number; capacitySamples: number };
};
type DataMsg = { channels: Float32Array[] };

class PcmPlaybackProcessor extends AudioWorkletProcessor {
  private rings: RingBuffer[] = [];
  private prebuffer = 0;
  private started = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ConfigMsg | DataMsg>) => {
      const data = event.data;
      if ('config' in data) {
        this.prebuffer = data.config.prebufferSamples;
        this.rings = Array.from(
          { length: data.config.channels },
          () => new RingBuffer(data.config.capacitySamples)
        );
        this.started = false;
      } else if ('channels' in data && this.rings.length) {
        data.channels.forEach((chan, i) => this.rings[i]?.write(chan));
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!this.rings.length) return true; // not configured yet -> silence
    if (!this.started) {
      if (this.rings[0].available() < this.prebuffer) return true; // wait
      this.started = true;
    }
    output.forEach((channelOut, c) => {
      const read = this.rings[c]?.read(channelOut) ?? 0;
      for (let i = read; i < channelOut.length; i++) channelOut[i] = 0; // underrun
    });
    return true;
  }
}

registerProcessor('pcm-playback', PcmPlaybackProcessor);
