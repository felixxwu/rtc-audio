import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { joinRoom } from './room.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { StreamViewer } from './StreamViewer.tsx';
import { BrowserNotice } from './BrowserNotice.tsx';
import { ParticipantGrid } from './ParticipantGrid.tsx';
import { SelfBox } from './SelfBox.tsx';
import type { Stats } from './SettingsPopup.tsx';
import styled from 'styled-components';
import { ChatPanel } from './ChatPanel.tsx';
import { subscribeChat, getMessages } from './chat.ts';
import { sampleStats } from './stats.ts';
import { notifyRoom } from './roomStore.ts';
import { myPeerId } from './identity.ts';

export function AppContent({
  chatOpen,
  setChatOpen,
}: {
  chatOpen: boolean;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [stats, setStats] = useState<Stats>({
    bitrateKbps: 0,
    outgoingKbps: [],
    totalInKbps: 0,
    totalOutKbps: 0,
    packetLossPercent: 0,
    jitterMs: 0,
  });
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');

  useEffect(() => {
    const interval = setInterval(async () => {
      setStats(await sampleStats());
      // sampleStats also refreshed each peer.stats (per-tile bitrate); nudge
      // the room subscribers so the participant tiles re-render with them.
      notifyRoom();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      // The !id guard stops a second join: creating a session puts the new
      // id into the URL (so the creator can rejoin after a reload), which
      // makes paramId appear without a page load.
      if (audioEnabled && paramId && !id) {
        const sessionError = await joinRoom(paramId);
        setError(sessionError);
        setId(paramId);
      }
    })();
  }, [audioEnabled, paramId, id]);

  useEffect(() => {
    let lastCount = getMessages().length;
    const unsub = subscribeChat(() => {
      const messages = getMessages();
      const count = messages.length;
      // The store also notifies on typing pings, which don't change the count;
      // skip the slice/filter work when nothing was appended.
      if (count === lastCount) return;
      const added = messages
        .slice(lastCount)
        .filter((m) => m.kind !== 'system' && m.senderId !== myPeerId).length;
      lastCount = count;
      if (added > 0 && !chatOpen) setUnread((u) => u + added);
    });
    return unsub;
  }, [chatOpen]);

  useEffect(() => {
    const updateTitle = () => {
      document.title =
        unread > 0 && document.hidden ? `(${unread}) rtc-audio` : 'rtc-audio';
    };
    updateTitle();
    document.addEventListener('visibilitychange', updateTitle);
    return () => document.removeEventListener('visibilitychange', updateTitle);
  }, [unread]);

  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  if (error) {
    return (
      <>
        <p>{error}</p>
        <CreateSession
          setId={(newId) => {
            setError('');
            setId(newId);
          }}
        />
      </>
    );
  }

  if (!audioEnabled) {
    return <EnableAudio setAudioEnabled={setAudioEnabled} />;
  }

  if (!id) {
    return <CreateSession setId={setId} />;
  }

  const link = `${window.location.origin}/?id=${id}`;

  return (
    <>
      <BrowserNotice />
      <Session>
        <Main>
          <GridArea>
            <ParticipantGrid link={link} />
          </GridArea>
          {chatOpen && (
            <ChatSlot>
              <ChatPanel onClose={() => setChatOpen(false)} />
            </ChatSlot>
          )}
        </Main>
        <Dock>
          <SelfBox
            stats={stats}
            onToggleChat={() => setChatOpen((o) => !o)}
            chatUnread={unread}
          />
        </Dock>
      </Session>
      <StreamViewer />
    </>
  );
}

// Full-height column: grid area flexes to fill, the dock is pinned at the
// bottom as its own visually distinct (darker) section.
const Session = styled('div')`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
`;

const Main = styled('div')`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  position: relative;
`;

const GridArea = styled('div')`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
`;

// Desktop: fixed-width side panel beside the grid. Mobile (<700px): fills the
// grid area full-width (covering the participants) but stays above the dock,
// which lives below Main in the Session column.
const ChatSlot = styled('div')`
  width: 500px;
  flex-shrink: 0;
  min-height: 0;

  @media (max-width: 700px) {
    position: absolute;
    inset: 0;
    width: auto;
    z-index: 40;
  }
`;

const Dock = styled('div')`
  flex-shrink: 0;
  background: #181818;
  border-top: 1px solid #000;
  padding: 16px 12px;
  display: flex;
  justify-content: center;
`;
