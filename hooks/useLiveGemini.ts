import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { SYSTEM_INSTRUCTION } from '../constants';
import { base64ToUint8Array, arrayBufferToBase64, float32ToInt16, decodeAudioData } from '../utils/audio';
import { Message, LiveStatus, CallRecord } from '../types';

interface UseLiveGeminiProps {
  onRecordingReady: (record: CallRecord) => void;
}

// Inferred type for LiveSession since it is not exported by the SDK
type LiveSession = Awaited<ReturnType<GoogleGenAI['live']['connect']>>;

export const useLiveGemini = ({ onRecordingReady }: UseLiveGeminiProps) => {
  const [status, setStatus] = useState<LiveStatus>('disconnected');
  const [messages, setMessages] = useState<Message[]>([]);
  const [volume, setVolume] = useState(0);

  // Connection State Guards
  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Audio Contexts
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  
  // Stream & Processing
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputGainRef = useRef<GainNode | null>(null);
  
  // Recording
  const recordingDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  
  // Playback
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Gemini Session
  const activeSessionRef = useRef<LiveSession | null>(null);
  
  const messagesRef = useRef<Message[]>([]);

  const setMessagesSafe = (update: React.SetStateAction<Message[]>) => {
     setMessages(prev => {
         const newVal = typeof update === 'function' ? (update as (prev: Message[]) => Message[])(prev) : update;
         messagesRef.current = newVal;
         return newVal;
     });
  };

  const disconnect = useCallback((reason?: string) => {
    // If we are already fully disconnected, do nothing.
    // But if we are connecting, we might need to cleanup.
    if (!isConnectedRef.current && !isConnectingRef.current && status === 'disconnected') return;

    isConnectedRef.current = false;
    isConnectingRef.current = false;
    
    setStatus('disconnected');
    setVolume(0);
    
    // Stop Recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
        // We rely on the onstop event defined in connect() to trigger save
      } catch (e) {
        console.warn("Error stopping recorder", e);
      }
    }

    // Close Gemini Session
    if (activeSessionRef.current) {
        try {
            activeSessionRef.current.close();
        } catch (e) {
            console.warn("Error closing session", e);
        }
        activeSessionRef.current = null;
    }

    // Cleanup Audio Nodes
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch(e) {}
      sourceRef.current = null;
    }
    if (inputGainRef.current) {
      try { inputGainRef.current.disconnect(); } catch(e) {}
      inputGainRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch(e) {}
      processorRef.current = null;
    }
    
    // Cleanup Contexts
    if (inputContextRef.current) {
      inputContextRef.current.close().catch(() => {});
      inputContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close().catch(() => {});
      outputContextRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Stop playback
    scheduledSourcesRef.current.forEach(src => {
        try { src.stop(); } catch(e) {}
    });
    scheduledSourcesRef.current.clear();

    if (reason) {
        const endMsg: Message = {
          id: 'sys-end-' + Date.now(),
          role: 'model',
          text: reason,
          timestamp: new Date(),
          isStreaming: false
        };
        setMessagesSafe(prev => [...prev, endMsg]);
    }

  }, [status]); 

  const startInputProcessing = (stream: MediaStream, inCtx: AudioContext, outCtx: AudioContext, session: LiveSession) => {
    const source = inCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // Gain Node to boost mic volume significantly for VAD
    const gainNode = inCtx.createGain();
    gainNode.gain.value = 3.0; 
    inputGainRef.current = gainNode;
    
    // Use 2048 for lower latency (approx 128ms)
    const processor = inCtx.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      // Auto-resume if context suspends (common browser behavior)
      if (inCtx.state === 'suspended') {
          inCtx.resume().catch(() => {});
      }

      if (!isConnectedRef.current || !activeSessionRef.current) return;

      const inputData = e.inputBuffer.getChannelData(0);
      
      // Volume Visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      setVolume(Math.min(Math.sqrt(sum / inputData.length) * 5, 1));

      // PCM Conversion
      const pcmData = float32ToInt16(inputData);
      const base64Data = arrayBufferToBase64(pcmData.buffer);

      // Send to session
      try {
        session.sendRealtimeInput({
            media: {
                mimeType: 'audio/pcm;rate=16000',
                data: base64Data
            }
        });
      } catch (err) {
        // Silent catch to prevent console spam on disconnect
      }
    };

    source.connect(gainNode);
    gainNode.connect(processor);
    processor.connect(inCtx.destination);

    // Route mic to recording destination so user voice is recorded
    const recordSource = outCtx.createMediaStreamSource(stream);
    if (recordingDestRef.current) {
      recordSource.connect(recordingDestRef.current);
    }
  };

  const connect = useCallback(async (initialContext?: string) => {
    if (isConnectingRef.current || isConnectedRef.current) return;
    
    if (!process.env.API_KEY) {
      console.error("API Key missing");
      return;
    }

    try {
      isConnectingRef.current = true;
      setStatus('connecting');
      
      // Initialize Recording State
      recordedChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();
      
      // 1. Setup Audio Contexts
      const OutCtxClass = (window.AudioContext || (window as any).webkitAudioContext);
      const outCtx = new OutCtxClass({ sampleRate: 24000 });
      const inCtx = new OutCtxClass({ sampleRate: 16000 });
      
      outputContextRef.current = outCtx;
      inputContextRef.current = inCtx;

      // Resume immediately - critical for browser autoplay policies
      await outCtx.resume();
      await inCtx.resume();

      // 2. Setup Recording Destination
      recordingDestRef.current = outCtx.createMediaStreamDestination();
      
      // 3. Get Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      // Start Recorder
      const recorder = new MediaRecorder(recordingDestRef.current.stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
           const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
           const url = URL.createObjectURL(blob);
           const duration = (Date.now() - recordingStartTimeRef.current) / 1000;
           if (duration > 1) { 
               onRecordingReady({
                 id: Date.now().toString(),
                 blob,
                 url,
                 timestamp: new Date(),
                 duration,
                 transcript: messagesRef.current
               });
           }
      };
      recorder.start();

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      let effectiveInstructions = SYSTEM_INSTRUCTION;
      if (initialContext) {
        effectiveInstructions += `\n\nUSER CONTEXT UPDATE: ${initialContext}`;
      }

      // 4. Connect to Gemini Live
      const session = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          tools: [{ googleSearch: {} }],
          systemInstruction: effectiveInstructions,
          inputAudioTranscription: {}, // Request User transcription
          outputAudioTranscription: {}, // Request Model transcription
        },
        callbacks: {
          onopen: async () => {
            console.log("Gemini Live Session Opened");
            isConnectedRef.current = true;
            isConnectingRef.current = false;
            setStatus('connected');
            
            if (!initialContext) {
                const welcomeMsg: Message = {
                  id: 'sys-start-' + Date.now(),
                  role: 'model',
                  text: 'Connected. How can I help you check doctor availability?',
                  timestamp: new Date()
                };
                setMessagesSafe(prev => [...prev, welcomeMsg]);
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            handleServerMessage(msg);
          },
          onclose: (e) => {
            console.log("Session Closed", e);
            // Ignore normal close or close initiated by us
            if (!isConnectedRef.current) return;
            
            let reason = undefined;
            if (e.code !== 1000) {
                reason = `Connection closed (Code: ${e.code})`;
            }
            disconnect(reason);
          },
          onerror: (err) => {
            // Ignore errors if we are already disconnecting
            if (!isConnectedRef.current) return;
            
            console.error("Session Error:", err);
            disconnect("Connection error occurred.");
          }
        }
      });
      
      activeSessionRef.current = session;
      
      // Start Audio Processing Loop
      startInputProcessing(stream, inCtx, outCtx, session);

    } catch (e) {
      console.error("Connection failed", e);
      isConnectingRef.current = false;
      isConnectedRef.current = false;
      setStatus('disconnected');
      setMessagesSafe(prev => [...prev, {
        id: 'sys-err-' + Date.now(),
        role: 'model',
        text: 'Failed to connect. Please check permissions.',
        timestamp: new Date()
      }]);
    }
  }, [onRecordingReady, disconnect]);

  const updateMessageStream = (text: string, role: 'user' | 'model') => {
    const nonLatinRegex = /[\u0900-\u0E7F]/; 
    if (!text || !text.trim()) return;
    if (role === 'user' && nonLatinRegex.test(text)) return;

    setMessagesSafe(prev => {
      const newMessages = [...prev];
      const lastMsg = newMessages[newMessages.length - 1];
      
      if (lastMsg && lastMsg.role === role && lastMsg.isStreaming) {
        lastMsg.text += text;
        return newMessages;
      } else {
        if (lastMsg && lastMsg.isStreaming) lastMsg.isStreaming = false;
        return [...newMessages, {
          id: Date.now().toString(),
          role: role,
          text: text,
          timestamp: new Date(),
          isStreaming: true
        }];
      }
    });
  };

  const addMessage = (role: 'user' | 'model', text: string) => {
    setMessagesSafe(prev => [...prev, {
      id: Date.now().toString(),
      role: role,
      text: text,
      timestamp: new Date(),
      isStreaming: false
    }]);
  };

  const sendTextMessage = async (text: string) => {
    if (isConnectedRef.current) {
        // Flag as disconnected immediately to suppress error popups during the switch
        isConnectedRef.current = false;
        
        disconnect("Updating context...");
        // Wait 1s for cleanup before reconnecting to prevent socket race conditions
        setTimeout(() => connect(text), 1000);
    } else {
        connect(text);
    }
  };

  const handleServerMessage = async (message: LiveServerMessage) => {
    const content = message.serverContent;
    if (!content) return;

    if (content.turnComplete) {
       setMessagesSafe(prev => {
         const newMessages = [...prev];
         const lastMsg = newMessages[newMessages.length - 1];
         if (lastMsg) lastMsg.isStreaming = false;
         return newMessages;
       });
    }

    if (content.interrupted) {
      scheduledSourcesRef.current.forEach(src => { try { src.stop(); } catch(e) {} });
      scheduledSourcesRef.current.clear();
      if (outputContextRef.current) nextStartTimeRef.current = outputContextRef.current.currentTime;
      return;
    }

    if (content.modelTurn) {
        for (const part of content.modelTurn.parts) {
            if (part.text) {
                updateMessageStream(part.text, 'model');
            }
        }
    }
    
    if (content.inputTranscription?.text) {
      updateMessageStream(content.inputTranscription.text, 'user');
    }
    if (content.outputTranscription?.text) {
      updateMessageStream(content.outputTranscription.text, 'model');
    }

    if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
            if (part.inlineData && part.inlineData.data) {
                const audioData = part.inlineData.data;
                if (outputContextRef.current) {
                  const ctx = outputContextRef.current;
                  const rawBytes = base64ToUint8Array(audioData);
                  const audioBuffer = await decodeAudioData(rawBytes, ctx, 24000);
                  
                  const source = ctx.createBufferSource();
                  source.buffer = audioBuffer;
                  source.connect(ctx.destination);
                  if (recordingDestRef.current) source.connect(recordingDestRef.current);
                  
                  const currentTime = ctx.currentTime;
                  if (nextStartTimeRef.current < currentTime) nextStartTimeRef.current = currentTime;
                  
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += audioBuffer.duration;
                  
                  scheduledSourcesRef.current.add(source);
                  source.onended = () => scheduledSourcesRef.current.delete(source);
                }
            }
        }
    }
  };

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