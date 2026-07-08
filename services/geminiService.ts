import { Message } from '../types';

export const sendMessageToGemini = async (text: string, history: Message[]): Promise<string> => {
  try {
    const response = await fetch('/api/gemini/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, history }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.text || "I am having trouble connecting to the server. Please try again.";
  } catch (error) {
    console.error("Error communicating with backend Gemini chat:", error);
    return "I am having trouble connecting to the server. Please try again.";
  }
};
