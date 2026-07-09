import { refs } from './refs.ts';

// Sequential letter by join order: A, B, ... Z, AA, AB, ... Returns '?' for a
// participant not yet in the ordered list (converges on the next snapshot).
export function letterFor(id: string): string {
  const index = refs.participantOrder.indexOf(id);
  if (index < 0) return '?';
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
