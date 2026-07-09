import { describe, it, expect } from 'vitest';
import { fitBoxWidth } from './fitBox.ts';

const opts = { gap: 16, maxWidth: 280, aspect: 1.5 };

describe('fitBoxWidth', () => {
  it('caps at maxWidth when there is plenty of room', () => {
    expect(fitBoxWidth({ width: 2000, height: 2000, count: 3, ...opts })).toBe(
      280
    );
  });

  it('falls back to maxWidth before the container is measured', () => {
    expect(fitBoxWidth({ width: 0, height: 0, count: 5, ...opts })).toBe(280);
  });

  it('is limited by horizontal room', () => {
    expect(fitBoxWidth({ width: 200, height: 1000, count: 1, ...opts })).toBe(
      200
    );
  });

  it('is limited by vertical room, choosing more columns to grow the cell', () => {
    // cols=2,rows=1 -> height-bound width = 100*1.5 = 150 (beats cols=1's 63).
    expect(fitBoxWidth({ width: 10000, height: 100, count: 2, ...opts })).toBe(
      150
    );
  });

  it('hits exactly maxWidth when the rectangle fits the standard grid', () => {
    // Two columns: 2*280 + 16 gap wide, one row 280/1.5 tall.
    expect(
      fitBoxWidth({ width: 576, height: 280 / 1.5, count: 2, ...opts })
    ).toBeCloseTo(280);
  });

  it('shrinks so all cells fit a tight rectangle', () => {
    const w = fitBoxWidth({ width: 600, height: 400, count: 9, ...opts });
    // Verify the result actually fits: pick the columns auto-fit would use.
    const cols = Math.floor((600 + 16) / (w + 16));
    const rows = Math.ceil(9 / cols);
    expect(cols * w + (cols - 1) * 16).toBeLessThanOrEqual(600 + 0.01);
    expect(rows * (w / 1.5) + (rows - 1) * 16).toBeLessThanOrEqual(400 + 0.01);
    expect(w).toBeLessThan(280);
  });
});
