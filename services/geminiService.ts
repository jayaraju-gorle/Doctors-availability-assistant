import { GoogleGenAI, Content, Part } from "@google/genai";
import { SYSTEM_INSTRUCTION } from '../constants';
import { Message } from '../types';

let ai: GoogleGenAI | null = null;

export const initializeGemini = () => {
  // API key must be obtained exclusively from process.env.API_KEY. 
  // We assume it is valid and available.
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const sendMessageToGemini = async (text: string, history: Message[]): Promise<string> => {
  if (!ai) {
    initializeGemini();
  }
  
  if (!ai) {
    throw new Error("Failed to initialize Gemini Client");
  }

  // Convert App Message[] to Gemini Content[] to provide context
  const formattedHistory: Content[] = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text } as Part]
  }));

  // Create a new chat session for each message to ensure strict state synchronization
  // with the latest history (which includes Voice transcripts).
  const chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7, // Balanced for conversation
      tools: [{ googleSearch: {} }] // Enable Search
    },
    history: formattedHistory // Inject the full conversation context
  });

  try {
    const response = await chatSession.sendMessage({ message: text });
    return response.text || "I'm sorry, I didn't catch that.";
  } catch (error) {
    console.error("Error sending message to Gemini:", error);
    return "I am having trouble connecting to the server. Please try again.";
  }
};