import firebase from 'firebase/app';
import { firestore } from './firebase.ts';
import { enhanceAudioSdp, servers } from './pc.ts';
import { refs, type Peer } from './refs.ts';
import { releaseMeter } from './audioLevels.ts';
import { updateTransmission } from './transmission.ts';
import { keepAwake } from './wakeLock.ts';
import { cursors, handleCursorMessage } from './cursors.ts';
import { forceStopShare } from './shareAudio.ts';
import {
  handleFileMessage,
  peerDisconnected,
  reofferTo,
} from './fileTransfer.ts';
import { onAudioChannelOpen } from './losslessSender.ts';
import { handleAudioMessage, teardownReceiver } from './losslessReceiver.ts';

// Lives for the lifetime of the tab; a rejoin after reload is a new peer.
export const myPeerId = crypto.randomUUID();

const MAX_RESTARTS = 3;
// Presence heartbeat: each peer refreshes lastSeen this often; a peer whose
// lastSeen falls this far behind ours (and whose connection isn't live) is
// treated as gone. The threshold tolerates a couple of missed beats.
const HEARTBEAT_MS = 15000;
const STALE_MS = 35000;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

// Firestore TTL cleanup: every doc is stamped with expireAt so stale session
// data self-deletes (enable a TTL policy on the `expireAt` field for each
// collection group in the Firebase console). The window is far longer than
// any real session; presence docs refresh it on each heartbeat.
const TTL_MS = 24 * 60 * 60 * 1000;
const expireAt = () => new Date(Date.now() + TTL_MS);

type Timestamp = firebase.firestore.Timestamp;
type DocRef = firebase.firestore.DocumentReference;
type CollectionRef = firebase.firestore.CollectionReference;

// Room size for picking the Opus bitrate tier when negotiating with `peerId`:
// us, them, and everyone else we have a LIVE connection to. Deliberately not
// based on presence docs or the whole peer map — ungraceful exits leave
// orphaned presence behind forever, and counting those would sink a 2-person
// room to the 3-person tier after every phone drop.
const roomSizeFor = (peerId: string) =>
  2 +
  [...refs.peers.entries()].filter(
    ([id, peer]) => id !== peerId && peer.pc.connectionState === 'connected'
  ).length;

