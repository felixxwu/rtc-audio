import type firebase from 'firebase/app';
import { loadVolume } from '../audio/volumeStorage.ts';
import { loadInputDeviceId } from '../audio/audioInput.ts';
import { loadAudioCodec } from '../codec/audioCodec.ts';

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
  // Per-pair reliable, ordered channel for text chat and typing notifications.
  chatChannel?: RTCDataChannel;
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

// A blob this peer holds and can serve on request, keyed by the file
// message's id (`msgId`). Only the original sender holds one (no seeding yet).
export interface HeldFile {
  file: File;
}

// A download this peer is pulling from a holder, keyed by msgId.
export interface IncomingTransfer {
  msgId: string;
  from: string;
  name: string;
  size: number;
  mime: string;
  received: number;
  chunks: ArrayBuffer[];
  writable?: FileWritable | null;
  writeChain?: Promise<void>;
  status: 'idle' | 'receiving' | 'done' | 'failed' | 'unavailable';
}

export const refs = {
  peers: new Map<string, Peer>(),
  // Blobs we can serve, keyed by msgId (sender side).
  heldFiles: new Map<string, HeldFile>(),
  // Downloads in progress, keyed by msgId (receiver side).
  incomingTransfers: new Map<string, IncomingTransfer>(),
  // Which msgId is currently streaming from each peer (one uplink each way).
  activeIncoming: new Map<string, string>(),
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

// The first video track of a peer's shared-screen stream, or null if that peer
// isn't sharing (or we have no connection to them yet).
export function peerVideoTrack(id: string): MediaStreamTrack | null {
  return refs.peers.get(id)?.videoStream?.getVideoTracks()[0] ?? null;
}

// The peer whose screen share is currently active, or null if none. Exclusive
// sharing is an invariant (room.ts keeps at most one active sharer), so readers
// take the single member rather than reconstructing "first of set" ad hoc.
export function currentSharerId(): string | null {
  for (const id of refs.sharingPeers) return id;
  return null;
}

// Debug handle for poking at connections from the console in dev.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __refs: typeof refs }).__refs = refs;
}
