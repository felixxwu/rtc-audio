import { firestore } from './firebase.ts';
import { pc } from './pc.ts';

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

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  if (!answerDescription.sdp) return 'Session corrupted';

  answerDescription.sdp = answerDescription.sdp.replace(
    'useinbandfec=1',
    'useinbandfec=1; stereo=1; maxaveragebitrate=1411000'
  );
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
    connected: true,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  return '';
}
