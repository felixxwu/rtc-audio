import { describe, it, expect } from 'vitest';
import { PcmBlocker } from './pcmBlocker.ts';

const quantum = (l: Float32Array, r: Float32Array) => [l, r];

describe('PcmBlocker', () => {
  it('emits nothing until a full block is buffered', () => {
    const b = new PcmBlocker(2, 4);
    const two = new Float32Array([0, 0]);
    expect(b.push(quantum(two, two))).toEqual([]);
  });

  it('emits a full interleaved block at the boundary', () => {
    const b = new PcmBlocker(2, 4);
    const l = new Float32Array([0.0, 0.5, -0.5, 1.0]);
    const r = new Float32Array([-1.0, 0.25, -0.25, 0.0]);
    const out = b.push(quantum(l, r));
    expect(out).toHaveLength(1);
    // Interleaved L,R,L,R,...; exact inverse of n/32768: 0.5 -> 16384,
    // 0.25 -> 8192, -1.0 -> -32768, +1.0 clamps to 32767.
    expect(Array.from(out[0])).toEqual([
      0, -32768, 16384, 8192, -16384, -8192, 32767, 0,
    ]);
  });

  it('splits a long input into multiple blocks and keeps the remainder', () => {
    const b = new PcmBlocker(1, 2);
    const six = new Float32Array([0, 0, 0, 0, 0, 0]);
    const out = b.push([six]);
    expect(out).toHaveLength(3);
    out.forEach((blk) => expect(blk).toHaveLength(2));
    expect(b.flush()).toBe(null);
  });

  it('flush returns the partial block then clears', () => {
    const b = new PcmBlocker(1, 4);
    b.push([new Float32Array([0, 0, 0])]);
    const rem = b.flush();
    expect(rem).not.toBe(null);
    expect(rem!).toHaveLength(3);
    expect(b.flush()).toBe(null);
  });
});
