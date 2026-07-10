// Label of the per-peer lossless FLAC data channel. Shared so channel creation
// (room.ts) and byte-accounting classification (stats.ts) can't drift apart.
export const AUDIO_CHANNEL_LABEL = 'audio';

// Wire format for the per-peer FLAC audio channel. Control messages are JSON
// strings; FLAC frames are raw ArrayBuffers. The two are distinguished purely
// by the runtime type of the received data, so no envelope/length-prefixing
// is needed (the channel is reliable + ordered).
export type StreamParams = {
  sampleRate: number;
  channels: number;
  blockSize: number;
};

export type ControlMessage =
  | { lossless: 'start'; params: StreamParams }
  | { lossless: 'stop' };

export type ParsedMessage =
  | { kind: 'control'; message: ControlMessage }
  | { kind: 'frame'; bytes: ArrayBuffer };

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

function isControl(value: unknown): value is ControlMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.lossless === 'stop') return true;
  if (v.lossless === 'start') {
    const p = v.params as Record<string, unknown> | undefined;
    return (
      !!p &&
      typeof p.sampleRate === 'number' &&
      typeof p.channels === 'number' &&
      typeof p.blockSize === 'number'
    );
  }
  return false;
}

export function parseMessage(data: unknown): ParsedMessage | null {
  if (data instanceof ArrayBuffer) return { kind: 'frame', bytes: data };
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return isControl(parsed) ? { kind: 'control', message: parsed } : null;
    } catch {
      return null;
    }
  }
  return null;
}
