import { refs } from '../rtc/refs.ts';
import { reconcileTransmission } from '../codec/losslessSender.ts';

// Build the audio graph. Must run from a user gesture (the click that starts or
// joins a session) so the browser lets the AudioContext run. Idempotent.
export function initAudio() {
  if (refs.audioContext) return;
  refs.audioContext = new AudioContext({
    latencyHint: 'playback',
    sampleRate: 48000,
  });
  refs.gainNode = refs.audioContext.createGain();

  // Route the mic through a gain node so its level can be adjusted; the
  // gain-adjusted stream is what gets sent to every peer. Shared
  // tab/window audio mixes into the same destination, so all outgoing
  // audio is one track — no renegotiation when a share starts or stops.
  refs.micGainNode = refs.audioContext.createGain();
  const micDestination = refs.audioContext.createMediaStreamDestination();
  refs.micDestination = micDestination;
  refs.micGainNode.connect(micDestination);
  // The mic itself isn't opened yet — the browser's permission prompt is
  // deferred until the user first unmutes (see ensureMic). Until then the
  // outgoing track is silent, and we start muted.

  // Local monitor path, muted by default.
  refs.micGainNode.gain.value = refs.micVolume;
  refs.micGainNode.connect(refs.gainNode);
  refs.gainNode.connect(refs.audioContext.destination);
  refs.gainNode.gain.value = 0;

  // Tell the encoder this is music, not speech — prioritises fidelity
  // over intelligibility and avoids speech-tuned processing. The same
  // track is added to every peer connection by the room factory.
  const track = micDestination.stream.getAudioTracks()[0];
  track.contentHint = 'music';
  refs.micTrack = track;

  // Bring the transmit path in line with the saved codec now that the
  // audio graph exists. If FLAC was saved this starts its pipeline (with an
  // internal Opus fallback if it can't); otherwise it's a no-op until peers
  // connect. Reload-into-FLAC would otherwise leave Opus detached with
  // nothing encoding (silent).
  reconcileTransmission();
}
