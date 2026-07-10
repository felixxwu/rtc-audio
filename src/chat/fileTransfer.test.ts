import { describe, it, expect, beforeEach, vi } from 'vitest';
import { refs } from '../rtc/refs.ts';
import { holdFile, handleFileMessage, abortTransfersFrom } from './fileTransfer.ts';

function fakeChannel() {
  return {
    readyState: 'open' as const,
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    sent: [] as unknown[],
    send(d: unknown) {
      this.sent.push(d);
    },
    addEventListener() {},
  };
}

describe('pull-based file transfer', () => {
  beforeEach(() => {
    refs.peers.clear();
    refs.heldFiles.clear();
    refs.incomingTransfers.clear();
    refs.activeIncoming.clear();
  });

  it('holder streams start/chunks/end on request', async () => {
    const channel = fakeChannel();
    // @ts-expect-error partial peer for test
    refs.peers.set('p2', { fileChannel: channel });
    const file = new File([new Uint8Array(10)], 'f.bin', { type: 'application/octet-stream' });
    holdFile('p1:0', file);

    handleFileMessage('p2', JSON.stringify({ t: 'request', msgId: 'p1:0' }));
    await vi.waitFor(() => {
      const kinds = channel.sent.map((s) => (typeof s === 'string' ? JSON.parse(s).t : 'bin'));
      expect(kinds).toContain('start');
      expect(kinds).toContain('bin');
      expect(kinds).toContain('end');
    });
  });

  it('holder replies unavailable for an unknown msgId', () => {
    const channel = fakeChannel();
    // @ts-expect-error partial peer for test
    refs.peers.set('p2', { fileChannel: channel });
    handleFileMessage('p2', JSON.stringify({ t: 'request', msgId: 'gone:9' }));
    const msgs = channel.sent.map((s) => JSON.parse(s as string));
    expect(msgs).toEqual([{ t: 'unavailable', msgId: 'gone:9' }]);
  });

  it('abortTransfersFrom sweeps an idle transfer to unavailable', () => {
    refs.incomingTransfers.set('p2:1', {
      msgId: 'p2:1',
      from: 'p2',
      name: 'f.bin',
      size: 10,
      mime: 'application/octet-stream',
      received: 0,
      chunks: [],
      status: 'idle',
    });

    abortTransfersFrom('p2');

    expect(refs.incomingTransfers.get('p2:1')?.status).toBe('unavailable');
  });

  it('a mid-stream write failure fails the transfer, not "done"', async () => {
    const writable = {
      write: vi.fn().mockRejectedValue(new Error('disk full')),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    refs.incomingTransfers.set('p3:1', {
      msgId: 'p3:1',
      from: 'p3',
      name: 'f.bin',
      size: 10,
      mime: 'application/octet-stream',
      received: 0,
      chunks: [],
      status: 'receiving',
      writable,
    });
    refs.activeIncoming.set('p3', 'p3:1');

    handleFileMessage('p3', new ArrayBuffer(4));
    const transfer = refs.incomingTransfers.get('p3:1')!;
    await vi.waitFor(() => expect(transfer.writeChain).resolves.toBeUndefined());

    handleFileMessage('p3', JSON.stringify({ t: 'end', msgId: 'p3:1' }));
    await vi.waitFor(() => expect(transfer.status).toBe('failed'));
    expect(transfer.status).not.toBe('done');
  });

  it('an end with received < size yields status failed, not done', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    refs.incomingTransfers.set('p4:1', {
      msgId: 'p4:1',
      from: 'p4',
      name: 'f.bin',
      size: 10,
      mime: 'application/octet-stream',
      received: 4,
      chunks: [],
      status: 'receiving',
      writable,
    });
    refs.activeIncoming.set('p4', 'p4:1');

    handleFileMessage('p4', JSON.stringify({ t: 'end', msgId: 'p4:1' }));
    const transfer = refs.incomingTransfers.get('p4:1')!;
    await vi.waitFor(() => expect(transfer.status).toBe('failed'));
    expect(writable.abort).toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
  });
});
