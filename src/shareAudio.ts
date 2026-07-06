import { refs } from './refs.ts';
import { updateTransmission } from './transmission.ts';
import { setSharingPresence, updateVideoTransmission } from './room.ts';

// Callback to reset the share UI, so a forced stop (someone else took over
// sharing) resets it the same way the browser's own "Stop sharing" does.
let onShareEnded: (() => void) | null = null;

// Thrown when the user picks a surface that provided neither audio nor
// video (e.g. dismissed permissions mid-way).
export class NoAudioTrackError extends Error {
  constructor() {
    super('The selected tab or window provided no audio or video.');
    this.name = 'NoAudioTrackError';
  }
}

// Capture a tab's or window's audio and screen video via the share picker.
// Audio is mixed into the outgoing track alongside the mic; video is held
// locally and only transmitted, per pair, to peers who ask to watch
// (see updateVideoTransmission).
export async function startShareAudio(onEnded: () => void) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      // Sheet music / DAW views are mostly static: a low frame rate keeps
      // the bandwidth negligible next to the music stream.
      frameRate: { ideal: 10, max: 15 },
    },
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

  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];
  if (!audioTrack && !videoTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new NoAudioTrackError();
  }

  const audioContext = refs.audioContext;
  const micDestination = refs.micDestination;
  if (!audioContext || !micDestination) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Audio is not enabled yet.');
  }

  onShareEnded = onEnded;

  // Fires when the user clicks the browser's own "Stop sharing" UI.
  const handleEnded = () => {
    stopShareAudio();
    onEnded();
  };

  if (audioTrack) {
    const audioStream = new MediaStream([audioTrack]);
    refs.shareStream = audioStream;
    refs.shareSource = audioContext.createMediaStreamSource(audioStream);
    refs.shareGainNode = audioContext.createGain();
    refs.shareGainNode.gain.value = refs.shareVolume;
    refs.shareSource.connect(refs.shareGainNode);
    refs.shareGainNode.connect(micDestination);
    audioTrack.addEventListener('ended', handleEnded);
  }

  if (videoTrack) {
    // Favor sharp text over smooth motion — this is a screen, not a camera.
    videoTrack.contentHint = 'detail';
    refs.shareVideoTrack = videoTrack;
    videoTrack.addEventListener('ended', handleEnded);
  }

  setSharingPresence(!!videoTrack);
  updateTransmission();
  updateVideoTransmission();
}

// Stop our share because another peer's took over, resetting the UI as if
// the user had stopped it themselves.
export function forceStopShare() {
  const notify = onShareEnded;
  stopShareAudio();
  notify?.();
}

export function stopShareAudio() {
  onShareEnded = null;
  refs.shareStream?.getTracks().forEach((track) => track.stop());
  refs.shareSource?.disconnect();
  refs.shareGainNode?.disconnect();
  refs.shareStream = null;
  refs.shareSource = null;
  refs.shareGainNode = null;
  refs.shareVideoTrack?.stop();
  refs.shareVideoTrack = null;
  setSharingPresence(false);
  updateTransmission();
  updateVideoTransmission();
}
