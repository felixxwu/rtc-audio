import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAudioCodec, saveAudioCodec, CODEC_KEY } from './audioCodec.ts';

describe('audio codec persistence', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('defaults to opus when nothing is stored', () => {
    expect(loadAudioCodec()).toBe('opus');
  });

  it('round-trips flac', () => {
    saveAudioCodec('flac');
    expect(localStorage.getItem(CODEC_KEY)).toBe('flac');
    expect(loadAudioCodec()).toBe('flac');
  });

  it('round-trips opus (removes the key)', () => {
    saveAudioCodec('flac');
    saveAudioCodec('opus');
    expect(localStorage.getItem(CODEC_KEY)).toBe(null);
    expect(loadAudioCodec()).toBe('opus');
  });

  it('tolerates unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('nope');
      },
      setItem: () => {
        throw new Error('nope');
      },
      removeItem: () => {
        throw new Error('nope');
      },
    });
    expect(loadAudioCodec()).toBe('opus');
    expect(() => saveAudioCodec('flac')).not.toThrow();
  });
});
