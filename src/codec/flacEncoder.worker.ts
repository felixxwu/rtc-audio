// Dedicated worker: turns interleaved Int32 blocks into FLAC byte frames.
// Keeps the ~1ms encode off the main/UI thread. One encoder is shared for all
// peers (identical frames fan out downstream), so this worker is a singleton.
import { flacReady } from './flacLoader.ts';
import { FlacStreamEncoder, type FlacParams } from './flacCodec.ts';

type InMsg =
  | { type: 'init'; params: FlacParams }
  | { type: 'block'; block: Int32Array }
  | { type: 'stop' };

let encoder: FlacStreamEncoder | null = null;

function emit(bytes: Uint8Array) {
  if (!bytes.length) return;
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  (self as unknown as Worker).postMessage({ type: 'frames', bytes: buf }, [buf]);
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    const flac = await flacReady();
    encoder = new FlacStreamEncoder(flac, msg.params);
  } else if (msg.type === 'block' && encoder) {
    emit(encoder.encodeBlock(msg.block));
  } else if (msg.type === 'stop' && encoder) {
    emit(encoder.finish());
    encoder = null;
  }
};
