import styled from 'styled-components';
import { colors } from '../util/colors.ts';

export const Button = styled('button')`
  outline: none;
  padding: 10px 20px;
  border-radius: 100vw;
  border: none;
  background-color: ${colors.border};
  color: #fff;
  cursor: pointer;

  &:hover {
    background-color: #949494;
  }
`;
