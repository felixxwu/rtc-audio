import styled from 'styled-components';
import { letterFor } from './participants.ts';
import { circleColor } from './participantColor.ts';

// The letter disc shown for a participant with no video. Shared by the self
// box and the remote participant tiles so their shape/size stays in sync.
export function Avatar({ id }: { id: string }) {
  return <Circle style={{ background: circleColor(id) }}>{letterFor(id)}</Circle>;
}

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
