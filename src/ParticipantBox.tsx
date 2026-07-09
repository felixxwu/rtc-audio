import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { refs } from './refs.ts';
import { setWatching } from './room.ts';
import { letterFor } from './participants.ts';
import { circleColor } from './participantColor.ts';
import { registerBox, unregisterBox } from './colorLoop.ts';
import { requestView } from './viewerControl.ts';
import {
  Icon,
  SpeakerLoud,
  SpeakerMedium,
  SpeakerQuiet,
  SpeakerOff,
} from './Icon.tsx';
import { colors } from './colors.ts';

export function ParticipantBox({ id }: { id: string }) {
  // Show the thumbnail as soon as the peer is sharing — we don't wait for the
  // stream to have arrived, because we request it (below) precisely because
  // they're sharing.
  const sharing = refs.sharingPeers.has(id);
  const borderRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Per-participant playback volume, seeded from this peer's audio element
  // (which starts at the remembered default) so each stream is dialled in
  // individually.
  const [volume, setVolume] = useState(
    refs.peers.get(id)?.audio.volume ?? refs.speakerVolume
  );

  // Register the border with the colour loop (only the border reacts).
  useEffect(() => {
    if (!borderRef.current) return;
    registerBox(id, { colorId: id, levelId: id, border: borderRef.current });
    return () => unregisterBox(id);
  }, [id]);

  // Apply this peer's volume to only their audio element.
  useEffect(() => {
    const peer = refs.peers.get(id);
    if (peer) peer.audio.volume = volume;
  }, [id, volume]);

  // Request the peer's shared screen the moment they start sharing, so the
  // low-quality thumbnail populates straight away rather than only after
  // someone opens the full view. Stop asking when they stop / the box unmounts.
  useEffect(() => {
    if (!sharing) return;
    setWatching(id, true);
    return () => setWatching(id, false);
  }, [id, sharing]);

  // Feed the thumbnail from the peer's shared-screen stream. Runs on every
  // render (the grid re-renders on a poll) so it attaches once the stream
  // arrives after the watch request above.
  useEffect(() => {
    const v = videoRef.current;
    const stream = refs.peers.get(id)?.videoStream ?? null;
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play().catch(() => {});
    }
  });

  const speakerIcon =
    volume === 0
      ? SpeakerOff
      : [SpeakerQuiet, SpeakerMedium, SpeakerLoud][Math.round(volume * 2)];

  return (
    <Box
      ref={borderRef}
      onClick={sharing ? () => requestView('watch') : undefined}
      $clickable={sharing}
    >
      {sharing ? (
        <Thumb ref={videoRef} autoPlay playsInline muted />
      ) : (
        <Circle style={{ background: circleColor(id) }}>{letterFor(id)}</Circle>
      )}

      {/* Per-participant volume, revealed on hover. stopPropagation so tweaking
          it never opens the full-screen share. */}
      <VolumeBar data-vol onClick={(e) => e.stopPropagation()}>
        <IconButton
          onClick={() => setVolume(volume === 0 ? 1 : 0)}
          title={volume === 0 ? 'Unmute' : 'Mute'}
        >
          <Icon path={speakerIcon} size={20} color="#fff" />
        </IconButton>
        <Range
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </VolumeBar>
    </Box>
  );
}

const Box = styled('div')<{ $clickable?: boolean }>`
  position: relative;
  aspect-ratio: 1.5 / 1;
  border: 3px solid #888;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #1a1a1a;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};

  & [data-vol] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  &:hover [data-vol] {
    opacity: 1;
    pointer-events: auto;
  }
`;

const Circle = styled('div')`
  height: 48%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 600;
  color: #111;
`;

const Thumb = styled('video')`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const VolumeBar = styled('div')`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
`;

const IconButton = styled('button')`
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  flex-shrink: 0;
`;

const Range = styled('input')`
  flex: 1;
  min-width: 0;
  accent-color: ${colors.accent2};
  cursor: pointer;
`;
