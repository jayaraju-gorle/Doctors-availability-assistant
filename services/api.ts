import { CallRecord, ChatSession, Message } from '../types';
import { db, storage, auth } from '../firebaseConfig';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  getDocs, 
  addDoc, 
  serverTimestamp, 
  doc, 
  setDoc, 
  arrayUnion 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
      const recordingsCol = collection(db, "recordings");
      const q = query(recordingsCol, orderBy("timestamp", "desc"), limit(20));
      const snapshot = await getDocs(q);

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
      const storageRef = ref(storage, `recordings/${record.id}.webm`);
      await uploadBytes(storageRef, record.blob);
      const downloadURL = await getDownloadURL(storageRef);

      // 2. Save metadata + Transcript to Firestore
      await addDoc(collection(db, "recordings"), {
        url: downloadURL,
        duration: record.duration,
        timestamp: serverTimestamp(),
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
      const sessionRef = doc(db, "text_sessions", sessionId);
      
      // Use set with merge to create if not exists, and arrayUnion to append message
      await setDoc(sessionRef, {
        timestamp: serverTimestamp(), // Update last active time
        lastMessage: message.text.slice(0, 100),
        messages: arrayUnion(message)
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
      const sessionsCol = collection(db, "text_sessions");
      const q = query(sessionsCol, orderBy("timestamp", "desc"), limit(20));
      const snapshot = await getDocs(q);

      return snapshot.docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp && typeof data.timestamp.toDate === 'function'
          ? data.timestamp.toDate() 
          : new Date(data.timestamp || Date.now());

        return {
          id: doc.id,
          timestamp,
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
