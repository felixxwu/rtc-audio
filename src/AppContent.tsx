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
import { refs } from './refs.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { subscribeChat, getMessages } from './chat.ts';
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
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [outgoingKbps, setOutgoingKbps] = useState<number[]>([]);
  const [totalInKbps, setTotalInKbps] = useState(0);
  const [totalOutKbps, setTotalOutKbps] = useState(0);
  const [packetLossPercent, setPacketLossPercent] = useState(0);
  const [jitterMs, setJitterMs] = useState(0);
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');

  useEffect(() => {
    const interval = setInterval(async () => {
      const peers = [...refs.peers.values()];

      // Aggregate stats: bitrate is summed across peers; loss and jitter
      // report the worst pair. Deltas are computed per-pc from the report's
      // own timestamps — setInterval drifts and background tabs are
      // throttled, so an assumed 1s interval spikes.
      let totalKbps = 0;
      const outgoing: number[] = [];
      let videoInKbps = 0;
      let videoOutKbps = 0;
      let dataInKbps = 0;
      let dataOutKbps = 0;
      let worstLossPercent = 0;
      let worstJitterMs = 0;
      await Promise.all(
        peers.map(async (peer) => {
          // inbound-rtp/outbound-rtp audio count codec payload only and are
          // supported in all browsers (unlike the transport stats type,
          // missing in Firefox). Video (screen share) is the same stat with
          // kind 'video'. File transfer runs on the data channels, reported
          // separately under 'data-channel' — summed here so Total reflects
          // everything on the wire (payload level, excluding protocol
          // overhead).
          const stats = await peer.pc.getStats(null);
          const values = [...stats.values()];
          const inboundAudio = values.find(
            (s) => s.type === 'inbound-rtp' && s.kind === 'audio'
          );
          const outboundAudio = values.find(
            (s) => s.type === 'outbound-rtp' && s.kind === 'audio'
          );
          const inboundVideo = values.find(
            (s) => s.type === 'inbound-rtp' && s.kind === 'video'
          );
          const outboundVideo = values.find(
            (s) => s.type === 'outbound-rtp' && s.kind === 'video'
          );
          // Data channels summed by purpose. The 'audio' channel carries the
          // lossless FLAC stream, so its bytes are attributed to audio (below)
          // rather than to data; cursors + files stay in the data bucket.
          let dataBytesReceived = 0;
          let dataBytesSent = 0;
          let audioDataReceived = 0;
          let audioDataSent = 0;
          for (const s of values) {
            if (s.type === 'data-channel') {
              if (s.label === 'audio') {
                audioDataReceived += s.bytesReceived ?? 0;
                audioDataSent += s.bytesSent ?? 0;
              } else {
                dataBytesReceived += s.bytesReceived ?? 0;
                dataBytesSent += s.bytesSent ?? 0;
              }
            }
          }
          // Skip only if there's no audio at all on any transport (RTP or the
          // FLAC data channel). On FLAC the RTP audio stats may be absent.
          const hasAudioChannel = audioDataReceived > 0 || audioDataSent > 0;
          if (!inboundAudio && !outboundAudio && !hasAudioChannel) return;

          const timestamp = (inboundAudio ?? outboundAudio ?? values[0])
            ?.timestamp;
          if (timestamp === undefined) return;
          const elapsedMs = timestamp - peer.stats.ts;
          if (peer.stats.ts > 0 && elapsedMs > 0) {
            // Per-peer audio downlink = Opus RTP in + FLAC data-channel in.
            let peerInKbps = 0;
            if (inboundAudio) {
              const {
                bytesReceived,
                packetsLost = 0,
                packetsReceived = 0,
                jitter = 0,
              } = inboundAudio;
              peerInKbps += Math.max(
                0,
                Math.round(
                  ((bytesReceived - peer.stats.bytes) * 8) / elapsedMs
                )
              );
              const newLost = Math.max(0, packetsLost - peer.stats.lost);
              const newReceived = packetsReceived - peer.stats.received;
              const newTotal = newLost + newReceived;
              if (newTotal > 0) {
                worstLossPercent = Math.max(
                  worstLossPercent,
                  Math.round((newLost / newTotal) * 100)
                );
              }
              worstJitterMs = Math.max(
                worstJitterMs,
                Math.round(jitter * 1000)
              );
            }
            // FLAC audio arrives on the 'audio' data channel — count it as
            // audio-in alongside any Opus RTP audio.
            peerInKbps += Math.max(
              0,
              Math.round(
                ((audioDataReceived - peer.stats.audioDataBytes) * 8) /
                  elapsedMs
              )
            );
            totalKbps += peerInKbps;
            // Per-peer audio uplink = Opus RTP out + FLAC data-channel out
            // (only one is non-zero, depending on the active codec).
            const rtpOutKbps = outboundAudio
              ? Math.max(
                  0,
                  Math.round(
                    ((outboundAudio.bytesSent - peer.stats.bytesSent) * 8) /
                      elapsedMs
                  )
                )
              : 0;
            const flacOutKbps = Math.max(
              0,
              Math.round(
                ((audioDataSent - peer.stats.audioDataBytesSent) * 8) /
                  elapsedMs
              )
            );
            const peerOutKbps = rtpOutKbps + flacOutKbps;
            outgoing.push(peerOutKbps);
            // Expose per-peer audio rates for the participant tiles.
            peer.stats.inKbps = peerInKbps;
            peer.stats.outKbps = peerOutKbps;
            if (inboundVideo) {
              videoInKbps += Math.max(
                0,
                Math.round(
                  ((inboundVideo.bytesReceived - peer.stats.videoBytes) * 8) /
                    elapsedMs
                )
              );
            }
            if (outboundVideo) {
              videoOutKbps += Math.max(
                0,
                Math.round(
                  ((outboundVideo.bytesSent - peer.stats.videoBytesSent) * 8) /
                    elapsedMs
                )
              );
            }
            dataInKbps += Math.max(
              0,
              Math.round(
                ((dataBytesReceived - peer.stats.dataBytes) * 8) / elapsedMs
              )
            );
            dataOutKbps += Math.max(
              0,
              Math.round(
                ((dataBytesSent - peer.stats.dataBytesSent) * 8) / elapsedMs
              )
            );
          }
          peer.stats.ts = timestamp;
          if (inboundAudio) {
            peer.stats.bytes = inboundAudio.bytesReceived;
            peer.stats.lost = inboundAudio.packetsLost ?? 0;
            peer.stats.received = inboundAudio.packetsReceived ?? 0;
          }
          if (outboundAudio) {
            peer.stats.bytesSent = outboundAudio.bytesSent;
          }
          if (inboundVideo) peer.stats.videoBytes = inboundVideo.bytesReceived;
          if (outboundVideo) {
            peer.stats.videoBytesSent = outboundVideo.bytesSent;
          }
          peer.stats.dataBytes = dataBytesReceived;
          peer.stats.dataBytesSent = dataBytesSent;
          peer.stats.audioDataBytes = audioDataReceived;
          peer.stats.audioDataBytesSent = audioDataSent;
        })
      );
      setBitrateKbps(totalKbps);
      setOutgoingKbps(outgoing);
      setTotalInKbps(totalKbps + videoInKbps + dataInKbps);
      setTotalOutKbps(
        outgoing.reduce((sum, kbps) => sum + kbps, 0) +
          videoOutKbps +
          dataOutKbps
      );
      setPacketLossPercent(worstLossPercent);
      setJitterMs(worstJitterMs);
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

  const stats: Stats = {
    bitrateKbps,
    outgoingKbps,
    totalInKbps,
    totalOutKbps,
    packetLossPercent,
    jitterMs,
  };

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

// Desktop: fixed-width side panel. Mobile (<700px): full-screen overlay above
// the dock.
const ChatSlot = styled('div')`
  width: 500px;
  flex-shrink: 0;
  min-height: 0;

  @media (max-width: 700px) {
    position: fixed;
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
