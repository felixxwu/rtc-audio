import { firestore } from './firebase.ts';
import { pc } from './pc.ts';

export async function joinSession(id: string) {
  const callDoc = firestore.collection('calls').doc(id);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    if (event.candidate) answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  if (!callData) return;

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  if (!answerDescription.sdp) return;

  answerDescription.sdp = answerDescription.sdp.replace(
    'useinbandfec=1',
    'useinbandfec=1; stereo=1; maxaveragebitrate=1000000'
  );
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        const data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
}
