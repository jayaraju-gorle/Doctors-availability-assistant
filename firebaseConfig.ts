import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import "firebase/compat/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDz93HHoVgGFTviWUuVhwahYpFW9pwFKqQ",
  authDomain: "voice-bot---doctor-booking.firebaseapp.com",
  projectId: "voice-bot---doctor-booking",
  storageBucket: "voice-bot---doctor-booking.firebasestorage.app",
  messagingSenderId: "968458253320",
  appId: "1:968458253320:web:b1c99cf87fb94fc16e0dbd",
  measurementId: "G-76PPJ3NP90"
};

// Initialize Firebase (Singleton pattern for Compat)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const db = firebase.firestore();
export const storage = firebase.storage();
export default firebase;