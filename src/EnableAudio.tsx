import { pc } from './pc.ts';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { useState } from 'react';
import { refs } from './refs.ts';

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
          sampleRate: 44100,
          sampleSize: 16,
        },
      });

      refs.audioContext = new AudioContext({
        latencyHint: 'playback',
        sampleRate: 44100,
      });
      refs.gainNode = refs.audioContext.createGain();

      const source = refs.audioContext.createMediaStreamSource(localStream);
      source.connect(refs.gainNode);
      refs.gainNode.connect(refs.audioContext.destination);
      refs.gainNode.gain.value = 0;

      const remoteStream = new MediaStream();

      // Push tracks from local stream to peer connection
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Pull tracks from remote stream, add to video stream
      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
      };

      refs.audio.autoplay = true;
      refs.audio.srcObject = remoteStream;

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

const Button = styled('button')`
  outline: none;
  padding: 10px 20px;
  border-radius: 100vw;
  border: none;
  background-color: ${colors.accent};
  color: ${colors.bg};
  cursor: pointer;

  &:hover {
    background-color: ${colors.accent2};
  }
`;

const PermissionDenied = styled('p')`
  color: ${colors.accent2};
`;
