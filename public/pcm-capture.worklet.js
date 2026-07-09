// AudioWorklet processor, served as a static asset (see losslessSender.ts).
// Plain JS on purpose: worklets load as a single standalone script, and a
// bundler-referenced .ts gets mis-served (wrong MIME / untranspiled) in a
// production build.
//
// Runs on the audio render thread. Copies each 128-frame quantum of the tapped
// mix (mic + share, post-gain) to the main thread for FLAC encoding. Copies
// are required: the input buffers are reused by the engine after process().
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const copy = input.map((channel) => channel.slice());
      this.port.postMessage(copy);
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
