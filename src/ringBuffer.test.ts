import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ringBuffer.ts';

describe('RingBuffer', () => {
  it('reads back what was written, in order', () => {
    const r = new RingBuffer(8);
    r.write(new Float32Array([1, 2, 3]));
    expect(r.available()).toBe(3);
    const out = new Float32Array(3);
    expect(r.read(out)).toBe(3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(r.available()).toBe(0);
  });

  it('wraps around the capacity', () => {
    const r = new RingBuffer(4);
    r.write(new Float32Array([1, 2, 3]));
    const out = new Float32Array(2);
    r.read(out); // consumes 1,2
    r.write(new Float32Array([4, 5])); // wraps
    const out2 = new Float32Array(3);
    expect(r.read(out2)).toBe(3);
    expect(Array.from(out2)).toEqual([3, 4, 5]);
  });

  it('reports a partial read on underrun without touching the tail', () => {
    const r = new RingBuffer(8);
    r.write(new Float32Array([9]));
    const out = new Float32Array([0, 0, 0]);
    expect(r.read(out)).toBe(1);
    expect(Array.from(out)).toEqual([9, 0, 0]);
  });

  it('drops oldest samples on overflow', () => {
    const r = new RingBuffer(4);
    r.write(new Float32Array([1, 2, 3, 4, 5, 6])); // 1,2 dropped
    expect(r.available()).toBe(4);
    const out = new Float32Array(4);
    r.read(out);
    expect(Array.from(out)).toEqual([3, 4, 5, 6]);
  });
});
