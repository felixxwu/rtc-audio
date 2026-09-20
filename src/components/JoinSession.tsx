import { useState } from 'react';
import { initAudio } from '../audio/audioSetup.ts';
import { Button } from './Button.tsx';

// Shown to someone opening a shared link. The click doubles as the user
// gesture the browser requires before audio can play.
export function JoinSession({ onJoin }: { onJoin: () => void }) {
  const [error, setError] = useState('');

  const handleJoin = () => {
    try {
      initAudio();
      onJoin();
    } catch (e) {
      console.error(e);
      setError("Couldn't start audio. Please try again.");
    }
  };

  return (
    <>
      {error && <p>{error}</p>}
      <Button onClick={handleJoin}>Join Session</Button>
    </>
  );
}
