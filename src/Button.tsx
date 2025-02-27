import styled from 'styled-components';
import { colors } from './colors.ts';

export const Button = styled('button')`
  outline: none;
  padding: 10px 20px;
  border-radius: 100vw;
  border: none;
  background-color: ${colors.accent};
  color: ${colors.bg};
  cursor: pointer;

  &:hover {
    background-color: ${colors.accent2};
  }
`;
