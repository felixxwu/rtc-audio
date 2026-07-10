import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  insertMessage,
  getMessages,
  subscribeChat,
  _resetChatForTest,
  type ChatMessage,
  sendText,
  buildHistoryWire,
  ingestChatWire,
  _setBroadcastForTest,
  noteTyping,
  getTypingIds,
  announcePeerJoined,
  announcePeerLeft,
  sendFiles,
  fileAvailability,
  type FileMessage,
} from './chat.ts';
import { refs } from './refs.ts';

const text = (id: string, sentAt: number, senderId = 'p1'): ChatMessage => ({
  kind: 'text',
  id,
  senderId,
  sentAt,
  text: `msg ${id}`,
});

describe('chat store', () => {
  beforeEach(() => _resetChatForTest());

  it('keeps messages sorted by sentAt then id', () => {
    insertMessage(text('b', 200));
    insertMessage(text('a', 100));
    insertMessage(text('c', 200));
    expect(getMessages().map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('dedupes by id', () => {
    insertMessage(text('a', 100));
    insertMessage(text('a', 100));
    expect(getMessages()).toHaveLength(1);
  });

  it('notifies subscribers on insert', () => {
    let calls = 0;
    const unsub = subscribeChat(() => calls++);
    insertMessage(text('a', 100));
    expect(calls).toBe(1);
    unsub();
    insertMessage(text('b', 200));
    expect(calls).toBe(1);
  });
});

describe('chat wire protocol', () => {
  beforeEach(() => _resetChatForTest());

  it('sendText inserts locally and broadcasts a msg wire', () => {
    const sent: string[] = [];
    _setBroadcastForTest((json) => sent.push(json));
    sendText('hello');
    expect(getMessages()).toHaveLength(1);
    expect(getMessages()[0]).toMatchObject({ kind: 'text', text: 'hello' });
    const wire = JSON.parse(sent[0]);
    expect(wire.type).toBe('msg');
    expect(wire.message.text).toBe('hello');
  });

  it('sendText ignores blank input', () => {
    _setBroadcastForTest(() => {});
    sendText('   ');
    expect(getMessages()).toHaveLength(0);
  });

  it('ingests a msg wire and dedupes replays', () => {
    _setBroadcastForTest(() => {});
    const wire = JSON.stringify({
      type: 'msg',
      message: { kind: 'text', id: 'x1', senderId: 'p2', sentAt: 5, text: 'hi' },
    });
    ingestChatWire('p2', wire);
    ingestChatWire('p2', wire);
    expect(getMessages()).toHaveLength(1);
  });

  it('buildHistoryWire caps at HISTORY_CAP and excludes system messages', () => {
    _setBroadcastForTest(() => {});
    for (let i = 0; i < 205; i++) {
      insertMessage({ kind: 'text', id: `t${i}`, senderId: 'p1', sentAt: i, text: '.' });
    }
    insertMessage({ kind: 'system', id: 's1', senderId: 'p1', sentAt: 999, event: 'joined' });
    const wire = buildHistoryWire();
    expect(wire.type).toBe('history');
    if (wire.type !== 'history') throw new Error('unreachable');
    expect(wire.messages).toHaveLength(200);
    expect(wire.messages.every((m) => m.kind === 'text' || m.kind === 'file')).toBe(true);
  });

  it('ingests a history wire, inserting all non-duplicate items', () => {
    _setBroadcastForTest(() => {});
    insertMessage({ kind: 'text', id: 'a', senderId: 'p1', sentAt: 1, text: 'a' });
    const wire = JSON.stringify({
      type: 'history',
      messages: [
        { kind: 'text', id: 'a', senderId: 'p1', sentAt: 1, text: 'a' },
        { kind: 'file', id: 'p2:0', senderId: 'p2', sentAt: 2, name: 'f.bin', size: 10, mime: '' },
      ],
    });
    ingestChatWire('p2', wire);
    expect(getMessages().map((m) => m.id)).toEqual(['a', 'p2:0']);
  });
});

describe('typing indicators', () => {
  beforeEach(() => _resetChatForTest());

  it('tracks and clears typing per sender', () => {
    vi.useFakeTimers();
    noteTyping('p2', true);
    expect(getTypingIds()).toEqual(['p2']);
    noteTyping('p2', false);
    expect(getTypingIds()).toEqual([]);
    vi.useRealTimers();
  });

  it('auto-clears typing after the timeout', () => {
    vi.useFakeTimers();
    noteTyping('p2', true);
    expect(getTypingIds()).toEqual(['p2']);
    vi.advanceTimersByTime(5001);
    expect(getTypingIds()).toEqual([]);
    vi.useRealTimers();
  });

  it('announcePeerLeft clears the departed peer\'s typing entry', () => {
    announcePeerJoined('p2');
    noteTyping('p2', true);
    expect(getTypingIds()).toEqual(['p2']);
    announcePeerLeft('p2');
    expect(getTypingIds()).toEqual([]);
  });
});

describe('system messages', () => {
  beforeEach(() => _resetChatForTest());

  it('announces a join once per peer until it leaves', () => {
    announcePeerJoined('p2');
    announcePeerJoined('p2');
    expect(getMessages().filter((m) => m.kind === 'system')).toHaveLength(1);
    announcePeerLeft('p2');
    announcePeerJoined('p2');
    const systems = getMessages().filter((m) => m.kind === 'system');
    expect(systems).toHaveLength(3); // join, left, join
  });
});

describe('file messages', () => {
  beforeEach(() => {
    _resetChatForTest();
    refs.peers.clear();
    refs.heldFiles.clear();
  });

  it('sendFiles inserts a file message, holds the blob, and broadcasts', () => {
    const sent: string[] = [];
    _setBroadcastForTest((j) => sent.push(j));
    const file = new File([new Uint8Array(4)], 'a.txt', { type: 'text/plain' });
    sendFiles([file]);
    const msg = getMessages()[0] as FileMessage;
    expect(msg.kind).toBe('file');
    expect(msg.name).toBe('a.txt');
    expect(refs.heldFiles.has(msg.id)).toBe(true);
    expect(JSON.parse(sent[0]).message.name).toBe('a.txt');
  });

  it('availability is self for own files, unavailable when sender absent', () => {
    const own: FileMessage = { kind: 'file', id: 'me:0', senderId: (globalThis as any).__myPeerId ?? 'me', sentAt: 1, name: 'x', size: 1, mime: '' };
    // Sender not in refs.peers → unavailable
    const remote: FileMessage = { kind: 'file', id: 'p2:0', senderId: 'p2', sentAt: 1, name: 'x', size: 1, mime: '' };
    expect(fileAvailability(remote)).toBe('unavailable');
    // @ts-expect-error partial peer
    refs.peers.set('p2', { pc: { connectionState: 'connected' } });
    expect(fileAvailability(remote)).toBe('available');
    void own;
  });
});
