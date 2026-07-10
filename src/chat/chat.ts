import { refs } from '../rtc/refs.ts';
import { myPeerId } from '../util/identity.ts';
import { holdFile, requestFile } from './fileTransfer.ts';

export interface BaseMessage {
  id: string;
  senderId: string;
  sentAt: number;
}
export interface TextMessage extends BaseMessage {
  kind: 'text';
  text: string;
}
export interface FileMessage extends BaseMessage {
  kind: 'file';
  name: string;
  size: number;
  mime: string;
}
export interface SystemMessage extends BaseMessage {
  kind: 'system';
  event: 'joined' | 'left';
}
export type ChatMessage = TextMessage | FileMessage | SystemMessage;

export const HISTORY_CAP = 200;

let messages: ChatMessage[] = [];
const byId = new Set<string>();
const listeners = new Set<() => void>();
// Monotonic suffix for locally-generated message ids (text/file/system); the
// prefix/separator already distinguishes the kinds, so one counter suffices.
let idCounter = 0;

function notify() {
  listeners.forEach((l) => l());
}

// Sort key: sender-local timestamp, id as a stable tiebreak.
function before(a: ChatMessage, b: ChatMessage): boolean {
  return a.sentAt < b.sentAt || (a.sentAt === b.sentAt && a.id < b.id);
}

export function insertMessage(msg: ChatMessage): void {
  if (byId.has(msg.id)) return;
  byId.add(msg.id);
  let i = messages.length;
  while (i > 0 && before(msg, messages[i - 1])) i--;
  const next = messages.slice();
  next.splice(i, 0, msg);
  messages = next;
  notify();
}

// Insert many at once (history backfill): dedupe, merge, sort, and notify a
// single time — avoids the O(n²) copies and per-item re-render storm of
// calling insertMessage up to HISTORY_CAP times.
export function insertMessages(msgs: ChatMessage[]): void {
  const fresh = msgs.filter((m) => !byId.has(m.id));
  if (fresh.length === 0) return;
  fresh.forEach((m) => byId.add(m.id));
  messages = [...messages, ...fresh].sort((a, b) =>
    before(a, b) ? -1 : before(b, a) ? 1 : 0
  );
  notify();
}

export function getMessages(): readonly ChatMessage[] {
  return messages;
}

export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _resetChatForTest(): void {
  messages = [];
  byId.clear();
  listeners.clear();
  typingTimers.forEach((t) => clearTimeout(t));
  typingTimers.clear();
  idCounter = 0;
  announcedJoined.clear();
}

export type ChatWire =
  | { type: 'msg'; message: TextMessage | FileMessage }
  | { type: 'history'; messages: (TextMessage | FileMessage)[] }
  | { type: 'typing'; senderId: string; isTyping: boolean };


// Broadcast seam: default sends to every open chat channel; tests override it.
let broadcast: (json: string) => void = (json) => {
  for (const peer of refs.peers.values()) {
    if (peer.chatChannel?.readyState === 'open') peer.chatChannel.send(json);
  }
};
export function _setBroadcastForTest(fn: (json: string) => void): void {
  broadcast = fn;
}

export function sendText(body: string): void {
  const text = body.trim();
  if (!text) return;
  const message: TextMessage = {
    kind: 'text',
    id: `${myPeerId}-${idCounter++}`,
    senderId: myPeerId,
    sentAt: Date.now(),
    text,
  };
  insertMessage(message);
  const wire: ChatWire = { type: 'msg', message };
  broadcast(JSON.stringify(wire));
}

export function buildHistoryWire(): ChatWire {
  const shareable = messages.filter(
    (m): m is TextMessage | FileMessage => m.kind !== 'system'
  );
  return { type: 'history', messages: shareable.slice(-HISTORY_CAP) };
}

export function sendHistoryTo(peerId: string): void {
  const channel = refs.peers.get(peerId)?.chatChannel;
  if (channel?.readyState === 'open') {
    channel.send(JSON.stringify(buildHistoryWire()));
  }
}

export function ingestChatWire(_fromPeerId: string, data: string): void {
  let wire: ChatWire;
  try {
    wire = JSON.parse(data);
  } catch {
    return;
  }
  if (wire.type === 'msg') {
    insertMessage(wire.message);
  } else if (wire.type === 'history') {
    insertMessages(wire.messages);
  } else if (wire.type === 'typing') {
    noteTyping(wire.senderId, wire.isTyping);
  }
}

export const TYPING_TIMEOUT_MS = 5000;

const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function noteTyping(senderId: string, isTyping: boolean): void {
  const existing = typingTimers.get(senderId);
  if (existing) clearTimeout(existing);
  if (isTyping) {
    typingTimers.set(
      senderId,
      setTimeout(() => {
        typingTimers.delete(senderId);
        notify();
      }, TYPING_TIMEOUT_MS)
    );
  } else {
    typingTimers.delete(senderId);
  }
  notify();
}

export function getTypingIds(): string[] {
  return [...typingTimers.keys()].filter((id) => id !== myPeerId);
}

const announcedJoined = new Set<string>();

export function announcePeerJoined(peerId: string): void {
  if (announcedJoined.has(peerId)) return;
  announcedJoined.add(peerId);
  insertMessage({
    kind: 'system',
    id: `sys-${myPeerId}-${idCounter++}`,
    senderId: peerId,
    sentAt: Date.now(),
    event: 'joined',
  });
}

export function announcePeerLeft(peerId: string): void {
  if (!announcedJoined.has(peerId)) return; // never announced a join → skip
  announcedJoined.delete(peerId);
  insertMessage({
    kind: 'system',
    id: `sys-${myPeerId}-${idCounter++}`,
    senderId: peerId,
    sentAt: Date.now(),
    event: 'left',
  });
  // A departed peer's typing indicator would otherwise linger for up to
  // TYPING_TIMEOUT_MS after they're gone.
  const typingTimer = typingTimers.get(peerId);
  if (typingTimer) {
    clearTimeout(typingTimer);
    typingTimers.delete(peerId);
    notify();
  }
}


export function sendFiles(files: File[]): void {
  for (const file of files) {
    const message: FileMessage = {
      kind: 'file',
      id: `${myPeerId}:${idCounter++}`,
      senderId: myPeerId,
      sentAt: Date.now(),
      name: file.name,
      size: file.size,
      mime: file.type,
    };
    holdFile(message.id, file);
    insertMessage(message);
    broadcast(JSON.stringify({ type: 'msg', message } satisfies ChatWire));
  }
}

export function fileAvailability(
  msg: FileMessage
): 'available' | 'unavailable' | 'self' {
  if (msg.senderId === myPeerId) return 'self';
  const peer = refs.peers.get(msg.senderId);
  return peer && peer.pc.connectionState === 'connected'
    ? 'available'
    : 'unavailable';
}

export function downloadFile(msg: FileMessage): void {
  void requestFile(msg.id, msg.senderId, msg.name, msg.size, msg.mime);
}

let lastTypingSent = 0;
export function setLocalTyping(isTyping: boolean): void {
  const now = Date.now();
  // Throttle "true" pings to at most one per second; always send "false".
  if (isTyping && now - lastTypingSent < 1000) return;
  lastTypingSent = now;
  broadcast(
    JSON.stringify({ type: 'typing', senderId: myPeerId, isTyping } satisfies ChatWire)
  );
}
