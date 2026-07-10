import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { refs } from './refs.ts';
import { setWatching } from './room.ts';
import { Avatar } from './Avatar.tsx';
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

  // Per-participant playback volume. Canonical value is refs.peerVolumes so it
  // survives the peer's <audio> element being recreated on reconnect; fall
  // back to the global default for a peer dialled in for the first time.
  const [volume, setVolume] = useState(
    refs.peerVolumes.get(id) ?? refs.speakerVolume
  );

  // Register the border with the colour loop (only the border reacts).
  useEffect(() => {
    if (!borderRef.current) return;
    registerBox(id, { colorId: id, levelId: id, border: borderRef.current });
    return () => unregisterBox(id);
  }, [id]);

  // Apply this peer's volume to their audio element and persist it as the
  // canonical value so a reconnect (new element) restores it.
  useEffect(() => {
    refs.peerVolumes.set(id, volume);
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

  // Recover a stuck (black) share. If packets are arriving (the track is live
  // and unmuted) but nothing has decoded — videoWidth still 0 — the viewer
  // most likely missed the first keyframe. Briefly drop and re-request the
  // watch so the sender re-attaches its track and emits a fresh keyframe.
  // Bounded so a genuinely dead share doesn't toggle forever.
  useEffect(() => {
    if (!sharing) return;
    let nudges = 0;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      if (v.videoWidth > 0) {
        nudges = 0; // decoding fine — reset the budget
        return;
      }
      const track = refs.peers.get(id)?.videoStream?.getVideoTracks()[0] ?? null;
      const flowing = !!track && track.readyState === 'live' && !track.muted;
      if (flowing && nudges < 3) {
        nudges++;
        setWatching(id, false);
        setTimeout(() => setWatching(id, true), 300);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [id, sharing]);

  const speakerIcon =
    volume === 0
      ? SpeakerOff
      : [SpeakerQuiet, SpeakerMedium, SpeakerLoud][Math.round(volume * 2)];

  // Live per-peer audio rates (updated by the stats poll). Shown only when not
  // sharing and not hovered (hover reveals the volume slider instead).
  const stats = refs.peers.get(id)?.stats;
  const inKbps = stats?.inKbps ?? 0;
  const outKbps = stats?.outKbps ?? 0;

  return (
    <Box
      ref={borderRef}
      onClick={sharing ? () => requestView('watch') : undefined}
      $clickable={sharing}
    >
      {sharing ? (
        <Thumb ref={videoRef} autoPlay playsInline muted />
      ) : (
        <Avatar id={id} />
      )}

      {/* Live bitrate, tucked near the bottom edge. Hidden while sharing (no
          Circle then) and on hover (the volume slider takes over). */}
      {!sharing && (
        <Rate data-rate>
          ↓ {inKbps} ↑ {outKbps} kb/s
        </Rate>
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
  /* Bitrate is the inverse of the volume bar: shown by default, hidden while
     hovering so it doesn't clash with the revealed slider. */
  & [data-rate] {
    opacity: 1;
    transition: opacity 0.12s;
  }
  &:hover [data-rate] {
    opacity: 0;
  }
`;

const Thumb = styled('video')`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const Rate = styled('div')`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  text-align: center;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: #555;
  pointer-events: none;
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
