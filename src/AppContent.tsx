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
  const [newBytesReceived, setNewBytesReceived] = useState(0);
  const params = new URLSearchParams(document.location.search);
  const paramId = params.get('id');
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [copyLinkButtonText, setCopyLinkButtonText] = useState('Copy link');

  useEffect(() => {
    const interval = setInterval(() => {
      setConnectionState(pc.connectionState);
      pc.getStats(null).then((stats) => {
        const totalBytesReceived =
          [...stats.values()].find((s) => s.type === 'transport')
            ?.bytesReceived ?? refs.totalBytesReceived;
        setNewBytesReceived(totalBytesReceived - refs.totalBytesReceived);
        refs.totalBytesReceived = totalBytesReceived;
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
            Bitrate (incoming):{' '}
            {Math.max(0, Math.round((newBytesReceived / 1000) * 8))} kb/s
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
