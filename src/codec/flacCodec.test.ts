import { describe, it, expect } from 'vitest';
import LibFlacFactory from 'libflacjs';
import {
  type FlacModule,
  FlacStreamEncoder,
  FlacStreamDecoder,
} from './flacCodec.ts';

// Node loads the module via the package factory (asm.js variant). The browser
// build uses flacLoader.ts instead; both feed the same Encoder/Decoder here.
function flacReady(): Promise<FlacModule> {
  return new Promise((resolve) => {
    const flac = LibFlacFactory();
    if (flac.isReady()) resolve(flac);
    else flac.on('ready', () => resolve(flac));
  });
}

describe('FLAC round-trip is lossless', () => {
  it('decodes encoded PCM back bit-identically (16-bit stereo)', async () => {
    const flac = await flacReady();
    const params = { sampleRate: 48000, channels: 2, blockSize: 4096 };

    // Deterministic pseudo-signal: two channels of a saw + offset, in 16-bit range.
    const totalFrames = 4096 * 3;
    const source: number[] = [];
    for (let i = 0; i < totalFrames; i++) {
      source.push(((i * 7) % 65536) - 32768); // L
      source.push(((i * 13) % 65536) - 32768); // R
    }

    const enc = new FlacStreamEncoder(flac, params);
    const chunks: Uint8Array[] = [];
    for (let off = 0; off < source.length; off += params.blockSize * 2) {
      const block = Int32Array.from(source.slice(off, off + params.blockSize * 2));
      const out = enc.encodeBlock(block);
      if (out.length) chunks.push(out);
    }
    const tail = enc.finish();
    if (tail.length) chunks.push(tail);

    const dec = new FlacStreamDecoder(flac);
    const decodedL: number[] = [];
    const decodedR: number[] = [];
    const collect = (blocks: Int32Array[][]) => {
      for (const perChannel of blocks) {
        decodedL.push(...Array.from(perChannel[0]));
        decodedR.push(...Array.from(perChannel[1]));
      }
    };
    chunks.forEach((c) => collect(dec.decodeChunk(c)));
    collect(dec.finish());

    // Interleave decoded output and compare to source.
    const decoded: number[] = [];
    for (let i = 0; i < decodedL.length; i++) {
      decoded.push(decodedL[i], decodedR[i]);
    }
    expect(decoded.length).toBe(source.length);
    expect(decoded).toEqual(source);
  });
});
