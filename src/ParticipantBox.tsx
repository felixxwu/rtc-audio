import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { refs } from './refs.ts';
import { setWatching } from './room.ts';
import { letterFor } from './participants.ts';
import { circleColor } from './participantColor.ts';
import { registerBox, unregisterBox } from './colorLoop.ts';
import { requestView } from './viewerControl.ts';

export function ParticipantBox({ id }: { id: string }) {
  // Show the thumbnail as soon as the peer is sharing — we don't wait for the
  // stream to have arrived, because we request it (below) precisely because
  // they're sharing.
  const sharing = refs.sharingPeers.has(id);
  const borderRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Register the border with the colour loop (only the border reacts).
  useEffect(() => {
    if (!borderRef.current) return;
    registerBox(id, { colorId: id, levelId: id, border: borderRef.current });
    return () => unregisterBox(id);
  }, [id]);

  // Request the peer's shared screen the moment they start sharing, so the
  // low-quality thumbnail populates straight away rather than only after
  // someone opens the full view. Stop asking when they stop / the box unmounts.
  useEffect(() => {
    if (!sharing) return;
    setWatching(id, true);
    return () => setWatching(id, false);
  }, [id, sharing]);

  // Feed the thumbnail from the peer's shared-screen stream. Runs on every
  // render (the grid re-renders on a poll) so it attaches once the stream
  // arrives after the watch request above.
  useEffect(() => {
    const v = videoRef.current;
    const stream = refs.peers.get(id)?.videoStream ?? null;
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play().catch(() => {});
    }
  });

  return (
    <Box
      ref={borderRef}
      onClick={sharing ? () => requestView('watch') : undefined}
      $clickable={sharing}
    >
      {sharing ? (
        <Thumb ref={videoRef} autoPlay playsInline muted />
      ) : (
        <Circle style={{ background: circleColor(id) }}>{letterFor(id)}</Circle>
      )}
    </Box>
  );
}

const Box = styled('div')<{ $clickable?: boolean }>`
  aspect-ratio: 1.5 / 1;
  border: 3px solid #888;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #1a1a1a;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
`;

const Circle = styled('div')`
  height: 48%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 600;
  color: #111;
`;

const Thumb = styled('video')`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;
