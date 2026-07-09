import { refs } from './refs.ts';
import { myPeerId } from './room.ts';
import { hue } from './participantColor.ts';

// Live collaborative pointers over the shared screen. Positions travel on a
// per-pair WebRTC data channel (unreliable/unordered — newest wins, a lost
// packet must never block). The sharer is the hub: viewers send their
// cursor to the sharer, who relays to every other viewer, so everyone —
// including the host looking at their own capture — sees everyone's pointer.

export type Cursor = {
  // Target position, normalised to the shared video frame (0..1).
  x: number;
  y: number;
  // Rendered position, eased toward the target each frame for smoothness.
  rx: number;
  ry: number;
  active: boolean;
  // Timestamp (ms) of the last ping click, 0 if none; drives the ring.
  ping: number;
  // Timestamp (ms) of the last update, for staleness cleanup.
  seen: number;
};

export const cursors = new Map<string, Cursor>();

// Cursor moves are disposable; cap the send rate rather than flood the
// channel with every pointermove.
const SEND_INTERVAL_MS = 40;
let lastSent = 0;

type CursorMessage = {
  t: 'cursor' | 'ping';
  id: string;
  x: number;
  y: number;
  active: boolean;
};

function cursorFor(id: string): Cursor {
  let cursor = cursors.get(id);
  if (!cursor) {
    cursor = { x: 0.5, y: 0.5, rx: 0.5, ry: 0.5, active: false, ping: 0, seen: 0 };
    cursors.set(id, cursor);
  }
  return cursor;
}

function apply(msg: CursorMessage) {
  const cursor = cursorFor(msg.id);
  cursor.x = msg.x;
  cursor.y = msg.y;
  cursor.active = msg.active;
  cursor.seen = Date.now();
  if (msg.t === 'ping') cursor.ping = Date.now();
}

function sendRaw(peerId: string, raw: string) {
  const channel = refs.peers.get(peerId)?.cursorChannel;
  if (channel && channel.readyState === 'open') {
    try {
      channel.send(raw);
    } catch {
      // Channel closing mid-send — the position is disposable, drop it.
    }
  }
}

// Sharer → every viewer (those who asked to watch our screen).
function broadcastToViewers(raw: string, except?: string) {
  for (const [id, peer] of refs.peers) {
    if (id !== except && peer.remoteWatching) sendRaw(id, raw);
  }
}

// Viewer → the sharer it is watching, which relays onward.
function sendToSharer(raw: string) {
  const sharerId = [...refs.sharingPeers][0];
  if (sharerId) sendRaw(sharerId, raw);
}

export function handleCursorMessage(fromPeerId: string, raw: string) {
  let msg: CursorMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.id === myPeerId) return;
  // If we're the sharer, fan this viewer's cursor out to the other viewers.
  if (refs.shareVideoTrack) broadcastToViewers(raw, fromPeerId);
  apply(msg);
}

function originate(t: 'cursor' | 'ping', x: number, y: number, active: boolean) {
  const raw = JSON.stringify({ t, id: myPeerId, x, y, active });
  if (refs.shareVideoTrack) broadcastToViewers(raw);
  else sendToSharer(raw);
}

export function sendCursor(x: number, y: number) {
  const now = Date.now();
  if (now - lastSent < SEND_INTERVAL_MS) return;
  lastSent = now;
  originate('cursor', x, y, true);
}

export function sendPointerLeave() {
  originate('cursor', 0, 0, false);
}

export function sendPing(x: number, y: number) {
  originate('ping', x, y, true);
  // Echo the ring locally so the clicker sees the same animation everyone
  // else gets. Kept inactive (no arrow — their real cursor is already
  // there); only the ring renders, from the ping timestamp.
  const own = cursorFor(myPeerId);
  own.x = own.rx = x;
  own.y = own.ry = y;
  own.active = false;
  own.ping = Date.now();
  own.seen = Date.now();
}

// A stable, distinct colour per peer (no names in the app yet).
export function colorForPeer(id: string): string {
  return `hsl(${hue(id)} 85% 60%)`;
}

// The letterboxed rectangle the video actually occupies inside its element
// (object-fit: contain leaves bars), in viewport coordinates.
export function displayRect(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const width = vw * scale;
  const height = vh * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

// Pointer position → normalised frame coords, or null if over a letterbox
// bar (outside the actual picture).
export function normalizedFromEvent(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number
) {
  const rect = displayRect(video);
  if (!rect) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