// Everything the old singleton pc got: mixed local track, DSCP priority,
// RED > Opus codec preference, music content hint (set on the track itself
// in EnableAudio), and jitter-buffer tuning on the receiver.
function createPeer(peerId: string) {
  const pc = new RTCPeerConnection(servers);
  const sender = pc.addTrack(refs.micTrack!, refs.micDestination!.stream);

  // Mark audio packets high priority (DSCP) so they win under network
  // contention. No-op in browsers that don't support it.
  const params = sender.getParameters();
  params.encodings.forEach((encoding) => {
    encoding.priority = 'high';
    encoding.networkPriority = 'high';
  });
  sender.setParameters(params).catch((e) => console.error(e));

  // Prefer RED (in-band redundancy — strong packet loss protection) with
  // Opus next, and drop low-quality fallbacks (PCMU/PCMA etc.).
  pc.getTransceivers().forEach((transceiver) => {
    if (
      transceiver.sender.track?.kind !== 'audio' ||
      !('setCodecPreferences' in transceiver)
    ) {
      return;
    }
    const codecs = RTCRtpReceiver.getCapabilities('audio')?.codecs ?? [];
    const byMimeType = (mimeType: string) =>
      codecs.filter((c) => c.mimeType.toLowerCase() === mimeType);
    const preferred = [
      ...byMimeType('audio/red'),
      ...byMimeType('audio/opus'),
    ];
    if (preferred.length) transceiver.setCodecPreferences(preferred);
  });

  // Idle video channel for on-demand screen sharing. Negotiated up front
  // (costs nothing while unused) so starting video for one viewer later is
  // replaceTrack on this pair only — no renegotiation, no other pairs
  // spending bandwidth.
  const videoSender = pc.addTransceiver('video', {
    direction: 'sendrecv',
  }).sender;

  // Collaborative-pointer channel, negotiated up front with a fixed id so
  // both sides open it without renegotiation. Unreliable + unordered: a
  // cursor position is stale the instant the next one is sent.
  const cursorChannel = pc.createDataChannel('cursors', {
    negotiated: true,
    id: 0,
    ordered: false,
    maxRetransmits: 0,
  });
  cursorChannel.onmessage = (event) => handleCursorMessage(peerId, event.data);

  // Reliable, ordered channel for file transfers (id 1). arraybuffer so
  // binary chunks arrive as ArrayBuffer rather than Blob.
  const fileChannel = pc.createDataChannel('files', {
    negotiated: true,
    id: 1,
    ordered: true,
  });
  fileChannel.binaryType = 'arraybuffer';
  fileChannel.onmessage = (event) => handleFileMessage(peerId, event.data);
  // A peer that connects after a file was offered gets the still-pending
  // offers once its channel opens.
  fileChannel.onopen = () => reofferTo(peerId);

  // Lossless FLAC audio channel (id 2). Reliable + ordered so the stream is
  // truly lossless; retransmit latency is absorbed by the receiver's buffer.
  const audioChannel = pc.createDataChannel('audio', {
    negotiated: true,
    id: 2,
    ordered: true,
  });
  audioChannel.binaryType = 'arraybuffer';
  audioChannel.onmessage = (event) => handleAudioMessage(peerId, event.data);
  // If we're already streaming lossless when this peer connects, start sending.
  audioChannel.onopen = () => onAudioChannelOpen(peerId);

  const audio = new Audio();
  audio.autoplay = true;
  // Inherit the current slider value — a peer joining after the speaker was
  // lowered must not play at full volume.
  audio.volume = refs.speakerVolume;

  pc.ontrack = (event) => {
    if (event.track.kind === 'video') {
      entry.videoStream = new MediaStream([event.track]);
      return;
    }
    // Prefer stability over latency: buffer up to 500ms rather than glitch
    // on jitter — right trade-off for one-way music streaming.
    if ('jitterBufferTarget' in event.receiver) {
      event.receiver.jitterBufferTarget = 500;
    } else if ('playoutDelayHint' in event.receiver) {
      // legacy equivalent, in seconds
      (event.receiver as { playoutDelayHint?: number }).playoutDelayHint = 0.5;
    }
    entry.rtpStream = event.streams[0];
    // Don't override lossless playback if this peer is streaming FLAC (the
    // receiver has swapped its own MediaStream onto the element).
    if (audio.srcObject === null || audio.srcObject === entry.rtpStream) {
      audio.srcObject = event.streams[0];
    }
  };

  const entry = {
    pc,
    sender,
    videoSender,
    cursorChannel,
    fileChannel,
    audioChannel,
    videoStream: <MediaStream | null>null,
    remoteWatching: false,
    remoteFullQuality: false,
    connDoc: <firebase.firestore.DocumentReference | null>null,
    audio,
    rtpStream: <MediaStream | null>null,
    stats: {
      bytes: 0,
      bytesSent: 0,
      videoBytes: 0,
      videoBytesSent: 0,
      dataBytes: 0,
      dataBytesSent: 0,
      audioDataBytes: 0,
      audioDataBytesSent: 0,
      ts: 0,
      lost: 0,
      received: 0,
    },
    unsubscribes: <(() => void)[]>[],
    // Remote ICE candidates can arrive (or already exist in Firestore)
    // before the remote description is set — adding them then throws and
    // they'd be lost. Buffer until flushed after setRemoteDescription.
    pendingCandidates: <RTCIceCandidateInit[]>[],
  };
  refs.peers.set(peerId, entry);
  // A muted mic (or no active share) means the new sender should start
  // detached, like everyone else's.
  updateTransmission();
  return entry;
}

