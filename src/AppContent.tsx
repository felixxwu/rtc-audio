import { useEffect, useState } from 'react';
import { pc } from './pc.ts';
import { joinSession } from './joinSession.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { PlayingIcon } from './PlayingIcon.tsx';
import { VolumeControls } from './VolumeControls.tsx';
import styled from 'styled-components';
import { colors } from './colors.ts';

export function AppContent() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');

  useEffect(() => {
    setInterval(() => {
      setConnectionState(pc.connectionState);
    }, 1000);
  }, []);

  useEffect(() => {
    (async () => {
      if (audioEnabled && paramId) {
        const sessionError = await joinSession(paramId);
        setError(sessionError);
        setId(paramId);
      }
    })();
  }, [audioEnabled, paramId]);

  if (error) {
    return <p>{error}</p>;
  }

  if (!audioEnabled) {
    return <EnableAudio setAudioEnabled={setAudioEnabled} />;
  }

  if (!id) {
    return <CreateSession setId={setId} />;
  }

  const sessionState: Partial<Record<RTCPeerConnectionState, string>> = {
    new: 'Waiting for connection...',
    connected: 'You are connected.',
  };

  return (
    <>
      {connectionState === 'connected' && <PlayingIcon />}
      <p>{sessionState[connectionState] ?? `Session ${connectionState}`}</p>
      {!paramId && connectionState === 'new' && (
        <>
          <div>Invite someone to join the session:</div>
          <Link>
            {window.location.origin}/?id={id}
          </Link>
        </>
      )}
      {connectionState === 'connected' && <VolumeControls />}
    </>
  );
}

const Link = styled('div')`
  color: ${colors.accent2};
  text-decoration: underline;
  cursor: pointer;
  user-select: all;
`;
