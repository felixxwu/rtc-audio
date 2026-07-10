import { useState } from 'react';
import styled from 'styled-components';
import { colors } from '../util/colors.ts';
import { Button } from './Button.tsx';

const DISMISS_KEY = 'rtc-audio:browser-notice-dismissed';

// The audio-sharing / streamed-download features need a Chromium browser.
// Treat Chrome, Edge, Brave, etc. as capable; Firefox and Safari get the
// notice.
function isChromium(): boolean {
  const uaData = (
    navigator as unknown as { userAgentData?: { brands?: { brand: string }[] } }
  ).userAgentData;
  if (uaData?.brands) {
    return uaData.brands.some((b) =>
      /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand)
    );
  }
  return 'chrome' in window;
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

// Shown once (until dismissed) when a non-Chromium user joins a session,
// explaining that app-audio sharing is the one thing they'll miss.
export function BrowserNotice() {
  const [open, setOpen] = useState(() => !isChromium() && !wasDismissed());
  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage unavailable — just close for this session.
    }
    setOpen(false);
  };

  return (
    <Backdrop onClick={dismiss}>
      <Dialog onClick={(e) => e.stopPropagation()}>
        <Title>Heads up — you're not on Chrome</Title>
        <p>
          Sharing audio from another app — a DAW, a music player — needs
          Chrome. On this browser you can share your screen's <b>video</b> but
          not its <b>sound</b>. This only matters when <b>you</b> are the one
          sharing; hearing audio that someone else shares works fine here.
        </p>
        <p>
          Everything else works normally: your microphone, hearing others,
          sharing screen video, pointers, and sending or receiving files.
          (Very large file transfers may be limited without Chrome.)
        </p>
        <Button onClick={dismiss}>Got it</Button>
      </Dialog>
    </Backdrop>
  );
}

const Backdrop = styled('div')`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
`;

const Dialog = styled('div')`
  background: ${colors.bg};
  border: 1px solid ${colors.accent};
  border-radius: 12px;
  padding: 24px;
  width: min(90vw, 440px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  line-height: 1.5;
`;

const Title = styled('div')`
  font-size: 1.15em;
  color: ${colors.accent2};
`;
