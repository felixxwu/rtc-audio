import { useState } from 'react';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAZ1HlUPOnGvN0VVLkXMA1sPEvTRR-AbL0',
  authDomain: 'rtc-audio.firebaseapp.com',
  projectId: 'rtc-audio',
  storageBucket: 'rtc-audio.firebasestorage.app',
  messagingSenderId: '1068796860354',
  appId: '1:1068796860354:web:cede8f048b83c20a0ca85b',
  measurementId: 'G-K7Q6CTR7J8',
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};
const pc = new RTCPeerConnection(servers);

function App() {
  const handleEnableAudio = async () => {
    const localStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        autoGainControl: false,
        channelCount: {
          exact: 2,
        },
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 48000,
        sampleSize: 16,
      },
    });
    const remoteStream = new MediaStream();
    console.log(`remoteStream`, remoteStream);

    // Push tracks from local stream to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Pull tracks from remote stream, add to video stream
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    };

    // callButton.disabled = false;
    // answerButton.disabled = false;
    // webcamButton.disabled = true;

    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = remoteStream;
  };

  const [id, setId] = useState('');

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

    // hangupButton.disabled = false;
  };

  const handleAnswerButton = async () => {
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

    // hangupButton.disabled = false;
  };

  return (
    <>
      <h2>1. Enable Audio</h2>
      <button onClick={handleEnableAudio}>Enable Audio</button>

      <h2>2. Create a new Call</h2>
      <button onClick={handleCreateCall}>Create Call (offer)</button>

      <h2>3. Join a Call</h2>
      <p>Answer the call from a different browser window or device</p>

      <input value={id} onChange={(e) => setId(e.target.value)} />
      <button onClick={handleAnswerButton}>Answer</button>
    </>
  );
}

export default App;
