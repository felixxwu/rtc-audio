import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { colours } from './colours.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { joinSession } from './joinSession.ts';

export default function App() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [id, setId] = useState('');
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');
  console.log(`paramId`, paramId);

  useEffect(() => {
    (async () => {
      if (audioEnabled && paramId) {
        await joinSession(paramId);
        setId(paramId);
      }
    })();
  }, [audioEnabled, paramId]);

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
      <div>Invite others to join the session:</div>
      <Link>
        {window.location.origin}/?id=${id}
      </Link>
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
