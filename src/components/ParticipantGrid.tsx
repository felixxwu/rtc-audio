import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { refs } from '../rtc/refs.ts';
import { useRoom } from '../rtc/roomStore.ts';
import { ParticipantBox } from './ParticipantBox.tsx';
import { InviteBox } from './InviteBox.tsx';
import { startColorLoop } from '../util/colorLoop.ts';
import { fitBoxWidth } from '../util/fitBox.ts';

// Standard cell metrics. The box is 1.5:1 (see ParticipantBox), laid out on a
// 16px gap. Boxes shrink from MAX_WIDTH only as far as needed to fit.
const MAX_WIDTH = 280;
// Floor: below this a tile is unusably small, so we stop shrinking and let the
// area scroll instead (an extreme participant count on a tiny screen).
const MIN_WIDTH = 72;
const GAP = 16;
const ASPECT = 1.5;
const PADDING_X = 32; // Grid's 16px horizontal padding, both sides.
// Breathing room kept out of the fit so tiles don't butt up against the dock
// (and the top edge) — centring splits it evenly top and bottom.
const MARGIN_Y = 32;

export function ParticipantGrid({ link }: { link: string }) {
  // Re-render on structural changes (peers joining/leaving, a share
  // starting/stopping). Colour is handled by the rAF loop, not here.
  useRoom();
  const gridRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

  useEffect(() => {
    startColorLoop();
  }, []);

  // Track the usable rectangle (the grid fills the area above the dock). The
  // measured box is unaffected by the cell size we set, so this can't loop.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () =>
      setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const peerIds = [...refs.peers.keys()];
  // Every rendered cell counts toward the fit, including the invite box.
  const count = peerIds.length + 1;
  const boxWidth = Math.max(
    MIN_WIDTH,
    Math.floor(
      fitBoxWidth({
        width: area.width - PADDING_X,
        height: area.height - MARGIN_Y,
        count,
        gap: GAP,
        maxWidth: MAX_WIDTH,
        aspect: ASPECT,
      })
    )
  );

  return (
    <Grid
      ref={gridRef}
      style={{ gridTemplateColumns: `repeat(auto-fit, ${boxWidth}px)` }}
    >
      {peerIds.map((id) => (
        <ParticipantBox key={id} id={id} />
      ))}
      <InviteBox link={link} />
    </Grid>
  );
}

const Grid = styled('div')`
  display: grid;
  /* Cell width is set inline from fitBoxWidth so every box shrinks (down from
     280px) just enough to fit the space above the dock. auto-fit collapses
     empty tracks so the boxes stay centred. */
  gap: 16px;
  width: 100%;
  height: 100%;
  padding: 0 16px;
  box-sizing: border-box;
  align-content: center;
  justify-content: center;
`;
