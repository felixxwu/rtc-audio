import { firestore } from './firebase.ts';
import { joinRoom } from './room.ts';
import { Button } from './Button.tsx';
import { useState } from 'react';

export function CreateSession({ setId }: { setId: (id: string) => void }) {
  const [error, setError] = useState('');

  const handleCreateRoom = async () => {
    // Creating a room is just being its first peer; the same link works
    // identically for everyone who joins later.
    const roomId = firestore.collection('calls').doc().id;
    const joinError = await joinRoom(roomId, { create: true });
    if (joinError) {
      setError(joinError);
      return;
    }
    setId(roomId);
  };

  if (error) return <p>{error}</p>;

  return <Button onClick={handleCreateRoom}>Start New Session</Button>;
}
