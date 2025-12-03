import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useLiveGemini } from './hooks/useLiveGemini';
import { CallRecord, ChatSession, Message } from './types';
import { api } from './services/api';
import { sendMessageToGemini } from './services/geminiService';

const App: React.FC = () => {
  const [isAdminView, setIsAdminView] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  
  // Data State
  const [recordings, setRecordings] = useState<CallRecord[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Session ID for Text Chat (created on mount)
  const textSessionId = useRef<string>("");

  useEffect(() => {
    // Generate a random ID for this browser session's text chats
    textSessionId.current = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }, []);

  // Load data from Backend (API)
  const refreshData = async () => {
    setIsLoadingData(true);
    try {
      const [recData, chatData] = await Promise.all([
        api.fetchRecordings(),
        api.fetchChatSessions()
      ]);
      setRecordings(recData);
      setChatSessions(chatData);
    } catch (e) {
      console.error("Failed to fetch data", e);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Initial Load
  useEffect(() => {
    refreshData();
  }, []);

  // Poll for updates when in Admin View
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isAdminView) {
      refreshData(); // Fetch immediately on enter
      interval = setInterval(refreshData, 5000); // Poll every 5 seconds
    }
    return () => clearInterval(interval);
  }, [isAdminView]);

  // Handler: When a voice call ends
  const handleRecordingReady = async (record: CallRecord) => {
    // Optimistic UI update for recordings
    setRecordings(prev => [record, ...prev]);
    // Upload with transcript
    await api.uploadRecording(record);
    refreshData(); // Sync to get proper ID/URLs
  };

  const { status, messages, connect, disconnect, volume, sendTextMessage, addMessage } = useLiveGemini({
    onRecordingReady: handleRecordingReady
  });

  // Wrapper to inject context when starting voice call
  const handleConnectWithContext = () => {
    // 1. Get recent history (limit to last 6 messages to keep context concise and relevant)
    const recentContext = messages.slice(-6).map(m => {
        // Clean up the text to remove markdown artifacts for the system prompt
        const cleanText = m.text.replace(/\*\*/g, '').replace(/\[.*?\]\(.*?\)/g, 'Link');
        return `${m.role.toUpperCase()}: ${cleanText}`;
    }).join('\n');

    let contextString = "";
    if (recentContext) {
        contextString = `PREVIOUS CONVERSATION HISTORY:\n${recentContext}\n\nContinue the conversation naturally from here.`;
    }

    connect(contextString);
  };

  const handleSendHybrid = async (text: string) => {
    if (status === 'connected') {
      // Voice Mode: Send to Live API (Transcript handled by useLiveGemini + handleRecordingReady)
      sendTextMessage(text);
    } else {
      // Text Mode: Send to Standard Chat API
      const userMsg: Message = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
      
      // 1. Add to local UI
      addMessage('user', text);
      
      // 2. Log User Message to Firestore
      await api.logChatMessage(textSessionId.current, userMsg);

      setIsBotTyping(true); // Start typing indicator
      try {
        // Pass the CURRENT messages (including the one just added) to maintain context
        const responseText = await sendMessageToGemini(text, [...messages, userMsg]);
        
        const modelMsg: Message = { id: (Date.now() + 1).toString(), role: 'model', text: responseText, timestamp: new Date() };
        
        // 3. Add Model Response to local UI
        addMessage('model', responseText);

        // 4. Log Model Message to Firestore
        await api.logChatMessage(textSessionId.current, modelMsg);

      } catch (e) {
        addMessage('model', "Sorry, I encountered an error. Please try again.");
      } finally {
        setIsBotTyping(false); // Stop typing indicator
      }
    }
  };

  return (
    <div className="h-screen w-full bg-gray-100 flex items-center justify-center p-0 md:p-4 font-sans relative overflow-hidden">
      
      {/* Admin Toggle */}
      <button 
        onClick={() => setIsAdminView(!isAdminView)}
        className="absolute top-4 right-4 z-50 bg-white/80 backdrop-blur p-2 rounded-full shadow-md text-[#024751] hover:bg-white transition-all"
        title={isAdminView ? "Close Admin" : "Open Admin"}
      >
        <ShieldCheck size={20} />
      </button>

      <div className="w-full max-w-lg h-full md:h-[90vh] flex gap-6 justify-center">
        
        {isAdminView ? (
          <div className="w-full h-full relative">
            {isLoadingData && (
              <div className="absolute top-4 right-16 flex items-center gap-2 text-xs text-gray-500 bg-white/80 px-2 py-1 rounded-md z-50">
                <Loader2 size={12} className="animate-spin" /> Syncing...
              </div>
            )}
            <AdminPanel 
              recordings={recordings}
              chatSessions={chatSessions}
              onBack={() => setIsAdminView(false)}
            />
          </div>
        ) : (
          /* Single Panel: Live Chat Interface */
          <div className="w-full h-full shadow-2xl md:rounded-2xl overflow-hidden bg-white">
            <ChatInterface 
              messages={messages}
              liveStatus={status}
              onConnect={handleConnectWithContext}
              onDisconnect={disconnect}
              volume={volume}
              onSendText={handleSendHybrid}
              isBotTyping={isBotTyping}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;