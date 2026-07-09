// AudioWorklet processor, served as a static asset (see losslessReceiver.ts).
// Plain JS on purpose: worklets load as a single standalone script with no
// module resolution, so RingBuffer is inlined here rather than imported. The
// canonical implementation and its unit tests live in src/ringBuffer.ts; keep
// the two in sync.
//
// Buffers decoded PCM per channel and plays it out, starting only once
// `prebufferSamples` have queued (jitter cushion) and emitting silence on
// underrun. Overflow drops the oldest samples.
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.head = 0;
    this.size = 0;
  }

  available() {
    return this.size;
  }

  write(input) {
    for (let i = 0; i < input.length; i++) {
      const tail = (this.head + this.size) % this.capacity;
      this.data[tail] = input[i];
      if (this.size === this.capacity) {
        this.head = (this.head + 1) % this.capacity; // overwrite oldest
      } else {
        this.size++;
      }
    }
  }

  read(out) {
    const n = Math.min(out.length, this.size);
    for (let i = 0; i < n; i++) {
      out[i] = this.data[this.head];
      this.head = (this.head + 1) % this.capacity;
    }
    this.size -= n;
    return n;
  }
}

class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rings = [];
    this.prebuffer = 0;
    this.started = false;
    this.port.onmessage = (event) => {
      const data = event.data;
      if ('config' in data) {
        this.prebuffer = data.config.prebufferSamples;
        this.rings = Array.from(
          { length: data.config.channels },
          () => new RingBuffer(data.config.capacitySamples)
        );
        this.started = false;
      } else if ('channels' in data && this.rings.length) {
        data.channels.forEach((chan, i) => {
          if (this.rings[i]) this.rings[i].write(chan);
        });
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!this.rings.length) return true; // not configured yet -> silence
    if (!this.started) {
      if (this.rings[0].available() < this.prebuffer) return true; // wait
      this.started = true;
    }
    output.forEach((channelOut, c) => {
      const read = this.rings[c] ? this.rings[c].read(channelOut) : 0;
      for (let i = read; i < channelOut.length; i++) channelOut[i] = 0; // underrun
    });
    return true;
  }
}

registerProcessor('pcm-playback', PcmPlaybackProcessor);
