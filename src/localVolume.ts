import { refs } from './refs.ts';
import { saveVolume } from './volumeStorage.ts';
import { reconcileTransmission } from './losslessSender.ts';

// Apply an outgoing-audio volume change end to end: record it in refs (so it
// survives the controls unmounting on reconnect), drive the live gain node,
// persist it, and reconcile transmission (the lossless sender skips a fully
// muted source). Shared by the mic and shared-audio sliders.
export function applyMicVolume(volume: number) {
  refs.micVolume = volume;
  if (refs.micGainNode) refs.micGainNode.gain.value = volume;
  saveVolume('mic', volume);
  reconcileTransmission();
}

export function applyShareVolume(volume: number) {
  refs.shareVolume = volume;
  if (refs.shareGainNode) refs.shareGainNode.gain.value = volume;
  saveVolume('share', volume);
  reconcileTransmission();
}
