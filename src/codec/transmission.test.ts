import { describe, it, expect } from 'vitest';
import { shouldSendOpus, type TransmissionInputs } from './transmission.ts';

const base: TransmissionInputs = {
  codec: 'opus',
  flacPipelineUp: false,
  micVolume: 1,
  hasShare: false,
  shareVolume: 1,
};

describe('shouldSendOpus', () => {
  it('sends on Opus with an unmuted mic', () => {
    expect(shouldSendOpus(base)).toBe(true);
  });

  it('does not send on Opus when mic is muted and there is no share', () => {
    expect(shouldSendOpus({ ...base, micVolume: 0 })).toBe(false);
  });

  it('sends on Opus for an audible share even with the mic muted', () => {
    expect(
      shouldSendOpus({ ...base, micVolume: 0, hasShare: true, shareVolume: 1 })
    ).toBe(true);
  });

  it('does not send a muted share', () => {
    expect(
      shouldSendOpus({ ...base, micVolume: 0, hasShare: true, shareVolume: 0 })
    ).toBe(false);
  });

  it('stops Opus once the FLAC pipeline is live (no double-send)', () => {
    expect(
      shouldSendOpus({ ...base, codec: 'flac', flacPipelineUp: true })
    ).toBe(false);
  });

  it('keeps Opus while FLAC is selected but not yet live (no audio gap)', () => {
    expect(
      shouldSendOpus({ ...base, codec: 'flac', flacPipelineUp: false })
    ).toBe(true);
  });
});
