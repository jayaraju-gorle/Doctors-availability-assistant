import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase (Singleton pattern)
export const app = initializeApp(firebaseConfig);

// Initialize Firestore with the named database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const storage = getStorage(app);
export const auth = getAuth(app);
