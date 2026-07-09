// Accumulates fixed-size interleaved integer blocks from the variable-length
// Float32 quanta an AudioWorklet delivers. Output is Int32Array (values in
// signed 16-bit range) interleaved as L,R,L,R... — the shape libflacjs's
// Encoder wants for bitsPerSample: 16.
function toInt16(sample: number): number {
  // Exact inverse of Web Audio's int16 -> float mapping (n/32768): round back
  // by 32768 and clamp to the int16 range. This makes the round-trip
  // bit-transparent for genuine 16-bit sources at unity gain (a digital null
  // test yields silence), which an asymmetric ×32767 mapping would not.
  const scaled = Math.round(sample * 32768);
  return scaled < -32768 ? -32768 : scaled > 32767 ? 32767 : scaled;
}

export class PcmBlocker {
  private buf: number[] = [];
  private readonly frame: number;

  constructor(
    private channels: number,
    blockSize: number
  ) {
    this.frame = blockSize * channels;
  }

  push(quantum: Float32Array[]): Int32Array[] {
    const frames = quantum[0]?.length ?? 0;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < this.channels; c++) {
        this.buf.push(toInt16(quantum[c][i]));
      }
    }
    const blocks: Int32Array[] = [];
    while (this.buf.length >= this.frame) {
      blocks.push(Int32Array.from(this.buf.splice(0, this.frame)));
    }
    return blocks;
  }

  flush(): Int32Array | null {
    if (this.buf.length === 0) return null;
    const out = Int32Array.from(this.buf);
    this.buf = [];
    return out;
  }
}
