import styled from 'styled-components';
import { colors } from '../util/colors.ts';
import { useState } from 'react';
import { refs } from '../rtc/refs.ts';
import { Button } from './Button.tsx';
import { micConstraints, saveInputDeviceId } from '../audio/audioInput.ts';
import { reconcileTransmission } from '../codec/losslessSender.ts';

export function EnableAudio({
  setAudioEnabled,
}: {
  setAudioEnabled: (enabled: boolean) => void;
}) {
  const [error, setError] = useState('');

  const handleEnableAudio = async () => {
    try {
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        throw new MicUnavailableError();
      }
      // Use the remembered input device (e.g. an interface loopback) if one
      // was chosen; otherwise the system default. Falls back to default if
      // the remembered device is no longer available.
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia(
          micConstraints(refs.inputDeviceId)
        );
      } catch (deviceError) {
        if (!refs.inputDeviceId) throw deviceError;
        // The remembered device is gone — clear it (and its persisted copy)
        // so we don't retry the dead device on every future reload.
        refs.inputDeviceId = '';
        saveInputDeviceId('');
        localStream = await navigator.mediaDevices.getUserMedia(
          micConstraints('')
        );
      }

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
      const source = refs.audioContext.createMediaStreamSource(localStream);
      source.connect(refs.micGainNode);
      refs.micGainNode.connect(micDestination);
      // Kept so the input device can be swapped later without renegotiation.
      refs.micStream = localStream;
      refs.micSource = source;

      // Local monitor path, muted by default.
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

      setAudioEnabled(true);
    } catch (e) {
      console.error(e);
      setError(friendlyMicError(e));
    }
  };

  if (error) {
    return (
      <PermissionDenied>
        {error}
        <Button onClick={handleEnableAudio}>Try again</Button>
      </PermissionDenied>
    );
  }

  return <Button onClick={handleEnableAudio}>Enable Audio</Button>;
}

// getUserMedia doesn't exist — insecure (http) context or an unsupported
// browser, since a secure context always exposes it.
class MicUnavailableError extends Error {
  constructor() {
    super('MicUnavailable');
    this.name = 'MicUnavailableError';
  }
}

// Turn a getUserMedia rejection into something a user can act on. The error
// name is a stable, spec-defined enum; the raw .message is browser-specific
// and too technical to show.
function friendlyMicError(e: unknown): string {
  const name = (e as Error).name;
  switch (name) {
    case 'MicUnavailableError':
    case 'NotSupportedError':
      return (
        "This browser can't access a microphone. Use a recent browser over " +
        'a secure (https) connection.'
      );
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        'Microphone access was blocked. Please allow microphone access in ' +
        'your browser settings and try again.'
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Please connect one and try again.';
    case 'NotReadableError':
      return (
        "Your microphone couldn't be started — it may be in use by another " +
        'app. Close anything else using it and try again.'
      );
    default:
      return "Couldn't enable audio. Please check your microphone and try again.";
  }
}

const PermissionDenied = styled('p')`
  color: ${colors.accent2};
`;
