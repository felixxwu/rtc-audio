import type firebase from 'firebase/app';

export type Peer = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  // Pre-negotiated idle video channel: attaching/detaching a track here
  // starts/stops screen video for this pair only, no renegotiation.
  videoSender: RTCRtpSender;
  // Per-pair channel carrying collaborative-pointer positions.
  cursorChannel: RTCDataChannel;
  videoStream: MediaStream | null;
  // Whether the remote peer asked to watch our shared screen.
  remoteWatching: boolean;
  connDoc: firebase.firestore.DocumentReference | null;
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
  // Shared screen video (sent per pair, only to peers that ask to watch).
  shareVideoTrack: <MediaStreamTrack | null>null,
  // Other peers currently sharing video, from their presence docs.
  sharingPeers: new Set<string>(),
  // When our own screen share started (client ms), 0 if not sharing. Used to
  // resolve exclusive sharing: the most recent share wins.
  mySharingSince: 0,
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
