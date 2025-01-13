import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { colours } from './colours.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { joinSession } from './joinSession.ts';
import { pc } from './pc.ts';
import { PlayingIcon } from './PlayingIcon.tsx';

export default function App() {
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
    return (
      <Container>
        <p>{error}</p>
      </Container>
    );
  }

  if (!audioEnabled) {
    return (
      <Container>
        <EnableAudio setAudioEnabled={setAudioEnabled} />
      </Container>
    );
  }

  if (!id) {
    return (
      <Container>
        <CreateSession setId={setId} />
      </Container>
    );
  }

  return (
    <Container>
      {connectionState === 'connected' && <PlayingIcon />}
      <p>
        {connectionState === 'connected'
          ? 'You are connected.'
          : `Session ${connectionState}`}
      </p>
      {!paramId && connectionState === 'new' && (
        <>
          <div>Invite someone to join the session:</div>
          <Link>
            {window.location.origin}/?id={id}
          </Link>
        </>
      )}
    </Container>
  );
}

const Container = styled('div')`
  width: 100vw;
  height: 100svh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  align-items: center;
  background-color: ${colours.bg};
  color: ${colours.accent2};
`;

const Link = styled('div')`
  color: ${colours.accent2};
  text-decoration: underline;
  cursor: pointer;
  user-select: all;
`;
