import { refs } from '../rtc/refs.ts';

const INPUT_DEVICE_KEY = 'rtc-audio:input-device';

// Music-first capture: no AGC/echo-cancel/noise-suppression/voice-isolation,
// 48kHz stereo to match Opus. deviceId targets a specific input (e.g. an
// interface's loopback channel) when one is chosen.
export function micConstraints(deviceId: string): MediaStreamConstraints {
  return {
    video: false,
    audio: {
      autoGainControl: false,
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      // Not in TS lib types yet; where supported, stops voice-focused
      // processing that hurts music.
      ...{ voiceIsolation: false },
      sampleRate: 48000,
      sampleSize: 16,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
}

export function loadInputDeviceId(): string {
  try {
    return localStorage.getItem(INPUT_DEVICE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveInputDeviceId(deviceId: string) {
  try {
    if (deviceId) localStorage.setItem(INPUT_DEVICE_KEY, deviceId);
    else localStorage.removeItem(INPUT_DEVICE_KEY);
  } catch {
    // Storage unavailable — selection just won't persist.
  }
}

let micPending: Promise<void> | null = null;

// Open the mic and wire it into the (already built) audio graph. Called on the
// first unmute so the permission prompt only appears then. Idempotent and safe
// to call concurrently; rejects with the getUserMedia error.
export function ensureMic(): Promise<void> {
  if (refs.micStream) return Promise.resolve();
  micPending ??= openMic().finally(() => {
    micPending = null;
  });
  return micPending;
}

async function openMic() {
  if (!refs.audioContext || !refs.micGainNode) {
    throw new Error('Audio is not enabled yet.');
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new MicUnavailableError();
  }
  // Use the remembered input device (e.g. an interface loopback) if one was
  // chosen; otherwise the system default. Falls back to default if the
  // remembered device is no longer available.
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(
      micConstraints(refs.inputDeviceId)
    );
  } catch (deviceError) {
    if (!refs.inputDeviceId) throw deviceError;
    // The remembered device is gone — clear it (and its persisted copy) so we
    // don't retry the dead device on every future reload.
    refs.inputDeviceId = '';
    saveInputDeviceId('');
    stream = await navigator.mediaDevices.getUserMedia(micConstraints(''));
  }
  const source = refs.audioContext.createMediaStreamSource(stream);
  source.connect(refs.micGainNode);
  // Kept so the input device can be swapped later without renegotiation.
  refs.micStream = stream;
  refs.micSource = source;
}

// Swap the input device feeding the mic graph. The outgoing track comes from
// micDestination, which stays wired, so this needs no renegotiation and mic
// mute/volume keep working. Throws if the device can't be opened.
export async function switchInputDevice(deviceId: string) {
  if (!refs.audioContext || !refs.micGainNode) return;
  if (!refs.micStream) {
    // Mic not opened yet (first unmute pending): just remember the choice so
    // ensureMic opens it, without triggering the permission prompt now.
    refs.inputDeviceId = deviceId;
    saveInputDeviceId(deviceId);
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia(
    micConstraints(deviceId)
  );
  const source = refs.audioContext.createMediaStreamSource(stream);
  source.connect(refs.micGainNode);
  refs.micSource?.disconnect();
  refs.micStream?.getTracks().forEach((track) => track.stop());
  refs.micSource = source;
  refs.micStream = stream;
  refs.inputDeviceId = deviceId;
  saveInputDeviceId(deviceId);
}

// getUserMedia doesn't exist — insecure (http) context or an unsupported
// browser, since a secure context always exposes it.
export class MicUnavailableError extends Error {
  constructor() {
    super('MicUnavailable');
    this.name = 'MicUnavailableError';
  }
}

// Turn a getUserMedia rejection into something a user can act on. The error
// name is a stable, spec-defined enum; the raw .message is browser-specific
// and too technical to show.
export function friendlyMicError(e: unknown): string {
  const name = (e as Error).name;
  switch (name) {
    case 'MicUnavailableError':
    case 'NotSupportedError':
      return (
        "This browser can't access a microphone. Use a recent browser over " +
        'a secure (https) connection.'
      );
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        'Microphone access was blocked. Please allow microphone access in ' +
        'your browser settings and try again.'
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Please connect one and try again.';
    case 'NotReadableError':
      return (
        "Your microphone couldn't be started — it may be in use by another " +
        'app. Close anything else using it and try again.'
      );
    default:
      return "Couldn't enable audio. Please check your microphone and try again.";
  }
}
