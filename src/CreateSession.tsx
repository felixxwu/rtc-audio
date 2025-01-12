import { pc } from './pc.ts';
import styled from 'styled-components';
import { colours } from './colours.ts';
import { firestore } from './firebase.ts';

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

    // Create offer
    const offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await callDoc.set({ offer });

    // Listen for remote answer
    callDoc.onSnapshot((snapshot) => {
      const data = snapshot.data();
      if (!pc.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    answerCandidates.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate);
        }
      });
    });
  };

  return <Button onClick={handleCreateCall}>Start New Session</Button>;
}

const Button = styled('button')`
  outline: none;
  padding: 10px 20px;
  border-radius: 100vw;
  border: none;
  background-color: ${colours.accent};
  color: ${colours.bg};
  cursor: pointer;

  &:hover {
    background-color: ${colours.accent2};
  }
`;
