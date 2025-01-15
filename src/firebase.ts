import 'firebase/firestore';
import firebase from 'firebase/app';

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
export const firestore = firebase.firestore();
