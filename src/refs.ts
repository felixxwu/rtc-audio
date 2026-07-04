export const refs = {
  audio: new Audio(),
  audioContext: <AudioContext | null>null,
  gainNode: <GainNode | null>null,
  micGainNode: <GainNode | null>null,
  // Volume slider values live here so they survive VolumeControls
  // unmounting when the connection drops and reconnects.
  micVolume: 1,
  speakerVolume: 1,
  totalBytesReceived: 0,
  lastStatsTimestamp: 0,
  lastPacketsLost: 0,
  lastPacketsReceived: 0,
};
