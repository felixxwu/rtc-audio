// Streaming FLAC encode/decode shared by the encoder Worker (send side) and
// the per-peer receiver (playback side). Built on libflacjs's high-level
// Encoder/Decoder helpers. libflacjs accumulates output internally; the
// Drain* subclasses expose the protected clearData() so we can pull each
// call's bytes and free them (real-time streaming, not one big buffer).
//
// This module drives libflacjs's low-level C-style API directly, taking the
// loaded `Flac` module as a parameter. It deliberately does NOT import
// libflacjs's `lib/encoder`/`lib/decoder` helpers: their UMD wrappers pass
// `require` as a function argument, which Vite's dev dependency optimizer
// (esbuild) cannot resolve ("Dynamic require of ./utils/data-utils"). Loading
// the module is the job of flacLoader.ts (browser) / the test's factory (Node).

// libflacjs ships types only through its Node factory, which we can't import
// here; the module handle is typed loosely and its use is pinned by
// flacCodec.test.ts (the lossless round-trip contract).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlacModule = any;

export type FlacParams = {
  sampleRate: number;
  channels: number;
  blockSize: number;
};

// One decoded channel arrives as raw little-endian 16-bit sample bytes.
function int16BytesToInt32(bytes: Uint8Array): Int32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.byteLength >> 1;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

export class FlacStreamEncoder {
  private id: number;
  private out: Uint8Array[] = [];
  private channels: number;

  constructor(flac: FlacModule, params: FlacParams) {
    this.flac = flac;
    this.channels = params.channels;
    this.id = flac.create_libflac_encoder(
      params.sampleRate,
      params.channels,
      16, // bitsPerSample
      8, // compression level
      0, // totalSamples unknown (streaming)
      false // verify
    );
    if (!this.id) throw new Error('FLAC encoder creation failed');
    // write callback reuses its buffer, so copy each chunk out.
    const onWrite = (data: Uint8Array) => this.out.push(data.slice());
    const state = flac.init_encoder_stream(this.id, onWrite);
    if (state !== 0) throw new Error('FLAC encoder init failed: ' + state);
  }

  private flac: FlacModule;

  // Encode one interleaved block; returns the FLAC bytes newly produced (the
  // first non-empty result carries the STREAMINFO header).
  encodeBlock(interleaved: Int32Array): Uint8Array {
    const frames = interleaved.length / this.channels;
    const ok = this.flac.FLAC__stream_encoder_process_interleaved(
      this.id,
      interleaved,
      frames
    );
    if (!ok) throw new Error('FLAC encode failed');
    return this.drain();
  }

  finish(): Uint8Array {
    this.flac.FLAC__stream_encoder_finish(this.id);
    const bytes = this.drain();
    this.flac.FLAC__stream_encoder_delete(this.id);
    return bytes;
  }

  private drain(): Uint8Array {
    const bytes = concat(this.out);
    this.out = [];
    return bytes;
  }
}

// The read side of libFLAC's pull model reports 0 bytes as END_OF_STREAM, so a
// naive "return what's left" read callback would terminate the stream the
// moment its buffer drained mid-frame. This mirrors libflacjs's own chunked
// strategy: buffer input chunks, only drive the decoder once a threshold is
// buffered, and pause (rather than return 0) when the cache empties so the
// next chunk resumes the in-progress frame.
export class FlacStreamDecoder {
  private id: number;
  private inputCache: Uint8Array[] = [];
  private offset = 0;
  private paused = true;
  private blocks: Int32Array[][] = [];
  // Somewhat greater than 1024 (matches libflacjs's default).
  private readonly threshold = 2048;

  constructor(private flac: FlacModule) {
    this.id = flac.create_libflac_decoder();
    if (!this.id) throw new Error('FLAC decoder creation failed');
    const onRead = (bufferSize: number) => this.read(bufferSize);
    const onWrite = (channels: Uint8Array[]) => {
      this.blocks.push(channels.map(int16BytesToInt32));
    };
    const onError = (code: number, description: string) =>
      console.error('FLAC decode error', code, description);
    const onMeta = () => {};
    const state = flac.init_decoder_stream(
      this.id,
      onRead,
      onWrite,
      onError,
      onMeta
    );
    if (state !== 0) throw new Error('FLAC decoder init failed: ' + state);
  }

  private read(bufferSize: number): {
    buffer: Uint8Array | undefined;
    readDataLength: number;
    error: boolean;
  } {
    if (!this.inputCache.length) {
      return { buffer: undefined, readDataLength: 0, error: false };
    }
    const chunk = this.inputCache[0];
    const size = chunk.byteLength;
    const start = this.offset;
    const end = start === size ? -1 : Math.min(start + bufferSize, size);
    let buffer: Uint8Array | undefined;
    let read = 0;
    if (end !== -1) {
      buffer = chunk.subarray(start, end);
      read = end - start;
      this.offset = end;
    }
    if (read < bufferSize) {
      this.inputCache.shift(); // active chunk consumed
      this.offset = 0;
      const nextSize = this.inputCache.length ? this.inputCache[0].byteLength : 0;
      if (nextSize === 0) this.paused = true; // no more data -> pause, don't EOS
    }
    return { buffer, readDataLength: read, error: false };
  }

  private drive(): Int32Array[][] {
    this.blocks = [];
    this.paused = false;
    let decState = 0;
    while (!this.paused && decState <= 3) {
      if (!this.flac.FLAC__stream_decoder_process_single(this.id)) break;
      decState = this.flac.FLAC__stream_decoder_get_state(this.id);
    }
    return this.blocks.splice(0);
  }

  decodeChunk(bytes: Uint8Array): Int32Array[][] {
    this.inputCache.push(bytes);
    const buffered = this.inputCache.reduce((sum, c) => sum + c.byteLength, 0);
    if (buffered < this.threshold) return []; // wait for more
    return this.drive();
  }

  finish(): Int32Array[][] {
    const out = this.drive(); // flush whatever remains
    this.flac.FLAC__stream_decoder_finish(this.id);
    this.flac.FLAC__stream_decoder_delete(this.id);
    return out;
  }
}
