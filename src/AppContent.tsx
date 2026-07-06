import { useEffect, useRef, useState } from 'react';
import { joinRoom } from './room.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { PlayingIcon } from './PlayingIcon.tsx';
import { VolumeControls } from './VolumeControls.tsx';
import { ShareAudioControls } from './ShareAudioControls.tsx';
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
      let worstLossPercent = 0;
      let worstJitterMs = 0;
      await Promise.all(
        peers.map(async (peer) => {
          // inbound-rtp audio counts codec payload only and is supported in
          // all browsers (unlike the transport stats type, missing in
          // Firefox).
          const stats = await peer.pc.getStats(null);
          const inboundAudio = [...stats.values()].find(
            (s) => s.type === 'inbound-rtp' && s.kind === 'audio'
          );
          if (!inboundAudio) return;

          const {
            bytesReceived,
            timestamp,
            packetsLost = 0,
            packetsReceived = 0,
            jitter = 0,
          } = inboundAudio;
          const elapsedMs = timestamp - peer.stats.ts;
          if (peer.stats.ts > 0 && elapsedMs > 0) {
            totalKbps += Math.max(
              0,
              Math.round(((bytesReceived - peer.stats.bytes) * 8) / elapsedMs)
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
            worstJitterMs = Math.max(worstJitterMs, Math.round(jitter * 1000));
          }
          peer.stats.bytes = bytesReceived;
          peer.stats.ts = timestamp;
          peer.stats.lost = packetsLost;
          peer.stats.received = packetsReceived;
        })
      );
      setBitrateKbps(totalKbps);
      setPacketLossPercent(worstLossPercent);
      setJitterMs(worstJitterMs);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      if (audioEnabled && paramId) {
        const sessionError = await joinRoom(paramId);
        setError(sessionError);
        setId(paramId);
      }
    })();
  }, [audioEnabled, paramId]);

  if (error) {
    return <p>{error}</p>;
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
          <p>
            Bitrate (incoming): {bitrateKbps} kb/s
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
