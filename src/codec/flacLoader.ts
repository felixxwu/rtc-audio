// Browser-side loader for the libflacjs asm.js module. Imports the
// self-contained dist build for its side effect (its UMD wrapper attaches the
// module to the global as `Flac`), then resolves once it reports ready.
//
// The asm.js variant is used deliberately: no separate .wasm asset to fetch,
// so it bundles into the worker cleanly. Encode/decode is light enough that
// asm.js runs comfortably in real time.
import type { FlacModule } from './flacCodec.ts';

let cached: Promise<FlacModule> | null = null;

export function flacReady(): Promise<FlacModule> {
  if (cached) return cached;
  cached = (async () => {
    // Depending on how the bundler resolves libflacjs's UMD wrapper, the
    // module surfaces either as the default export or as a `Flac` global.
    // Accept whichever is present.
    const mod = (await import('libflacjs/dist/libflac.js')) as unknown as {
      default?: FlacModule;
      Flac?: FlacModule;
    };
    const flac: FlacModule =
      mod.default ??
      mod.Flac ??
      (globalThis as unknown as { Flac?: FlacModule }).Flac;
    if (!flac || typeof flac.isReady !== 'function') {
      throw new Error('libflacjs failed to load');
    }
    if (flac.isReady()) return flac;
    return new Promise<FlacModule>((resolve) =>
      flac.on('ready', () => resolve(flac))
    );
  })();
  return cached;
}
