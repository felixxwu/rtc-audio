import { useEffect, useRef, useState } from 'react';
import { pc } from './pc.ts';
import { joinSession } from './joinSession.ts';
import { EnableAudio } from './EnableAudio.tsx';
import { CreateSession } from './CreateSession.tsx';
import { PlayingIcon } from './PlayingIcon.tsx';
import { VolumeControls } from './VolumeControls.tsx';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';

export function AppContent() {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');
  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [packetLossPercent, setPacketLossPercent] = useState(0);
  const [jitterMs, setJitterMs] = useState(0);
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [copyLinkButtonText, setCopyLinkButtonText] = useState('Copy link');

  useEffect(() => {
    const interval = setInterval(() => {
      setConnectionState(pc.connectionState);
      pc.getStats(null).then((stats) => {
        // inbound-rtp audio counts codec payload only and is supported in all
        // browsers (unlike the transport stats type, missing in Firefox).
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
        // Compute over the report's own timestamps — setInterval drifts and
        // background tabs are throttled, so an assumed 1s interval spikes.
        const elapsedMs = timestamp - refs.lastStatsTimestamp;
        if (refs.lastStatsTimestamp > 0 && elapsedMs > 0) {
          setBitrateKbps(
            Math.max(
              0,
              Math.round(
                ((bytesReceived - refs.totalBytesReceived) * 8) / elapsedMs
              )
            )
          );
          const newLost = Math.max(0, packetsLost - refs.lastPacketsLost);
          const newReceived = packetsReceived - refs.lastPacketsReceived;
          const newTotal = newLost + newReceived;
          setPacketLossPercent(
            newTotal > 0 ? Math.round((newLost / newTotal) * 100) : 0
          );
          setJitterMs(Math.round(jitter * 1000));
        }
        refs.totalBytesReceived = bytesReceived;
        refs.lastStatsTimestamp = timestamp;
        refs.lastPacketsLost = packetsLost;
        refs.lastPacketsReceived = packetsReceived;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      if (audioEnabled && paramId) {
        const sessionError = await joinSession(paramId);
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

  const sessionState: Partial<Record<RTCPeerConnectionState, string>> = {
    new: 'Waiting for connection...',
    connected: 'You are connected.',
  };

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
      {connectionState === 'connected' && <PlayingIcon />}
      <p>{sessionState[connectionState] ?? `Session ${connectionState}`}</p>
      {!paramId && connectionState === 'new' && (
        <>
          <div>Invite someone to join the session:</div>
          <Link>{link}</Link>
          <p>
            <Button onClick={handleCopyLink}>{copyLinkButtonText}</Button>
          </p>
        </>
      )}
      {connectionState === 'connected' && (
        <>
          <VolumeControls />
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
