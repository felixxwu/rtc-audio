import { joinRoom } from '../rtc/room.ts';
import { initAudio } from '../audio/audioSetup.ts';
import { Button } from './Button.tsx';
import { useState, type FormEvent } from 'react';
import styled, { keyframes } from 'styled-components';
import { colors } from '../util/colors.ts';

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

const JoinForm = styled('form')`
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
`;

const CodeInput = styled('input')`
  width: 9em;
  padding: 10px 16px;
  background: #111;
  border: 1px solid ${colors.border};
  border-radius: 100vw;
  color: ${colors.accent2};
  font: inherit;
  text-align: center;
  text-transform: uppercase;
  outline: none;
  &:focus {
    border-color: ${colors.accent};
  }
  &::placeholder {
    color: ${colors.border};
    text-transform: none;
  }
`;

// 6 chars of A-Z0-9 (~2 billion codes); joins are case-insensitive.
const newRoomId = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 36]
  ).join('');

export function CreateSession({ setId }: { setId: (id: string) => void }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [joinCode, setJoinCode] = useState('');

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
    const roomId = newRoomId();
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

  // Manual route: navigate to the shared-link URL, which shows the usual
  // "Join Session" click-through. Also accepts a pasted full link.
  const handleJoinCode = (e: FormEvent) => {
    e.preventDefault();
    const code = (joinCode.match(/id=([^&#\s]+)/i)?.[1] ?? joinCode).trim();
    if (code)
      window.location.href = `/?id=${encodeURIComponent(code.toUpperCase())}`;
  };

  return (
    <>
      <JoinForm onSubmit={handleJoinCode}>
        <CodeInput
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Room code"
          aria-label="Room code"
        />
        <Button type="submit" disabled={!joinCode.trim()}>
          Join
        </Button>
      </JoinForm>
      <Button onClick={handleCreateRoom} disabled={loading}>
        {loading && <Spinner />}
        Start New Session
      </Button>
    </>
  );
}
