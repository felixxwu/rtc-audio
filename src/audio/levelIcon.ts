// Map a 0..1 volume to one of four icon paths: `off` when muted, otherwise one
// of the three level glyphs bucketed by Math.round(volume * 2). Shared by the
// mic toolbar and the per-participant speaker control so the bucketing lives
// in one place.
export function levelIcon(
  volume: number,
  off: string,
  levels: readonly [string, string, string]
): string {
  return volume === 0 ? off : levels[Math.round(volume * 2)];
}
