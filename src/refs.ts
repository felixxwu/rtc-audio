import type firebase from 'firebase/app';
import { loadVolume } from './volumeStorage.ts';
import { loadInputDeviceId } from './audioInput.ts';
import { loadAudioCodec } from './audioCodec.ts';

export type Peer = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  // Pre-negotiated idle video channel: attaching/detaching a track here
  // starts/stops screen video for this pair only, no renegotiation.
  videoSender: RTCRtpSender;
  // Per-pair channel carrying collaborative-pointer positions.
  cursorChannel: RTCDataChannel;
  // Per-pair reliable, ordered channel for file transfers.
  fileChannel: RTCDataChannel;
  // Per-pair reliable, ordered channel carrying our lossless FLAC stream
  // (control JSON + binary frames). Pre-negotiated so any peer may start
  // sending FLAC without renegotiation.
  audioChannel: RTCDataChannel;
  videoStream: MediaStream | null;
  // Whether the remote peer asked to watch our shared screen.
  remoteWatching: boolean;
  // Whether the remote peer opened the full-screen view and wants full quality
  // (vs the downscaled thumbnail tier everyone gets by default).
  remoteFullQuality: boolean;
  connDoc: firebase.firestore.DocumentReference | null;
  audio: HTMLAudioElement;
  // The remote peer's inbound RTP MediaStream, retained so the lossless
  // receiver can restore it on the <audio> element when lossless stops.
  rtpStream: MediaStream | null;
  // Per-connection stats deltas (bitrate/loss/jitter are computed from the
  // previous report, per pc).
  stats: {
    bytes: number;
    bytesSent: number;
    videoBytes: number;
    videoBytesSent: number;
    dataBytes: number;
    dataBytesSent: number;
    // FLAC audio-channel baselines, tracked separately from cursor/file data
    // so lossless audio is reported as audio, not lumped into data/total only.
    audioDataBytes: number;
    audioDataBytesSent: number;
    // Latest computed per-peer audio rates (kb/s), for the participant tiles.
    inKbps: number;
    outKbps: number;
    ts: number;
    lost: number;
    received: number;
  };
  unsubscribes: (() => void)[];
  // Remote ICE candidates that arrived before the remote description was
  // set; flushed right after it is.
  pendingCandidates: RTCIceCandidateInit[];
};

// Minimal shape of a File System Access writable stream — declared locally
// so we don't depend on the API being in the TS lib.
export interface FileWritable {
  write(data: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface IncomingFile {
  from: string;
  id: string;
  name: string;
  size: number;
  mime: string;
  received: number;
  // In-memory fallback buffers (used only when streaming-to-disk isn't
  // available); empty when writing straight to disk.
  chunks: ArrayBuffer[];
  // When set, chunks stream to disk instead of accumulating in `chunks`.
  writable?: FileWritable | null;
  // Serialises disk writes in arrival order across async onmessage events.
  writeChain?: Promise<void>;
  status: 'offered' | 'accepted' | 'receiving' | 'done' | 'failed';
  // Local arrival order, for newest-first display.
  seq: number;
}

export interface OutgoingPeerState {
  status: 'offered' | 'queued' | 'sending' | 'done' | 'declined' | 'failed';
  sent: number;
}

export interface OutgoingFile {
  id: string;
  name: string;
  size: number;
  file: File;
  perPeer: Map<string, OutgoingPeerState>;
  // Local creation order, for newest-first display.
  seq: number;
}

export const refs = {
  peers: new Map<string, Peer>(),
  // Incoming file transfers keyed by `${fromPeerId}:${transferId}`.
  incomingFiles: new Map<string, IncomingFile>(),
  // Which incoming transfer is currently receiving binary chunks from each
  // peer (one active transfer per pair in v1).
  activeIncoming: new Map<string, string>(),
  // Outgoing transfers we've offered, keyed by transferId. Multiple can be
  // offered at once; sends to a given peer are serialised (one uplink).
  outgoingFiles: new Map<string, OutgoingFile>(),
  audioContext: <AudioContext | null>null,
  gainNode: <GainNode | null>null,
  micGainNode: <GainNode | null>null,
  micDestination: <MediaStreamAudioDestinationNode | null>null,
  micTrack: <MediaStreamTrack | null>null,
  // Raw input stream/source feeding the graph; swapped when the input device
  // changes (the outgoing micDestination track stays the same).
  micStream: <MediaStream | null>null,
  micSource: <MediaStreamAudioSourceNode | null>null,
  // Chosen input device (empty = system default), remembered across sessions.
  inputDeviceId: loadInputDeviceId(),
  // Tab/window audio shared via getDisplayMedia, mixed into the same
  // outgoing track as the mic.
  shareStream: <MediaStream | null>null,
  shareSource: <MediaStreamAudioSourceNode | null>null,
  shareGainNode: <GainNode | null>null,
  // Shared screen video (sent per pair, only to peers that ask to watch).
  shareVideoTrack: <MediaStreamTrack | null>null,
  // Other peers currently sharing video, from their presence docs.
  sharingPeers: new Set<string>(),
  // Peer ids (including our own) sorted by joinedAt, for letter assignment.
  participantOrder: <string[]>[],
  // When our own screen share started (client ms), 0 if not sharing. Used to
  // resolve exclusive sharing: the most recent share wins.
  mySharingSince: 0,
  // Volume slider values live here so they survive the controls unmounting
  // when the connection drops and reconnects. Seeded from localStorage so they
  // also survive across sessions.
  micVolume: loadVolume('mic'),
  shareVolume: loadVolume('share'),
  speakerVolume: loadVolume('speaker'),
  // Per-participant playback volume, keyed by peerId. Canonical source of
  // truth: the peer's <audio> element is recreated on every reconnect, so the
  // dialled-in level must live here to survive. Not persisted across sessions
  // (peer ids are per-session), but stable across a peer's reconnects.
  peerVolumes: new Map<string, number>(),
  // Outbound audio codec: 'opus' (RTP, default) or 'flac' (lossless over a
  // data channel). Transmit-only and unilateral; seeded from localStorage.
  audioCodec: loadAudioCodec(),
};

// Debug handle for poking at connections from the console in dev.
if (import.meta.env.DEV) {
  (window as unknown as { __refs: typeof refs }).__refs = refs;
}
