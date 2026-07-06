export type Peer = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  audio: HTMLAudioElement;
  // Per-connection stats deltas (bitrate/loss/jitter are computed from the
  // previous report, per pc).
  stats: {
    bytes: number;
    bytesSent: number;
    ts: number;
    lost: number;
    received: number;
  };
  unsubscribes: (() => void)[];
  // Remote ICE candidates that arrived before the remote description was
  // set; flushed right after it is.
  pendingCandidates: RTCIceCandidateInit[];
};

export const refs = {
  peers: new Map<string, Peer>(),
  audioContext: <AudioContext | null>null,
  gainNode: <GainNode | null>null,
  micGainNode: <GainNode | null>null,
  micDestination: <MediaStreamAudioDestinationNode | null>null,
  micTrack: <MediaStreamTrack | null>null,
  // Tab/window audio shared via getDisplayMedia, mixed into the same
  // outgoing track as the mic.
  shareStream: <MediaStream | null>null,
  shareSource: <MediaStreamAudioSourceNode | null>null,
  shareGainNode: <GainNode | null>null,
  // Volume slider values live here so they survive VolumeControls
  // unmounting when the connection drops and reconnects.
  micVolume: 1,
  shareVolume: 1,
  speakerVolume: 1,
};

// Debug handle for poking at connections from the console in dev.
if (import.meta.env.DEV) {
  (window as unknown as { __refs: typeof refs }).__refs = refs;
}
