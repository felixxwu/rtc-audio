import { enhanceAudioSdp, pc } from './pc.ts';
import { firestore } from './firebase.ts';
import { Button } from './Button.tsx';

export function CreateSession({ setId }: { setId: (id: string) => void }) {
  const handleCreateCall = async () => {
    // Reference Firestore collections for signaling
    const callDoc = firestore.collection('calls').doc();
    const offerCandidates = callDoc.collection('offerCandidates');
    const answerCandidates = callDoc.collection('answerCandidates');

    setId(callDoc.id);

    // Get candidates for caller, save to db
    pc.onicecandidate = (event) => {
      if (event.candidate) offerCandidates.add(event.candidate.toJSON());
    };

    const publishOffer = async (initial: boolean) => {
      const offerDescription = await pc.createOffer();
      if (offerDescription.sdp) {
        offerDescription.sdp = enhanceAudioSdp(offerDescription.sdp);
      }
      await pc.setLocalDescription(offerDescription);

      const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
        connected: false,
      };

      if (initial) await callDoc.set({ offer });
      else await callDoc.update({ offer });
    };

    await publishOffer(true);

    // Recover from drops: if ICE fails (or stays disconnected), restart it
    // and publish a fresh offer for the joiner to re-answer.
    let disconnectTimeout: NodeJS.Timeout | undefined;
    const restart = () => {
      pc.restartIce();
      publishOffer(false).catch(console.error);
    };
    pc.oniceconnectionstatechange = () => {
      clearTimeout(disconnectTimeout);
      if (pc.iceConnectionState === 'failed') {
        restart();
      } else if (pc.iceConnectionState === 'disconnected') {
        // 'disconnected' often self-heals; only restart if it persists.
        disconnectTimeout = setTimeout(restart, 5000);
      }
    };

    // Listen for remote answers, including re-answers after an ICE restart
    callDoc.onSnapshot((snapshot) => {
      const data = snapshot.data();
      if (
        data?.answer &&
        data.answer.sdp !== pc.currentRemoteDescription?.sdp
      ) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription).catch(console.error);
      }
    });

    // When answered, add candidate to peer connection
    answerCandidates.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate).catch(console.error);
        }
      });
    });
  };

  return <Button onClick={handleCreateCall}>Start New Session</Button>;
}