// Attach the shared screen track to exactly the pairs whose remote peer
// asked to watch; detach everywhere else. Screen content: cap the bitrate
// and prefer sharp text over frame rate.
export function updateVideoTransmission() {
  for (const entry of refs.peers.values()) {
    const track =
      entry.remoteWatching && refs.shareVideoTrack
        ? refs.shareVideoTrack
        : null;
    if (entry.videoSender.track !== track) {
      entry.videoSender.replaceTrack(track).catch(console.error);
    }
    // Set the encoding tier every time (not just on track change) so a pair
    // can be bumped between thumbnail and full quality without detaching.
    // Full: native resolution, 500 kbps. Thumbnail: quarter resolution each
    // axis, 150 kbps — plenty for a ~280px box, a fraction of the bandwidth.
    if (track) {
      const params = entry.videoSender.getParameters();
      params.degradationPreference = 'maintain-resolution';
      const full = entry.remoteFullQuality;
      params.encodings.forEach((encoding) => {
        encoding.maxBitrate = full ? 500_000 : 150_000;
        encoding.scaleResolutionDownBy = full ? 1 : 4;
      });
      entry.videoSender.setParameters(params).catch(console.error);
    }
  }
}

// Ask (or stop asking) `peerId` to send us their shared screen.
export function setWatching(peerId: string, watching: boolean) {
  refs.peers
    .get(peerId)
    ?.connDoc?.update({ [`watching.${myPeerId}`]: watching })
    .catch(console.error);
}

// Ask `peerId` for full-quality (vs thumbnail) video — set while we have their
// share open full-screen.
export function setFullQuality(peerId: string, full: boolean) {
  refs.peers
    .get(peerId)
    ?.connDoc?.update({ [`fullQuality.${myPeerId}`]: full })
    .catch(console.error);
}

let myPresenceDoc: firebase.firestore.DocumentReference | null = null;

// Advertise on our presence doc that a screen share is available to watch,
// stamped with when it started so the most recent share wins.
export function setSharingPresence(sharing: boolean) {
  refs.mySharingSince = sharing ? Date.now() : 0;
  myPresenceDoc
    ?.update({ sharing, sharingSince: refs.mySharingSince })
    .catch(console.error);
}

function applyRemoteWatching(
  entry: Peer,
  data: firebase.firestore.DocumentData,
  remotePeerId: string
) {
  entry.remoteWatching = !!data.watching?.[remotePeerId];
  entry.remoteFullQuality = !!data.fullQuality?.[remotePeerId];
  updateVideoTransmission();
}

function addRemoteCandidate(entry: Peer, data: RTCIceCandidateInit) {
  if (entry.pc.remoteDescription) {
    entry.pc.addIceCandidate(new RTCIceCandidate(data)).catch(console.error);
  } else {
    entry.pendingCandidates.push(data);
  }
}

function flushPendingCandidates(entry: Peer) {
  entry.pendingCandidates.splice(0).forEach((data) => {
    entry.pc.addIceCandidate(new RTCIceCandidate(data)).catch(console.error);
  });
}

export function closePeer(peerId: string) {
  const entry = refs.peers.get(peerId);
  if (!entry) return;
  entry.unsubscribes.forEach((unsubscribe) => unsubscribe());
  entry.pc.oniceconnectionstatechange = null;
  teardownReceiver(peerId);
  entry.pc.close();
  entry.audio.srcObject = null;
  refs.peers.delete(peerId);
  releaseMeter(peerId);
  cursors.delete(peerId);
  peerDisconnected(peerId);
}

