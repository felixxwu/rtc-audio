import { firestore } from '../rtc/firebase.ts';
import { joinRoom } from '../rtc/room.ts';
import { initAudio } from '../audio/audioSetup.ts';
import { Button } from './Button.tsx';
import { useState } from 'react';
import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const Spinner = styled('span')`
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 8px;
  vertical-align: -0.15em;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

export function CreateSession({ setId }: { setId: (id: string) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreateRoom = async () => {
    // Creating a room is just being its first peer; the same link works
    // identically for everyone who joins later.
    if (loading) return;
    setLoading(true);
    try {
      initAudio();
    } catch (e) {
      console.error(e);
      setLoading(false);
      setError("Couldn't start audio. Please try again.");
      return;
    }
    const roomId = firestore.collection('calls').doc().id;
    const joinError = await joinRoom(roomId, { create: true });
    if (joinError) {
      setLoading(false);
      setError(joinError);
      return;
    }
    // Put the room in the URL so a reload (or crash) lands the creator back
    // in their own room instead of losing the id.
    history.replaceState(null, '', `/?id=${roomId}`);
    setId(roomId);
  };

  if (error) return <p>{error}</p>;

  return (
    <Button onClick={handleCreateRoom} disabled={loading}>
      {loading && <Spinner />}
      Start New Session
    </Button>
  );
}
