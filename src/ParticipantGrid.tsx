import { useEffect, useReducer } from 'react';
import styled from 'styled-components';
import { refs } from './refs.ts';
import { ParticipantBox } from './ParticipantBox.tsx';
import { InviteBox } from './InviteBox.tsx';
import { startColorLoop } from './colorLoop.ts';

export function ParticipantGrid({ link }: { link: string }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // Poll module state for structural changes (peers joining/leaving, a peer
  // starting/stopping a share). Colour is handled by the rAF loop, not here.
  useEffect(() => {
    startColorLoop();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, []);

  const peerIds = [...refs.peers.keys()];

  return (
    <Grid>
      {peerIds.map((id) => (
        <ParticipantBox key={id} id={id} />
      ))}
      <InviteBox link={link} />
    </Grid>
  );
}

const Grid = styled('div')`
  display: grid;
  /* Fixed-width cells so every box matches the self box. auto-fit collapses
     empty tracks so the actual boxes stay centred (auto-fill would pad the row
     with empties and push them left). */
  grid-template-columns: repeat(auto-fit, 280px);
  gap: 16px;
  width: 100%;
  padding: 0 16px;
  box-sizing: border-box;
  align-content: center;
  justify-content: center;
`;
