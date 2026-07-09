/// <reference lib="dom" />
// Runs on the audio render thread. Copies each 128-frame quantum of the tapped
// mix (mic + share, post-gain) to the main thread for FLAC encoding. Copies
// are required: the input buffers are reused by the engine after process().
declare const registerProcessor: (name: string, ctor: unknown) => void;
declare const AudioWorkletProcessor: {
  new (): { readonly port: MessagePort };
};

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const copy = input.map((channel) => channel.slice());
      this.port.postMessage(copy);
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
