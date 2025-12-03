import { CallRecord, ChatSession, Message } from '../types';
import { db, storage } from '../firebaseConfig';
import firebase from '../firebaseConfig'; 

export const api = {
  
  // --- RECORDINGS (Firestore + Storage) ---

  async fetchRecordings(): Promise<CallRecord[]> {
    try {
      const snapshot = await db.collection("recordings")
        .orderBy("timestamp", "desc")
        .limit(20)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp && typeof data.timestamp.toDate === 'function'
          ? data.timestamp.toDate() 
          : new Date(data.timestamp || Date.now());

        return {
          id: doc.id,
          ...data,
          timestamp,
          blob: new Blob(), // Placeholder
          transcript: data.transcript || [] // Load transcript if exists
        } as CallRecord;
      });
    } catch (error) {
      console.error("Error fetching recordings:", error);
      return [];
    }
  },

  async uploadRecording(record: CallRecord): Promise<void> {
    try {
      // 1. Upload the audio file
      const storageRef = storage.ref(`recordings/${record.id}.webm`);
      await storageRef.put(record.blob);
      const downloadURL = await storageRef.getDownloadURL();

      // 2. Save metadata + Transcript to Firestore
      await db.collection("recordings").add({
        url: downloadURL,
        duration: record.duration,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        callId: record.id,
        transcript: record.transcript || [] // Save the chat history of this call
      });
      
    } catch (error) {
      console.error("Error uploading recording:", error);
    }
  },

  // --- TEXT CHATS (Firestore) ---

  async logChatMessage(sessionId: string, message: Message): Promise<void> {
    try {
      const sessionRef = db.collection("text_sessions").doc(sessionId);
      
      // Use set with merge to create if not exists, and arrayUnion to append message
      await sessionRef.set({
        timestamp: firebase.firestore.FieldValue.serverTimestamp(), // Update last active time
        lastMessage: message.text.slice(0, 100),
        messages: firebase.firestore.FieldValue.arrayUnion(message)
      }, { merge: true });

    } catch (error) {
      console.error("Error logging chat message:", error);
    }
  },

  async fetchChatSessions(): Promise<ChatSession[]> {
    try {
      const snapshot = await db.collection("text_sessions")
        .orderBy("timestamp", "desc")
        .limit(20)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          timestamp: data.timestamp?.toDate() || new Date(),
          messages: data.messages || [],
          lastMessage: data.lastMessage || ""
        } as ChatSession;
      });
    } catch (error) {
      console.error("Error fetching chat sessions:", error);
      return [];
    }
  }
};