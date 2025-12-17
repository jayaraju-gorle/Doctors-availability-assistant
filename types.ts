
export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export enum ChatState {
  IDLE,
  LISTENING,
  PROCESSING,
  SPEAKING
}

export type LiveStatus = 'disconnected' | 'connecting' | 'connected';

export type LanguageCode = 'en-IN' | 'hi-IN' | 'te-IN' | 'ta-IN' | 'bn-IN' | 'mr-IN' | 'gu-IN';

export interface CallRecord {
  id: string;
  blob: Blob;
  url: string;
  timestamp: Date;
  duration: number; // in seconds
  transcript?: Message[]; // Added transcript
}

export interface ChatSession {
  id: string;
  timestamp: Date;
  messages: Message[];
  lastMessage?: string;
}

export interface Doctor {
  id: string;
  name: string;
  image: string;
  specialty: string;
  experience: string;
  fees: string;
  location: string;
}