// Offerer side of one pair: publish (and republish after ICE restarts) the
// offer, stream candidates, apply answers. Recovery runs here only — after
// MAX_RESTARTS failed attempts the pair is closed, but the other peer's
// presence doc is left alone (a single failing pair can be an asymmetric
// routing issue while their other connections are healthy).
async function offerTo(peerId: string, connectionsCol: CollectionRef) {
  const entry = createPeer(peerId);
  // Both sides derive this ID without coordination.
  const connDoc = connectionsCol.doc(`${myPeerId}_${peerId}`);
  entry.connDoc = connDoc;

  entry.pc.onicecandidate = (event) => {
    if (event.candidate) {
      connDoc.collection('offerCandidates').add({
        ...event.candidate.toJSON(),
        expireAt: expireAt(),
      });
    }
  };

  const publishOffer = async (initial: boolean) => {
    const offerDescription = await entry.pc.createOffer();
    if (offerDescription.sdp) {
      offerDescription.sdp = enhanceAudioSdp(
        offerDescription.sdp,
        roomSizeFor(peerId)
      );
    }
    await entry.pc.setLocalDescription(offerDescription);

    const offer = { sdp: offerDescription.sdp, type: offerDescription.type };
    if (initial) {
      await connDoc.set({
        offererId: myPeerId,
        answererId: peerId,
        offer,
        expireAt: expireAt(),
      });
    } else {
      await connDoc.update({ offer });
    }
  };

  await publishOffer(true);

  // Recover from drops: if ICE fails, stays disconnected, or never gets
  // connected at all, restart it and publish a fresh offer for the answerer
  // to re-answer. The deadline timer matters for two cases ICE events alone
  // never cover: a pair stuck in 'checking' (Chrome can sit there without
  // ever reporting 'failed'), and restart offers to a departed peer that
  // nobody will answer.
  let restarts = 0;
  let disconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimeout: ReturnType<typeof setTimeout> | undefined;
  const armDeadline = () => {
    clearTimeout(deadlineTimeout);
    deadlineTimeout = setTimeout(() => {
      const state = entry.pc.iceConnectionState;
      if (state !== 'connected' && state !== 'completed') restart();
    }, 15000);
  };
  const restart = () => {
    if (restarts >= MAX_RESTARTS) {
      closePeer(peerId);
      return;
    }
    restarts++;
    entry.pc.restartIce();
    publishOffer(false).catch(console.error);
    armDeadline();
  };
  entry.pc.oniceconnectionstatechange = () => {
    clearTimeout(disconnectTimeout);
    const state = entry.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      restarts = 0;
      clearTimeout(deadlineTimeout);
    } else if (state === 'failed') {
      restart();
    } else if (state === 'disconnected') {
      // 'disconnected' often self-heals; only restart if it persists.
      disconnectTimeout = setTimeout(restart, 5000);
    }
  };
  armDeadline();

  entry.unsubscribes.push(
    // Remote answers, including re-answers after an ICE restart.
    connDoc.onSnapshot((snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      applyRemoteWatching(entry, data, peerId);
      // Only apply an answer when we're actually waiting for one. The doc
      // snapshot re-fires on any field change (watching, expireAt, re-answers
      // after an ICE restart), and currentRemoteDescription only updates once
      // the async setRemoteDescription resolves — so without the signaling-
      // state guard a re-fire or race would re-apply an answer while already
      // 'stable', which throws "Called in wrong state: stable".
      if (
        data.answer &&
        entry.pc.signalingState === 'have-local-offer' &&
        data.answer.sdp !== entry.pc.currentRemoteDescription?.sdp
      ) {
        entry.pc
          .setRemoteDescription(new RTCSessionDescription(data.answer))
          .then(() => flushPendingCandidates(entry))
          .catch(console.error);
      }
    }),
    connDoc.collection('answerCandidates').onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') addRemoteCandidate(entry, change.doc.data());
      });
    }),
    () => {
      clearTimeout(disconnectTimeout);
      clearTimeout(deadlineTimeout);
    }
  );
}

