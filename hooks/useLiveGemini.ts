
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { streamMessageToGemini, generateSpeech } from '../services/geminiService';
import { base64ToUint8Array, decodeAudioData } from '../utils/audio';
import { Message, LiveStatus, CallRecord, LanguageCode } from '../types';
import { CLEAN_TEXT_FOR_SPEECH } from '../constants';

interface UseLiveGeminiProps {
  onRecordingReady: (record: CallRecord) => void;
  language: LanguageCode;
}

export const useLiveGemini = ({ onRecordingReady, language }: UseLiveGeminiProps) => {
  const [status, setStatus] = useState<LiveStatus>('disconnected');
  const [messages, setMessages] = useState<Message[]>([]);
  const [volume, setVolume] = useState(0);

  // Refs for State Management
  const isConnectedRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const isProcessingRef = useRef(false);
  const languageRef = useRef(language);

  // Audio Queue Management
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingAudioRef = useRef(false);
  
  // Fake volume visualizer interval
  const volumeIntervalRef = useRef<any>(null);

  // Keep ref in sync with prop for the event listeners
  useEffect(() => {
    languageRef.current = language;
    // If connected, restart recognition to pick up new language
    if (isConnectedRef.current && recognitionRef.current) {
        recognitionRef.current.stop(); // onend will restart it with new lang
    }
  }, [language]);

  const setMessagesSafe = (update: React.SetStateAction<Message[]>) => {
     setMessages(prev => {
         const newVal = typeof update === 'function' ? (update as (prev: Message[]) => Message[])(prev) : update;
         messagesRef.current = newVal;
         return newVal;
     });
  };

  const stopAudioPlayback = () => {
    if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch(e) {}
        currentSourceRef.current = null;
    }
    // Clear queue
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;
    
    if (audioContextRef.current) {
        audioContextRef.current.suspend().catch(() => {});
    }
  };

  const startVolumeSimulation = () => {
      if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = setInterval(() => {
          setVolume(0.3 + Math.random() * 0.5);
      }, 100);
  };

  const stopVolumeSimulation = () => {
      if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
      setVolume(0);
  };

  // Audio Queue Processor
  const playBuffer = async (buffer: AudioBuffer) => {
      if (!isConnectedRef.current) return;
      if (!audioContextRef.current) return;
      
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      currentSourceRef.current = source;

      return new Promise<void>((resolve) => {
          source.onended = () => {
              currentSourceRef.current = null;
              resolve();
          };
          startVolumeSimulation();
          source.start(0);
      }).finally(() => {
          stopVolumeSimulation();
      });
  };

  const processAudioQueue = async () => {
    if (isPlayingAudioRef.current) return;
    
    if (audioQueueRef.current.length === 0) {
        // Queue is empty. 
        // If we are connected and NOT processing (meaning no more text/audio is being generated), 
        // we should restart listening now.
        if (isConnectedRef.current && !isProcessingRef.current) {
             // Slight delay to ensure audio is fully cleared and to avoid picking up echo
             setTimeout(() => {
                 if (isConnectedRef.current && !isProcessingRef.current && !isPlayingAudioRef.current && audioQueueRef.current.length === 0) {
                     try { recognitionRef.current?.start(); } catch(e) {}
                 }
             }, 200);
        }
        return;
    }

    isPlayingAudioRef.current = true;
    const buffer = audioQueueRef.current.shift();
    
    if (buffer) {
       await playBuffer(buffer);
    }
    
    isPlayingAudioRef.current = false;
    // Process next item recursively
    processAudioQueue();
  };

  const queueAudioBuffer = (buffer: AudioBuffer) => {
    audioQueueRef.current.push(buffer);
    processAudioQueue();
  };

  const handleUserTurn = async (text: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      stopVolumeSimulation();

      const userMsg: Message = {
          id: Date.now().toString(),
          role: 'user',
          text: text,
          timestamp: new Date(),
          isStreaming: false
      };
      setMessagesSafe(prev => [...prev, userMsg]);

      // Placeholder for Model Response
      const modelMsgId = (Date.now() + 1).toString();
      const initialModelMsg: Message = {
          id: modelMsgId,
          role: 'model',
          text: "", // Start empty
          timestamp: new Date(),
          isStreaming: true
      };
      setMessagesSafe(prev => [...prev, initialModelMsg]);

      try {
          const stream = streamMessageToGemini(text, messagesRef.current);
          
          let fullText = "";
          let sentenceBuffer = "";
          
          for await (const chunk of stream) {
              fullText += chunk;
              sentenceBuffer += chunk;

              // Update UI
              setMessagesSafe(prev => prev.map(m => 
                  m.id === modelMsgId ? { ...m, text: fullText } : m
              ));

              // Check for sentence delimiters to stream audio
              // We look for punctuation followed by space or newline, or just newline
              const sentenceMatch = sentenceBuffer.match(/([.!?\n]+)\s/);
              
              if (sentenceMatch && sentenceMatch.index !== undefined) {
                   const splitIndex = sentenceMatch.index + sentenceMatch[0].length;
                   const sentence = sentenceBuffer.slice(0, splitIndex);
                   const remainder = sentenceBuffer.slice(splitIndex);
                   
                   // Process this sentence for TTS
                   const cleanSentence = CLEAN_TEXT_FOR_SPEECH(sentence);
                   // Increased threshold to 4 to avoid tiny chunks triggering 400 errors or rate limits
                   if (cleanSentence.length > 4) { 
                        generateSpeech(cleanSentence).then(async (audioBase64) => {
                            if (audioBase64 && isConnectedRef.current) {
                                if (!audioContextRef.current) {
                                    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
                                    audioContextRef.current = new AudioContextClass();
                                }
                                const bytes = base64ToUint8Array(audioBase64);
                                const buffer = await decodeAudioData(bytes, audioContextRef.current, 24000);
                                queueAudioBuffer(buffer);
                            }
                        });
                   }
                   
                   sentenceBuffer = remainder;
              }
          }

          // Process remaining buffer
          if (sentenceBuffer.trim().length > 0) {
             const cleanSentence = CLEAN_TEXT_FOR_SPEECH(sentenceBuffer);
             if (cleanSentence.length > 4) {
                const audioBase64 = await generateSpeech(cleanSentence);
                 if (audioBase64 && isConnectedRef.current) {
                    if (!audioContextRef.current) {
                        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
                        audioContextRef.current = new AudioContextClass();
                    }
                    const bytes = base64ToUint8Array(audioBase64);
                    const buffer = await decodeAudioData(bytes, audioContextRef.current, 24000);
                    queueAudioBuffer(buffer);
                 }
             }
          }

          // Final update to remove streaming flag
          setMessagesSafe(prev => prev.map(m => 
            m.id === modelMsgId ? { ...m, isStreaming: false } : m
          ));

      } catch (e) {
          console.error("Error in conversation loop", e);
          setMessagesSafe(prev => prev.map(m => 
            m.id === modelMsgId ? { ...m, text: "Sorry, I encountered an error.", isStreaming: false } : m
          ));
      } finally {
          isProcessingRef.current = false;
          // Restart recognition is handled by audio queue completion or onend loop
          // But if no audio was generated, we need to restart here
          if (audioQueueRef.current.length === 0 && !isPlayingAudioRef.current && isConnectedRef.current) {
               try { recognitionRef.current?.start(); } catch(e) {}
          }
      }
  };

  const initializeRecognition = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
          console.error("Speech Recognition API not supported in this browser.");
          return null;
      }
      const recognition = new SpeechRecognition();
      
      // Dynamic Language Selection
      recognition.lang = languageRef.current;
      
      recognition.continuous = false; 
      recognition.interimResults = false;

      recognition.onstart = () => {
          if (isConnectedRef.current) {
             startVolumeSimulation();
          }
      };

      recognition.onend = () => {
          stopVolumeSimulation();
          // Auto-restart if we are still "Connected" and not processing a response AND not playing audio
          if (isConnectedRef.current && !isProcessingRef.current && !isPlayingAudioRef.current && audioQueueRef.current.length === 0) {
             setTimeout(() => {
                 if (isConnectedRef.current && !isProcessingRef.current) {
                     // Re-initialize to ensure we pick up language changes
                     if (recognitionRef.current && recognitionRef.current.lang !== languageRef.current) {
                         recognitionRef.current = initializeRecognition();
                     }
                     try { recognitionRef.current?.start(); } catch(e) {}
                 }
             }, 300);
          }
      };

      recognition.onresult = async (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript.trim()) {
              await handleUserTurn(transcript);
          }
      };
      
      recognition.onerror = (event: any) => {
          console.warn("Recognition error", event.error);
          stopVolumeSimulation();
          if (event.error === 'no-speech' && isConnectedRef.current && !isProcessingRef.current) {
              return; // onend will trigger restart
          }
      };

      return recognition;
  };

  const connect = useCallback((initialContext?: string) => {
      setStatus('connected');
      isConnectedRef.current = true;
      
      if (!audioContextRef.current) {
          const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
          audioContextRef.current = new AudioContextClass();
      }
      if (audioContextRef.current?.state === 'suspended') {
          audioContextRef.current.resume();
      }

      if (!recognitionRef.current) {
          recognitionRef.current = initializeRecognition();
      }
      try { recognitionRef.current?.start(); } catch (e) { }
  }, []);

  const disconnect = useCallback(() => {
      setStatus('disconnected');
      isConnectedRef.current = false;
      stopAudioPlayback();
      if (recognitionRef.current) {
          recognitionRef.current.stop();
      }
      stopVolumeSimulation();
  }, []);

  const sendTextMessage = useCallback((text: string) => {
      handleUserTurn(text);
  }, []);

  const addMessage = useCallback((role: 'user' | 'model', text: string) => {
      const msg: Message = {
          id: Date.now().toString(),
          role,
          text,
          timestamp: new Date(),
          isStreaming: false
      };
      setMessagesSafe(prev => [...prev, msg]);
  }, []);

  return {
    status,
    messages,
    connect,
    disconnect,
    volume,
    sendTextMessage,
    addMessage
  };
};
