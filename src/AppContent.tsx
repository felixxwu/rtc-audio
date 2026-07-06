import { useEffect, useRef, useState } from 'react';
import { joinRoom } from './room.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { PlayingIcon } from './PlayingIcon.tsx';
import { VolumeControls } from './VolumeControls.tsx';
import { ShareAudioControls } from './ShareAudioControls.tsx';
import { StreamViewer } from './StreamViewer.tsx';
import { FileControls } from './FileControls.tsx';
import { BrowserNotice } from './BrowserNotice.tsx';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';

export function AppContent() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [connectedCount, setConnectedCount] = useState(0);
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [outgoingKbps, setOutgoingKbps] = useState<number[]>([]);
  const [totalInKbps, setTotalInKbps] = useState(0);
  const [totalOutKbps, setTotalOutKbps] = useState(0);
  const [packetLossPercent, setPacketLossPercent] = useState(0);
  const [jitterMs, setJitterMs] = useState(0);
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [copyLinkButtonText, setCopyLinkButtonText] = useState('Copy link');

  useEffect(() => {
    const interval = setInterval(async () => {
      const peers = [...refs.peers.values()];
      setConnectedCount(
        peers.filter((peer) => peer.pc.connectionState === 'connected').length
      );

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
          // Both data channels (cursors + files) summed; cursor traffic is
          // negligible next to a transfer.
          let dataBytesReceived = 0;
          let dataBytesSent = 0;
          for (const s of values) {
            if (s.type === 'data-channel') {
              dataBytesReceived += s.bytesReceived ?? 0;
              dataBytesSent += s.bytesSent ?? 0;
            }
          }
          if (!inboundAudio && !outboundAudio) return;

          const timestamp = (inboundAudio ?? outboundAudio).timestamp;
          const elapsedMs = timestamp - peer.stats.ts;
          if (peer.stats.ts > 0 && elapsedMs > 0) {
            if (inboundAudio) {
              const {
                bytesReceived,
                packetsLost = 0,
                packetsReceived = 0,
                jitter = 0,
              } = inboundAudio;
              totalKbps += Math.max(
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
            if (outboundAudio) {
              outgoing.push(
                Math.max(
                  0,
                  Math.round(
                    ((outboundAudio.bytesSent - peer.stats.bytesSent) * 8) /
                      elapsedMs
                  )
                )
              );
            }
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

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);

      clearTimeout(timeoutRef.current);
      setCopyLinkButtonText('Link copied');
      timeoutRef.current = setTimeout(() => {
        setCopyLinkButtonText('Copy link');
      }, 2000);
    } catch (e) {
      console.error(e);

      clearTimeout(timeoutRef.current);
      setCopyLinkButtonText('Failed to copy');
      timeoutRef.current = setTimeout(() => {
        setCopyLinkButtonText('Copy link');
      }, 2000);
    }
  };

  return (
    <>
      <BrowserNotice />
      {connectedCount > 0 && <PlayingIcon />}
      <p>
        {connectedCount === 0
          ? 'Waiting for others to join...'
          : `Connected to ${connectedCount} peer${
              connectedCount === 1 ? '' : 's'
            }.`}
      </p>
      <div>Invite someone to join the session:</div>
      <Link>{link}</Link>
      <p>
        <Button onClick={handleCopyLink}>{copyLinkButtonText}</Button>
      </p>
      {connectedCount > 0 && (
        <>
          <VolumeControls />
          <ShareAudioControls />
          <StreamViewer />
          <FileControls />
          <p>
            Audio ↓ {bitrateKbps} ↑{' '}
            {outgoingKbps.reduce((sum, kbps) => sum + kbps, 0)}
            {outgoingKbps.length > 1 && ` (${outgoingKbps.join(' + ')})`} kb/s
            <br />
            Total ↓ {totalInKbps} ↑ {totalOutKbps} kb/s
            <br />
            Packet loss: {packetLossPercent}% | Jitter: {jitterMs} ms
          </p>
        </>
      )}
    </>
  );
}

const Link = styled('div')`
  color: ${colors.accent2};
  text-decoration: underline;
  cursor: pointer;
  user-select: all;
`;
