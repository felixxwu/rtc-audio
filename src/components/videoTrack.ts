import { useEffect, useRef, type RefObject } from 'react';

// Attach a single video track to a <video> element without spurious reloads.
// Compare the underlying track, not the MediaStream object: callers poll and
// would otherwise wrap the same track in a fresh MediaStream every tick,
// reassigning srcObject and making the element reload (flash). Autoplay
// doesn't reliably fire on a programmatic srcObject set, so kick playback
// explicitly (muted, so no gesture needed) — harmless if already playing.
export function attachTrack(
  video: HTMLVideoElement,
  track: MediaStreamTrack | null
): void {
  const current =
    video.srcObject instanceof MediaStream
      ? video.srcObject.getVideoTracks()[0] ?? null
      : null;
  if (track !== current) {
    video.srcObject = track ? new MediaStream([track]) : null;
  }
  if (video.srcObject && video.paused) video.play().catch(() => {});
}

// Keep a <video> element fed from a possibly-late-arriving track. The source
// is read through a getter each tick, so callers don't have to thread the
// (often null-then-present) track through effect deps; a short poll bridges
// the gap between requesting a remote stream and it actually arriving.
// Attaching is idempotent (see attachTrack), so re-running is cheap, and it
// no-ops while the element is unmounted (getter returns null / ref is null).
export function useVideoTrack(
  videoRef: RefObject<HTMLVideoElement | null>,
  getTrack: () => MediaStreamTrack | null
): void {
  const latest = useRef(getTrack);
  latest.current = getTrack;
  useEffect(() => {
    const attach = () => {
      const video = videoRef.current;
      if (video) attachTrack(video, latest.current());
    };
    attach();
    const interval = setInterval(attach, 500);
    return () => clearInterval(interval);
  }, [videoRef]);
}
