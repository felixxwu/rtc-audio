import styled from 'styled-components';
import { colours } from './colours.ts';

export function PlayingIcon() {
  return (
    <Bars>
      <Bar />
      <Bar />
      <Bar />
    </Bars>
  );
}

const Bars = styled('div')`
  position: relative;
  display: flex;
  justify-content: space-between;
  width: 20px;
  height: 20px;
`;

const Bar = styled('span')`
  width: 6px;
  height: 100%;
  background-color: ${colours.accent2};
  border-radius: 5px;
  transform-origin: bottom;
  animation: bounce 1.9s ease-in infinite;
  content: '';

  &:nth-of-type(2) {
    animation: bounce 1.7s ease-in infinite;
  }

  &:nth-of-type(3) {
    animation: bounce 2.3s ease-in infinite;
  }

  @keyframes bounce {
    0% {
      transform: scaleY(0);
    }
    5% {
      transform: scaleY(0.7);
    }
    40% {
      transform: scaleY(0.35);
    }
    45% {
      transform: scaleY(1);
    }
    100% {
      transform: scaleY(0);
    }
  }
`;
