import { refs } from './refs.ts';

let wakeLock: WakeLockSentinel | null = null;

async function acquire() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    // Denied (e.g. low battery mode) — nothing to do, the session still
    // works while the user keeps the screen on themselves.
    console.error(e);
  }
}

// Keep the screen on while in a room: with the screen off, Android suspends
// mic capture and lets ICE time out, killing the session. No-op where the
// Wake Lock API is unavailable.
export function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  acquire();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // The lock is released automatically whenever the tab is hidden, so
    // re-acquire on return — and un-suspend the audio graph, which Android
    // sometimes leaves suspended after a background stint.
    if (wakeLock === null || wakeLock.released) acquire();
    refs.audioContext?.resume().catch(console.error);
  });
}
