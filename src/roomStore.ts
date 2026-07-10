import { useSyncExternalStore } from 'react';

// A tiny observable seam over the mutable `refs` object. The connection layer
// (room.ts, shareAudio.ts) calls notifyRoom() wherever it mutates state the UI
// renders from — peers joining/leaving, a share starting/stopping, the sharing
// set changing. Components subscribe with useRoom() and re-render on change,
// which replaces the per-component setInterval polling of `refs`.
//
// The snapshot is a monotonic version counter, not `refs` itself: `refs.peers`
// is a Map mutated in place, so its identity never changes and can't drive
// useSyncExternalStore. The counter changes on every notify, so subscribers
// re-render and read the (freshly mutated) refs directly.
const listeners = new Set<() => void>();
let version = 0;

export function notifyRoom(): void {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

// Subscribe the calling component to room-state changes. Read `refs` directly
// in render; the return value (the version) is rarely needed.
export function useRoom(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
