// Hue is a stable hash of the peer id (same basis the cursor colour uses).
export function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

// Border colour: fixed 50% saturation, lightness driven by the live audio
// level (0 = silent = 20%, 1 = clipping = 70%).
export function boxColor(id: string, level: number): string {
  const clamped = Math.min(1, Math.max(0, level));
  return `hsl(${hue(id)} 50% ${20 + clamped * 50}%)`;
}

// The letter circle's colour: same hue, fixed 70% lightness (does not react).
export function circleColor(id: string): string {
  return `hsl(${hue(id)} 50% 75%)`;
}
