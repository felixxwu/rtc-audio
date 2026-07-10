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
