// Persist volume slider positions across sessions so users don't have to
// redial their levels every time they join.

const PREFIX = 'rtc-audio:volume:';

export function loadVolume(name: string): number {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (raw === null) return 1;
    const value = parseFloat(raw);
    // Clamp to the slider range; fall back to full on anything unparseable.
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}

export function saveVolume(name: string, value: number) {
  try {
    localStorage.setItem(PREFIX + name, String(value));
  } catch {
    // Storage unavailable (private mode / quota) — non-fatal, just don't
    // persist.
  }
}
