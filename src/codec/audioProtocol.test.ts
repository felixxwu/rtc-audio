import { describe, it, expect } from 'vitest';
import { encodeControl, parseMessage } from './audioProtocol.ts';

describe('audioProtocol', () => {
  it('encodes and parses a start message', () => {
    const params = { sampleRate: 48000, channels: 2, blockSize: 4096 };
    const wire = encodeControl({ lossless: 'start', params });
    const parsed = parseMessage(wire);
    expect(parsed).toEqual({
      kind: 'control',
      message: { lossless: 'start', params },
    });
  });

  it('encodes and parses a stop message', () => {
    const parsed = parseMessage(encodeControl({ lossless: 'stop' }));
    expect(parsed).toEqual({ kind: 'control', message: { lossless: 'stop' } });
  });

  it('treats an ArrayBuffer as a frame', () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    expect(parseMessage(bytes)).toEqual({ kind: 'frame', bytes });
  });

  it('returns null for malformed JSON', () => {
    expect(parseMessage('{not json')).toBe(null);
  });

  it('returns null for a JSON object that is not a control message', () => {
    expect(parseMessage(JSON.stringify({ hello: 'world' }))).toBe(null);
  });
});
