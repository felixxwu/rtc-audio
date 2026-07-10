// Persisted choice of outbound audio codec. 'opus' is the default RTP path
// (unchanged legacy behavior); 'flac' streams lossless FLAC over a data
// channel. Transmit-only and unilateral. Mirrors the storage pattern of
// audioInput.ts / volumeStorage.ts.
export type AudioCodec = 'opus' | 'flac';

export const CODEC_KEY = 'rtc-audio:codec';

export function loadAudioCodec(): AudioCodec {
  try {
    return localStorage.getItem(CODEC_KEY) === 'flac' ? 'flac' : 'opus';
  } catch {
    return 'opus';
  }
}

export function saveAudioCodec(codec: AudioCodec): void {
  try {
    // Only persist the non-default choice; absence means 'opus'.
    if (codec === 'flac') localStorage.setItem(CODEC_KEY, 'flac');
    else localStorage.removeItem(CODEC_KEY);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}
