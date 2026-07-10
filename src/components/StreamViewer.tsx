import { useEffect, useReducer, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { refs, peerVideoTrack, currentSharerId } from '../rtc/refs.ts';
import { setFullQuality } from '../rtc/room.ts';
import { myPeerId } from '../util/identity.ts';
import { useRoom } from '../rtc/roomStore.ts';
import { useVideoTrack } from './videoTrack.ts';
import { Button } from './Button.tsx';
import { consumeRequest, onRequest } from '../rtc/viewerControl.ts';
import {
  colorForPeer,
  cursors,
  displayRect,
  normalizedFromEvent,
  sendCursor,
  sendPing,
  sendPointerLeave,
} from '../chat/cursors.ts';

type Mode = null | 'watch' | 'host';

// Fullscreen view of a shared screen with live collaborative pointers.
// Viewers open the sharer's remote video; the host opens their own local
// capture — both render everyone's cursors, since the sharer relays them.
export function StreamViewer() {
  const [mode, setMode] = useState<Mode>(null);
  const [showClose, setShowClose] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Role + availability are derived from refs (the room store re-renders us on
  // change). The watch request itself is owned by ParticipantBox, so the
  // stream is already flowing before the overlay opens.
  useRoom();
  const sharing = refs.shareVideoTrack !== null;
  const sharerId = currentSharerId();

  // Close the overlay if what it shows ended: the watched share for a viewer,
  // or our own share for the host.
  useEffect(() => {
    setMode((m) => {
      if (m === 'watch' && !sharerId) return null;
      if (m === 'host' && !sharing) return null;
      return m;
    });
  }, [sharerId, sharing]);

  // Feed the overlay's video element: the local capture when hosting, or the
  // watched peer's remote stream (which can arrive shortly after the request).
  useVideoTrack(videoRef, () =>
    mode === 'host'
      ? refs.shareVideoTrack
      : (sharerId && peerVideoTrack(sharerId)) || null
  );

  // The stream is already being watched (ParticipantBox requested it), so
  // opening the full view is just showing the overlay.
  const openWatch = () => {
    if (!sharerId) return;
    setMode('watch');
  };

  const openHost = () => setMode('host');

  const close = () => setMode(null);

  // While the full-screen watch view is open, ask the sharer for full quality
  // (the box only ever requests the thumbnail tier). Released on close or when
  // the sharer changes.
  useEffect(() => {
    if (mode !== 'watch' || !sharerId) return;
    setFullQuality(sharerId, true);
    return () => setFullQuality(sharerId, false);
  }, [mode, sharerId]);

  // External open requests from the participant boxes / self box.
  useEffect(() => {
    return onRequest(() => {
      const view = consumeRequest();
      if (view === 'watch') openWatch();
      else if (view === 'host') openHost();
    });
  });

  const revealClose = () => {
    setShowClose(true);
    clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setShowClose(false), 2500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    revealClose();
    const video = videoRef.current;
    if (!video) return;
    const point = normalizedFromEvent(video, e.clientX, e.clientY);
    if (point) sendCursor(point.x, point.y);
  };

  const handlePing = (e: React.MouseEvent) => {
    const video = videoRef.current;
    if (!video) return;
    const point = normalizedFromEvent(video, e.clientX, e.clientY);
    if (point) sendPing(point.x, point.y);
  };

  if (!mode) return null;

  return (
    <Overlay onPointerMove={handlePointerMove}>
      <Video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onPointerLeave={sendPointerLeave}
        onPointerUp={sendPointerLeave}
        onClick={handlePing}
      />
      <CursorLayer videoRef={videoRef} />
      {showClose && <CloseButton onClick={close}>Close</CloseButton>}
    </Overlay>
  );
}

function CursorLayer({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const now = Date.now();
      for (const [id, cursor] of cursors) {
        // Ease the rendered position toward the latest received one.
        cursor.rx += (cursor.x - cursor.rx) * 0.3;
        cursor.ry += (cursor.y - cursor.ry) * 0.3;
        if (!cursor.active && now - cursor.seen > 4000) cursors.delete(id);
      }
      tick();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const video = videoRef.current;
  const rect = video ? displayRect(video) : null;
  if (!rect) return null;
  const now = Date.now();

  return (
    <>
      {[...cursors.entries()].map(([id, cursor]) => {
        // Others get an arrow; our own entry exists only to echo a ping, so
        // it shows the ring but never an arrow (our real cursor is there).
        const showArrow = cursor.active && id !== myPeerId;
        const showRing = now - cursor.ping < 600;
        if (!showArrow && !showRing) return null;
        const color = colorForPeer(id);
        const left = rect.left + cursor.rx * rect.width;
        const top = rect.top + cursor.ry * rect.height;
        return (
          <Pointer key={id} style={{ left, top, color }}>
            {showRing && <Ring key={cursor.ping} style={{ borderColor: color }} />}
            {showArrow && (
              <Arrow viewBox="0 0 16 16" width="22" height="22">
                <path
                  d="M1 1 L1 12 L4.5 9 L7 14 L9 13 L6.5 8 L11 8 Z"
                  fill="currentColor"
                  stroke="#000"
                  strokeWidth="1"
                />
              </Arrow>
            )}
          </Pointer>
        );
      })}
    </>
  );
}

const Overlay = styled('div')`
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 10;
`;

const Video = styled('video')`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

const CloseButton = styled(Button)`
  position: absolute;
  bottom: 25px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
`;

const Pointer = styled('div')`
  position: absolute;
  z-index: 11;
  pointer-events: none;
  color: currentColor;
  transform: translate(-1px, -1px);
`;

const Arrow = styled('svg')`
  display: block;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
`;

const ringExpand = keyframes`
  from { transform: translate(-50%, -50%) scale(0.3); opacity: 0.9; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 0; }
`;

const Ring = styled('div')`
  position: absolute;
  left: 0;
  top: 0;
  width: 60px;
  height: 60px;
  border: 3px solid;
  border-radius: 50%;
  animation: ${ringExpand} 0.6s ease-out forwards;
`;
