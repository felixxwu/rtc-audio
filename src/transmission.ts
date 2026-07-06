import { refs } from './refs.ts';

// When nothing audible is being sent, stop transmitting entirely instead of
// sending encoded silence — frees the full upstream (CBR + RED never dips on
// quiet audio), which helps the incoming stream on weak connections. Applies
// to every peer's sender; also called when a new peer joins so it inherits
// the current mute state.
export function updateTransmission() {
  const shouldSend =
    refs.micVolume > 0 || (refs.shareStream !== null && refs.shareVolume > 0);
  for (const peer of refs.peers.values()) {
    const isSending = peer.sender.track !== null;
    if (shouldSend !== isSending) {
      peer.sender
        .replaceTrack(shouldSend ? refs.micTrack : null)
        .catch(console.error);
    }
  }
}
