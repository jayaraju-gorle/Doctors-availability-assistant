import { CallRecord, ChatSession, Message } from '../types';
import { db, storage } from '../firebaseConfig';
import firebase from '../firebaseConfig'; 

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const auth = firebase.auth && firebase.auth();
  const currentUser = auth ? auth.currentUser : null;
  
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email || undefined,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId || undefined,
      providerInfo: currentUser?.providerData.map(provider => ({
        providerId: provider?.providerId || '',
        displayName: provider?.displayName || null,
        email: provider?.email || null,
        photoUrl: provider?.photoURL || null
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
    } catch (error: any) {
      if (error?.message?.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, 'recordings');
      }
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
      
    } catch (error: any) {
      if (error?.message?.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.CREATE, 'recordings');
      }
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

    } catch (error: any) {
      if (error?.message?.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.WRITE, `text_sessions/${sessionId}`);
      }
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
    } catch (error: any) {
      if (error?.message?.includes('Missing or insufficient permissions')) {
        handleFirestoreError(error, OperationType.LIST, 'text_sessions');
      }
      console.error("Error fetching chat sessions:", error);
      return [];
    }
  }
};