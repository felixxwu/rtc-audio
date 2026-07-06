import styled from 'styled-components';
import { colors } from './colors.ts';
import { useState } from 'react';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';

export function EnableAudio({
  setAudioEnabled,
}: {
  setAudioEnabled: (enabled: boolean) => void;
}) {
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');

  const handleEnableAudio = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          autoGainControl: false,
          channelCount: {
            ideal: 2,
          },
          echoCancellation: false,
          noiseSuppression: false,
          // Not in TS lib types yet; where supported, stops the browser
          // applying voice-focused processing that hurts music.
          ...{ voiceIsolation: false },
          // Match Opus's native 48kHz so nothing gets resampled on the way
          // to the encoder.
          sampleRate: 48000,
          sampleSize: 16,
        },
      });

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

      setAudioEnabled(true);
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
      setPermissionDenied(true);
    }
  };

  if (permissionDenied) {
    return (
      <PermissionDenied>
        Permission denied. Please enable audio in your browser settings.
        {error}
      </PermissionDenied>
    );
  }

  return <Button onClick={handleEnableAudio}>Enable Audio</Button>;
}

const PermissionDenied = styled('p')`
  color: ${colors.accent2};
`;
