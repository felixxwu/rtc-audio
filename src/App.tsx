import { useState } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { GitHub, Icon } from './Icon.tsx';
import { AppContent } from './AppContent.tsx';
import { sendFiles } from './chat.ts';

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Dropping files anywhere in the app shares them; the chat opens so the
  // drop lands somewhere visible.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) {
      sendFiles(files);
      setChatOpen(true);
    }
  };

  return (
    <Container
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer leaves the app entirely (not on the
        // flicker as it crosses child elements).
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node))
          return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <AppContent chatOpen={chatOpen} setChatOpen={setChatOpen} />

      {!chatOpen && (
        <GitHubWrapper
          href="https://github.com/felixxwu/rtc-audio"
          target="_blank"
        >
          <Icon path={GitHub} color={colors.accent2} size={24} />
        </GitHubWrapper>
      )}

      {dragging && <DropOverlay>Drop files to share</DropOverlay>}
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

// Full-screen affordance shown while dragging files over the app. Transparent
// to pointer events so it never interferes with the underlying drag tracking.
const DropOverlay = styled('div')`
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  border: 3px dashed ${colors.accent};
  color: ${colors.accent2};
  font-size: 1.4rem;
`;

const GitHubWrapper = styled('a')`
  position: fixed;
  top: 0;
  right: 0;
  padding: 10px;
  cursor: pointer;
`;
