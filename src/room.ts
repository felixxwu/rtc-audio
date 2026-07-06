import firebase from 'firebase/app';
import { firestore } from './firebase.ts';
import { enhanceAudioSdp, servers } from './pc.ts';
import { refs, type Peer } from './refs.ts';
import { updateTransmission } from './transmission.ts';
import { keepAwake } from './wakeLock.ts';

// Lives for the lifetime of the tab; a rejoin after reload is a new peer.
export const myPeerId = crypto.randomUUID();

const MAX_RESTARTS = 3;

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

  const audio = new Audio();
  audio.autoplay = true;
  // Inherit the current slider value — a peer joining after the speaker was
  // lowered must not play at full volume.
  audio.volume = refs.speakerVolume;

  pc.ontrack = (event) => {
    // Prefer stability over latency: buffer up to 500ms rather than glitch
    // on jitter — right trade-off for one-way music streaming.
    if ('jitterBufferTarget' in event.receiver) {
      event.receiver.jitterBufferTarget = 500;
    } else if ('playoutDelayHint' in event.receiver) {
      // legacy equivalent, in seconds
      (event.receiver as { playoutDelayHint?: number }).playoutDelayHint = 0.5;
    }
    audio.srcObject = event.streams[0];
  };

  const entry = {
    pc,
    sender,
    audio,
    stats: { bytes: 0, bytesSent: 0, ts: 0, lost: 0, received: 0 },
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
  entry.pc.close();
  entry.audio.srcObject = null;
  refs.peers.delete(peerId);
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

  entry.pc.onicecandidate = (event) => {
    if (event.candidate) {
      connDoc.collection('offerCandidates').add(event.candidate.toJSON());
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
      await connDoc.set({ offererId: myPeerId, answererId: peerId, offer });
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
      if (
        data?.answer &&
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
    entry.pc.onicecandidate = (event) => {
      if (event.candidate) {
        connDoc.collection('answerCandidates').add(event.candidate.toJSON());
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
    });
  } else {
    // Rooms are ephemeral: a room everyone has left is not joinable.
    const existingPeers = await peersCol.get();
    if (existingPeers.empty) return 'Session not found';
  }

  await peersCol.doc(myPeerId).set({
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
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

    const myJoinedAt = snapshot.docs
      .find((doc) => doc.id === myPeerId)
      ?.data().joinedAt as Timestamp | null | undefined;
    if (!myJoinedAt) return;

    for (const doc of snapshot.docs) {
      if (doc.id === myPeerId || refs.peers.has(doc.id)) continue;
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

  // Best-effort cleanup so the room converges quickly on graceful exits.
  // Ungraceful exits fall back to each pair's ICE failure handling; the
  // orphaned presence doc is harmless.
  window.addEventListener('pagehide', () => {
    for (const peerId of refs.peers.keys()) {
      connectionsCol.doc(`${myPeerId}_${peerId}`).delete().catch(() => {});
      connectionsCol.doc(`${peerId}_${myPeerId}`).delete().catch(() => {});
    }
    peersCol.doc(myPeerId).delete().catch(() => {});
  });

  return '';
}
