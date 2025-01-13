import { pc } from './pc.ts';
import styled from 'styled-components';
import { colours } from './colours.ts';
import { useState } from 'react';

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

      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = remoteStream;

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
  background-color: ${colours.accent};
  color: ${colours.bg};
  cursor: pointer;

  &:hover {
    background-color: ${colours.accent2};
  }
`;

const PermissionDenied = styled('p')`
  color: ${colours.accent2};
`;
