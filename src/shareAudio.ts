import { refs } from './refs.ts';
import { updateTransmission } from './transmission.ts';

// Thrown when the user picks a surface without ticking "Also share audio"
// (or picks a surface that can't provide audio at all).
export class NoAudioTrackError extends Error {
  constructor() {
    super('The selected tab or window did not include audio.');
    this.name = 'NoAudioTrackError';
  }
}

// Capture a tab's or window's audio via the screen-share picker and mix it
// into the outgoing track alongside the mic. Video is requested only because
// the picker requires it; the track is stopped immediately.
export async function startShareAudio(onEnded: () => void) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      sampleRate: 48000,
      // When capturing system audio, filter out sound this page plays
      // (the remote peer's voice) so it doesn't loop back to them.
      ...{ restrictOwnAudio: true },
    },
    // Not in TS lib types yet. Ask for per-window audio where the OS
    // supports it, offer system audio otherwise, and hide this app's own
    // tab from the picker.
    ...{
      windowAudio: 'window',
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    },
  });

  // Only the audio is wanted; drop the mandatory video track right away.
  stream.getVideoTracks().forEach((track) => track.stop());

  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new NoAudioTrackError();
  }

  const audioContext = refs.audioContext;
  const micDestination = refs.micDestination;
  if (!audioContext || !micDestination) {
    audioTrack.stop();
    throw new Error('Audio is not enabled yet.');
  }

  const audioStream = new MediaStream([audioTrack]);
  refs.shareStream = audioStream;
  refs.shareSource = audioContext.createMediaStreamSource(audioStream);
  refs.shareGainNode = audioContext.createGain();
  refs.shareGainNode.gain.value = refs.shareVolume;
  refs.shareSource.connect(refs.shareGainNode);
  refs.shareGainNode.connect(micDestination);

  // Fires when the user clicks the browser's own "Stop sharing" UI.
  audioTrack.addEventListener('ended', () => {
    stopShareAudio();
    onEnded();
  });

  updateTransmission();
}

export function stopShareAudio() {
  refs.shareStream?.getTracks().forEach((track) => track.stop());
  refs.shareSource?.disconnect();
  refs.shareGainNode?.disconnect();
  refs.shareStream = null;
  refs.shareSource = null;
  refs.shareGainNode = null;
  updateTransmission();
}
