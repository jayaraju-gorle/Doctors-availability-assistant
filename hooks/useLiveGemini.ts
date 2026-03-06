
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getGeminiClient } from '../services/geminiService';
import { base64ToUint8Array, decodeAudioData, float32ToInt16, arrayBufferToBase64 } from '../utils/audio';
import { Message, LiveStatus, CallRecord, LanguageCode } from '../types';
import { SYSTEM_INSTRUCTION } from '../constants';
import { LiveServerMessage, Modality } from '@google/genai';

interface UseLiveGeminiProps {
  onRecordingReady: (record: CallRecord) => void;
  language: LanguageCode;
}

export const useLiveGemini = ({ onRecordingReady, language }: UseLiveGeminiProps) => {
  const [status, setStatus] = useState<LiveStatus>('disconnected');
  const [messages, setMessages] = useState<Message[]>([]);
  const [volume, setVolume] = useState(0);

  const isConnectedRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<AudioBuffer[]>([]);
  const isPlayingAudioRef = useRef(false);
  const volumeIntervalRef = useRef<any>(null);

  // Transcription state
  const currentUserMsgIdRef = useRef<string | null>(null);
  const currentModelMsgIdRef = useRef<string | null>(null);

  const setMessagesSafe = (update: React.SetStateAction<Message[]>) => {
     setMessages(prev => {
         const newVal = typeof update === 'function' ? (update as (prev: Message[]) => Message[])(prev) : update;
         messagesRef.current = newVal;
         return newVal;
     });
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
    if (audioQueueRef.current.length === 0) return;

    isPlayingAudioRef.current = true;
    const buffer = audioQueueRef.current.shift();
    
    if (buffer) {
       await playBuffer(buffer);
    }
    
    isPlayingAudioRef.current = false;
    processAudioQueue();
  };

  const queueAudioBuffer = (buffer: AudioBuffer) => {
    audioQueueRef.current.push(buffer);
    processAudioQueue();
  };

  const stopAudioPlayback = () => {
    if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch(e) {}
        currentSourceRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingAudioRef.current = false;
  };

  const disconnect = useCallback(() => {
      setStatus('disconnected');
      isConnectedRef.current = false;
      stopAudioPlayback();
      stopVolumeSimulation();

      if (scriptProcessorRef.current) {
          scriptProcessorRef.current.disconnect();
          scriptProcessorRef.current.onaudioprocess = null;
          scriptProcessorRef.current = null;
      }
      if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
      }
      if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
      }
      if (sessionRef.current) {
          sessionRef.current.then((session: any) => session.close()).catch(() => {});
          sessionRef.current = null;
      }
  }, []);

  const connect = useCallback(async (initialContext?: string) => {
      setStatus('connecting');
      isConnectedRef.current = true;
      
      try {
          const ai = getGeminiClient();
          
          const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
          audioContextRef.current = new AudioContextClass({ sampleRate: 16000 });
          await audioContextRef.current.resume();

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaStreamRef.current = stream;

          const source = audioContextRef.current.createMediaStreamSource(stream);
          const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
          scriptProcessorRef.current = processor;

          source.connect(processor);
          processor.connect(audioContextRef.current.destination);

          let sessionPromise = ai.live.connect({
            model: "gemini-2.5-flash-native-audio-preview-09-2025",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
              systemInstruction: SYSTEM_INSTRUCTION + (initialContext ? `\n\n${initialContext}` : "") + `\n\nPlease speak in the following language: ${language}`,
              outputAudioTranscription: {},
              inputAudioTranscription: {},
            },
            callbacks: {
              onopen: () => {
                setStatus('connected');
                processor.onaudioprocess = (e) => {
                  if (!isConnectedRef.current) return;
                  const inputData = e.inputBuffer.getChannelData(0);
                  const pcm16 = float32ToInt16(inputData);
                  const base64Data = arrayBufferToBase64(pcm16.buffer);
                  sessionPromise.then(session => {
                    session.sendRealtimeInput({
                      media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                    });
                  });
                };
              },
              onmessage: async (message: LiveServerMessage) => {
                // Handle Audio Output
                const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio && isConnectedRef.current) {
                  if (!audioContextRef.current) return;
                  const bytes = base64ToUint8Array(base64Audio);
                  const buffer = await decodeAudioData(bytes, audioContextRef.current, 24000);
                  queueAudioBuffer(buffer);
                }

                // Handle Interruption
                if (message.serverContent?.interrupted) {
                  stopAudioPlayback();
                }

                // Handle Input Transcription (User)
                const inputTranscription = message.serverContent?.inputTranscription;
                if (inputTranscription?.text) {
                  if (!currentUserMsgIdRef.current) {
                    currentUserMsgIdRef.current = Date.now().toString();
                    const newMsg: Message = {
                      id: currentUserMsgIdRef.current,
                      role: 'user',
                      text: inputTranscription.text,
                      timestamp: new Date(),
                      isStreaming: true
                    };
                    setMessagesSafe(prev => [...prev, newMsg]);
                  } else {
                    setMessagesSafe(prev => prev.map(m => 
                      m.id === currentUserMsgIdRef.current 
                        ? { ...m, text: m.text + inputTranscription.text } 
                        : m
                    ));
                  }
                  if (inputTranscription.finished) {
                    setMessagesSafe(prev => prev.map(m => 
                      m.id === currentUserMsgIdRef.current 
                        ? { ...m, isStreaming: false } 
                        : m
                    ));
                    currentUserMsgIdRef.current = null;
                  }
                }

                // Handle Output Transcription (Model)
                const outputTranscription = message.serverContent?.outputTranscription;
                if (outputTranscription?.text) {
                  if (!currentModelMsgIdRef.current) {
                    currentModelMsgIdRef.current = (Date.now() + 1).toString();
                    const newMsg: Message = {
                      id: currentModelMsgIdRef.current,
                      role: 'model',
                      text: outputTranscription.text,
                      timestamp: new Date(),
                      isStreaming: true
                    };
                    setMessagesSafe(prev => [...prev, newMsg]);
                  } else {
                    setMessagesSafe(prev => prev.map(m => 
                      m.id === currentModelMsgIdRef.current 
                        ? { ...m, text: m.text + outputTranscription.text } 
                        : m
                    ));
                  }
                  if (outputTranscription.finished) {
                    setMessagesSafe(prev => prev.map(m => 
                      m.id === currentModelMsgIdRef.current 
                        ? { ...m, isStreaming: false } 
                        : m
                    ));
                    currentModelMsgIdRef.current = null;
                  }
                }
              },
              onclose: () => {
                disconnect();
              },
              onerror: (error) => {
                console.error("Live API Error:", error);
                disconnect();
              }
            }
          });
          
          sessionRef.current = sessionPromise;

      } catch (error) {
          console.error("Failed to connect to Gemini Live:", error);
          disconnect();
      }
  }, [disconnect, language]);

  const sendTextMessage = useCallback((text: string) => {
      if (sessionRef.current && isConnectedRef.current) {
          sessionRef.current.then((session: any) => {
              session.sendRealtimeInput({
                  text: text
              });
          });
          const msg: Message = {
              id: Date.now().toString(),
              role: 'user',
              text,
              timestamp: new Date(),
              isStreaming: false
          };
          setMessagesSafe(prev => [...prev, msg]);
      }
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
