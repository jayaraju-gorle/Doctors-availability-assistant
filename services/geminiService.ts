
import { GoogleGenAI, Content, Part, GenerateContentResponse, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION } from '../constants';
import { Message } from '../types';

let ai: GoogleGenAI | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const initializeGemini = () => {
  ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const sendMessageToGemini = async (text: string, history: Message[]): Promise<string> => {
  if (!ai) initializeGemini();
  if (!ai) throw new Error("Failed to initialize Gemini Client");

  const formattedHistory: Content[] = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text } as Part]
  }));

  const chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7, 
      tools: [{ googleSearch: {} }] 
    },
    history: formattedHistory
  });

  try {
    const response = await chatSession.sendMessage({ message: text });
    return response.text || "I'm sorry, I didn't catch that.";
  } catch (error) {
    console.error("Error sending message to Gemini:", error);
    return "I am having trouble connecting to the server. Please try again.";
  }
};

export const streamMessageToGemini = async function* (text: string, history: Message[]) {
  if (!ai) initializeGemini();
  if (!ai) throw new Error("Failed to initialize Gemini Client");

  const formattedHistory: Content[] = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.text } as Part]
  }));

  const chatSession = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7, 
      tools: [{ googleSearch: {} }] 
    },
    history: formattedHistory
  });

  try {
    const result = await chatSession.sendMessageStream({ message: text });
    for await (const chunk of result) {
       // @google/genai stream chunk is GenerateContentResponse
       const responseChunk = chunk as GenerateContentResponse;
       if (responseChunk.text) {
         yield responseChunk.text;
       }
    }
  } catch (error) {
    console.error("Error streaming message from Gemini:", error);
    yield "I am having trouble connecting to the server.";
  }
};

export const generateSpeech = async (text: string, retryCount = 0): Promise<string | null> => {
  if (!ai) initializeGemini();
  if (!ai) return null;

  try {
    // Use the dedicated TTS model for speech generation
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts", 
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO], 
        speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }
            },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return audioData || null;
  } catch (error: any) {
    // Handle Quota Limit (429) with Retry
    if (error.status === 429 || (error.message && error.message.includes('429'))) {
        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s...
            console.warn(`TTS Quota hit. Retrying in ${delay}ms...`);
            await sleep(delay);
            return generateSpeech(text, retryCount + 1);
        }
    }

    // Handle 400 (Invalid Argument / Prompt not supported)
    // This often happens if the text is empty, noise, or triggers safety filters.
    // We suppress it to avoid crashing the flow.
    if (error.status === 400 || (error.message && error.message.includes('400'))) {
         console.warn("TTS 400 Error (Skipping chunk):", error.message);
         return null;
    }

    console.error("Error generating speech:", error);
    return null;
  }
};
