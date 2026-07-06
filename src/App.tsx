import styled from 'styled-components';
import { colors } from './colors.ts';
import { GitHub, Icon } from './Icon.tsx';
import { AppContent } from './AppContent.tsx';

export default function App() {
  return (
    <Container>
      <AppContent />

      <GitHubWrapper
        href="https://github.com/felixxwu/rtc-audio"
        target="_blank"
      >
        <Icon path={GitHub} color={colors.accent2} size={24} />
      </GitHubWrapper>
    </Container>
  );
}

const Container = styled('div')`
  width: 100vw;
  height: 100svh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  align-items: center;
  background-color: ${colors.bg};
  color: ${colors.accent2};
  text-align: center;
`;

const GitHubWrapper = styled('a')`
  position: fixed;
  top: 0;
  right: 0;
  padding: 10px;
  cursor: pointer;
`;
