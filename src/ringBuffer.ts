// Single-channel float ring buffer for playback. Overflow drops the oldest
// samples (a huge backlog means the sender ran away — better to skip forward
// than grow latency unbounded); underrun reads leave the unfilled tail of the
// output untouched so the caller can zero-fill (silence).
export class RingBuffer {
  private data: Float32Array;
  private head = 0; // next read
  private size = 0; // queued samples

  constructor(private capacity: number) {
    this.data = new Float32Array(capacity);
  }

  available(): number {
    return this.size;
  }

  write(input: Float32Array): void {
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

  read(out: Float32Array): number {
    const n = Math.min(out.length, this.size);
    for (let i = 0; i < n; i++) {
      out[i] = this.data[this.head];
      this.head = (this.head + 1) % this.capacity;
    }
    this.size -= n;
    return n;
  }
}
