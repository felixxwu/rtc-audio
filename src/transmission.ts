// Pure decision for whether the Opus/RTP sender should be transmitting. The
// Opus track carries audio only while we're actually on Opus — i.e. NOT once
// the FLAC pipeline is live (that would double-send). While FLAC is selected
// but its pipeline hasn't come up yet, Opus keeps sending so there's no audio
// gap during the handover. Otherwise Opus sends whenever something audible
// exists (mic unmuted, or a share with volume).
//
// Kept side-effect-free so the reconciler (losslessSender) applies it and it
// stays unit-testable.
export type TransmissionInputs = {
  codec: 'opus' | 'flac';
  flacPipelineUp: boolean;
  micVolume: number;
  hasShare: boolean;
  shareVolume: number;
};

export function shouldSendOpus(s: TransmissionInputs): boolean {
  if (s.codec === 'flac' && s.flacPipelineUp) return false;
  return s.micVolume > 0 || (s.hasShare && s.shareVolume > 0);
}
