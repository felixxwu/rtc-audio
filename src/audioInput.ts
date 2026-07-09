import { refs } from './refs.ts';

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

// Swap the input device feeding the mic graph. The outgoing track comes from
// micDestination, which stays wired, so this needs no renegotiation and mic
// mute/volume keep working. Throws if the device can't be opened.
export async function switchInputDevice(deviceId: string) {
  if (!refs.audioContext || !refs.micGainNode) return;
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
