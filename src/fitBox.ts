// Largest cell width (capped at maxWidth) at which `count` fixed-aspect cells,
// separated by `gap`, all fit inside a width×height rectangle without
// scrolling. Generalised so it adapts to any screen: a bigger rectangle simply
// admits a larger width (up to the cap) or more columns.
//
// `aspect` is width / height of a cell. We try every column count and keep the
// arrangement that yields the biggest cell — a cell is bounded either by the
// horizontal room per column or the vertical room per row (whichever is
// tighter), and by maxWidth.
export function fitBoxWidth({
  width,
  height,
  count,
  gap,
  maxWidth,
  aspect,
}: {
  width: number;
  height: number;
  count: number;
  gap: number;
  maxWidth: number;
  aspect: number;
}): number {
  // Not measured yet (or nothing to place): use the standard size.
  if (count <= 0 || width <= 0 || height <= 0) return maxWidth;

  let best = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const widthPerCol = (width - (cols - 1) * gap) / cols;
    const heightPerRow = (height - (rows - 1) * gap) / rows;
    const widthFromHeight = heightPerRow * aspect;
    const cell = Math.min(maxWidth, widthPerCol, widthFromHeight);
    if (cell > best) best = cell;
  }
  return Math.max(0, best);
}
