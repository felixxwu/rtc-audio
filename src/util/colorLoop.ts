import { levelFor } from '../audio/audioLevels.ts';
import { boxColor } from './participantColor.ts';

type Entry = {
  colorId: string; // hue source (peer id / our own id)
  levelId: string; // audio level source (peer id / SELF)
  border: HTMLElement;
};

const entries = new Map<string, Entry>();
let raf = 0;

function frame() {
  for (const e of entries.values()) {
    // Only the border reacts to audio; the letter circle is a fixed colour.
    e.border.style.borderColor = boxColor(e.colorId, levelFor(e.levelId));
  }
  raf = requestAnimationFrame(frame);
}

// Idempotent: starting an already-running loop is a no-op.
export function startColorLoop(): void {
  if (!raf) raf = requestAnimationFrame(frame);
}

export function registerBox(key: string, entry: Entry): void {
  entries.set(key, entry);
}

export function unregisterBox(key: string): void {
  entries.delete(key);
}