// Answerer side of one pair: on the first offer, create the pc and candidate
// plumbing; on every new offer SDP (ICE restart), re-answer.
async function answerOffer(
  offererId: string,
  connDoc: DocRef,
  offer: RTCSessionDescriptionInit
) {
  let entry = refs.peers.get(offererId);
  if (!entry) {
    entry = createPeer(offererId);
    entry.connDoc = connDoc;
    entry.pc.onicecandidate = (event) => {
      if (event.candidate) {
        connDoc.collection('answerCandidates').add({
          ...event.candidate.toJSON(),
          expireAt: expireAt(),
        });
      }
    };
    const knownEntry = entry;
    entry.unsubscribes.push(
      connDoc.collection('offerCandidates').onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            addRemoteCandidate(knownEntry, change.doc.data());
          }
        });
      })
    );
  }

  await entry.pc.setRemoteDescription(new RTCSessionDescription(offer));
  flushPendingCandidates(entry);
  const answerDescription = await entry.pc.createAnswer();
  if (answerDescription.sdp) {
    answerDescription.sdp = enhanceAudioSdp(
      answerDescription.sdp,
      roomSizeFor(offererId)
    );
  }
  await entry.pc.setLocalDescription(answerDescription);
  await connDoc.update({
    answer: { type: answerDescription.type, sdp: answerDescription.sdp },
  });
}

