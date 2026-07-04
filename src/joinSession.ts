import { firestore } from './firebase.ts';
import { enhanceAudioSdp, pc } from './pc.ts';

export async function joinSession(id: string): Promise<string> {
  const callDoc = firestore.collection('calls').doc(id);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    if (event.candidate) answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  if (!callData) return 'Session not found';
  if (callData.answer?.connected) return 'Session expired';

  const answerOffer = async (offerDescription: RTCSessionDescriptionInit) => {
    await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

    const answerDescription = await pc.createAnswer();
    if (!answerDescription.sdp) return 'Session corrupted';

    answerDescription.sdp = enhanceAudioSdp(answerDescription.sdp);
    await pc.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
      connected: true,
    };

    await callDoc.update({ answer });
    return '';
  };

  const error = await answerOffer(callData.offer);
  if (error) return error;

  // Recover from drops: the creator publishes a fresh offer after an ICE
  // restart — answer any offer we haven't answered yet.
  let answeredOfferSdp = callData.offer.sdp;
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (data?.offer?.sdp && data.offer.sdp !== answeredOfferSdp) {
      answeredOfferSdp = data.offer.sdp;
      answerOffer(data.offer).catch(console.error);
    }
  });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data)).catch(console.error);
      }
    });
  });

  return '';
}
