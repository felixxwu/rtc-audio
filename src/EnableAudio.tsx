import styled from 'styled-components';
import { colors } from './colors.ts';
import { useState } from 'react';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';
import { micConstraints } from './audioInput.ts';
import { saveAudioCodec } from './audioCodec.ts';
import { startLossless } from './losslessSender.ts';

export function EnableAudio({
  setAudioEnabled,
}: {
  setAudioEnabled: (enabled: boolean) => void;
}) {
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');

  const handleEnableAudio = async () => {
    try {
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
        refs.inputDeviceId = '';
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

      // If lossless was the saved codec, bring up the FLAC encode pipeline now
      // that the audio graph exists — otherwise a reload into FLAC would have
      // Opus detached but nothing encoding (silent). Fall back to Opus if the
      // pipeline can't start (e.g. worklet load failure) so audio still works.
      if (refs.audioCodec === 'flac') {
        try {
          await startLossless();
        } catch (losslessError) {
          console.error(
            'Lossless init failed, falling back to Opus',
            losslessError
          );
          refs.audioCodec = 'opus';
          saveAudioCodec('opus');
        }
      }

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