// Symmetric join: creating a room is just being its first peer. Returns an
// error message, or '' on success.
export async function joinRoom(
  roomId: string,
  { create = false } = {}
): Promise<string> {
  if (!refs.micTrack || !refs.micDestination) {
    return 'Audio is not enabled yet.';
  }

  const roomDoc = firestore.collection('calls').doc(roomId);
  const peersCol = roomDoc.collection('peers');
  const connectionsCol = roomDoc.collection('connections');

  if (create) {
    await roomDoc.set({
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expireAt: expireAt(),
    });
  } else {
    // Rooms are ephemeral: a room everyone has left is not joinable.
    const existingPeers = await peersCol.get();
    if (existingPeers.empty) return 'Session not found';
  }

  myPresenceDoc = peersCol.doc(myPeerId);
  await myPresenceDoc.set({
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
    sharing: false,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    expireAt: expireAt(),
  });

  // Heartbeat so others can tell a live-but-quiet peer from a vanished one.
  // Every heartbeat write also re-fires everyone's peers snapshot, which is
  // where the stale-peer GC below runs.
  const heartbeat = () => {
    myPresenceDoc
      ?.update({
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        expireAt: expireAt(),
      })
      .catch(() => {});
  };
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  // Beat immediately on return to foreground, before others' GC can fire.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') heartbeat();
  });

  keepAwake();

  // Offerer rule (glare avoidance): for any pair, the peer already in the
  // room offers to the newcomer — i.e. we offer to peers whose joinedAt is
  // later than ours, with peerId as the tiebreak. Server timestamps are
  // briefly null locally while pending, so skip those docs (the snapshot
  // fires again once they resolve) and do nothing until our own resolves.
  peersCol.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'removed' && change.doc.id !== myPeerId) {
        closePeer(change.doc.id);
      }
    });

    // Ghost GC: a peer whose heartbeat has gone stale AND whose connection to
    // us isn't live is gone — delete its presence doc (which converges the
    // whole room via the 'removed' handler above) and drop it locally. The
    // connection guard spares a merely-backgrounded peer whose timer is
    // throttled but whose transport is still up. Compared against our own
    // lastSeen (both server timestamps) to avoid client-clock skew.
    const evicted = new Set<string>();
    const myLastSeen = snapshot.docs
      .find((doc) => doc.id === myPeerId)
      ?.data().lastSeen as Timestamp | null | undefined;
    if (myLastSeen) {
      for (const doc of snapshot.docs) {
        if (doc.id === myPeerId) continue;
        const theirLastSeen = doc.data().lastSeen as Timestamp | null;
        if (!theirLastSeen) continue;
        const stale =
          myLastSeen.toMillis() - theirLastSeen.toMillis() > STALE_MS;
        const live =
          refs.peers.get(doc.id)?.pc.connectionState === 'connected';
        if (stale && !live) {
          peersCol.doc(doc.id).delete().catch(() => {});
          closePeer(doc.id);
          evicted.add(doc.id);
        }
      }
    }

    refs.sharingPeers = new Set(
      snapshot.docs
        .filter((doc) => doc.id !== myPeerId && doc.data().sharing)
        .map((doc) => doc.id)
    );

    // Ordered participant list for letters: everyone with a resolved joinedAt
    // (ourselves included), earliest first, peerId as the tiebreak.
    refs.participantOrder = snapshot.docs
      .filter((doc) => doc.data().joinedAt)
      .sort((a, b) => {
        const diff =
          (a.data().joinedAt as Timestamp).toMillis() -
          (b.data().joinedAt as Timestamp).toMillis();
        return diff !== 0 ? diff : a.id < b.id ? -1 : 1;
      })
      .map((doc) => doc.id);

    // Exclusive screen sharing: if another peer's share is newer than ours,
    // stop ours so the newcomer's is the only one. Ties break on peerId so
    // both sides agree on who yields.
    if (refs.shareVideoTrack) {
      const superseded = snapshot.docs.some((doc) => {
        const data = doc.data();
        if (doc.id === myPeerId || !data.sharing) return false;
        const theirs = data.sharingSince ?? 0;
        return (
          theirs > refs.mySharingSince ||
          (theirs === refs.mySharingSince && doc.id < myPeerId)
        );
      });
      if (superseded) forceStopShare();
    }

    const myJoinedAt = snapshot.docs
      .find((doc) => doc.id === myPeerId)
      ?.data().joinedAt as Timestamp | null | undefined;
    if (!myJoinedAt) return;

    for (const doc of snapshot.docs) {
      // Skip peers we just evicted this pass — their doc is still present
      // until the delete propagates, and we mustn't re-offer to a ghost.
      if (doc.id === myPeerId || refs.peers.has(doc.id) || evicted.has(doc.id))
        continue;
      const joinedAt = doc.data().joinedAt as Timestamp | null;
      if (!joinedAt) continue;

      const diff = myJoinedAt.toMillis() - joinedAt.toMillis();
      const iAmOfferer = diff < 0 || (diff === 0 && myPeerId < doc.id);
      if (iAmOfferer) {
        offerTo(doc.id, connectionsCol).catch(console.error);
      }
      // Otherwise we're the answerer: wait for their offer to appear in the
      // connections subscription below.
    }
  });

  // Answer offers addressed to us, including fresh SDPs after ICE restarts.
  const answeredOfferSdp = new Map<string, string>();
  connectionsCol
    .where('answererId', '==', myPeerId)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') return;
        const data = change.doc.data();
        const offererId = data.offererId as string;
        const known = refs.peers.get(offererId);
        if (known) applyRemoteWatching(known, data, offererId);
        if (
          !data.offer?.sdp ||
          answeredOfferSdp.get(offererId) === data.offer.sdp
        ) {
          return;
        }
        answeredOfferSdp.set(offererId, data.offer.sdp);
        answerOffer(offererId, change.doc.ref, data.offer).catch(
          console.error
        );
      });
    });

  // Best-effort cleanup so the room converges quickly on graceful exits:
  // delete our connection docs and presence doc. Ungraceful exits fall back to
  // each pair's ICE failure handling; the orphaned presence doc is harmless.
  const publishExit = () => {
    for (const peerId of refs.peers.keys()) {
      connectionsCol.doc(`${myPeerId}_${peerId}`).delete().catch(() => {});
      connectionsCol.doc(`${peerId}_${myPeerId}`).delete().catch(() => {});
    }
    peersCol.doc(myPeerId).delete().catch(() => {});
  };
  window.addEventListener('pagehide', publishExit);

  // Explicit "leave" from the UI: publish the exit, tear down every peer
  // connection and the heartbeat, then reload to the home screen (which drops
  // the ?id and unwinds all Firestore subscriptions).
  leaveRoomImpl = () => {
    publishExit();
    clearInterval(heartbeatTimer);
    for (const peerId of [...refs.peers.keys()]) closePeer(peerId);
    window.location.assign(window.location.origin);
  };

  return '';
}

let leaveRoomImpl: (() => void) | null = null;

export function leaveRoom(): void {
  leaveRoomImpl?.();
}
