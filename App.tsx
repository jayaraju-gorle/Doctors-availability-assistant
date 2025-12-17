
import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useLiveGemini } from './hooks/useLiveGemini';
import { CallRecord, ChatSession, Message, LanguageCode } from './types';
import { api } from './services/api';
import { sendMessageToGemini } from './services/geminiService';

const App: React.FC = () => {
  const [isAdminView, setIsAdminView] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>('en-IN');
  
  // Data State
  const [recordings, setRecordings] = useState<CallRecord[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const textSessionId = useRef<string>("");

  useEffect(() => {
    textSessionId.current = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }, []);

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

  useEffect(() => {
    refreshData();
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isAdminView) {
      refreshData(); 
      interval = setInterval(refreshData, 5000); 
    }
    return () => clearInterval(interval);
  }, [isAdminView]);

  const handleRecordingReady = async (record: CallRecord) => {
    setRecordings(prev => [record, ...prev]);
    await api.uploadRecording(record);
    refreshData(); 
  };

  const { status, messages, connect, disconnect, volume, sendTextMessage, addMessage } = useLiveGemini({
    onRecordingReady: handleRecordingReady,
    language: selectedLanguage
  });

  const handleConnectWithContext = () => {
    const recentContext = messages.slice(-6).map(m => {
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
      sendTextMessage(text);
    } else {
      const userMsg: Message = { id: Date.now().toString(), role: 'user', text, timestamp: new Date() };
      
      addMessage('user', text);
      await api.logChatMessage(textSessionId.current, userMsg);

      setIsBotTyping(true); 
      try {
        const responseText = await sendMessageToGemini(text, [...messages, userMsg]);
        const modelMsg: Message = { id: (Date.now() + 1).toString(), role: 'model', text: responseText, timestamp: new Date() };
        
        addMessage('model', responseText);
        await api.logChatMessage(textSessionId.current, modelMsg);

      } catch (e) {
        addMessage('model', "Sorry, I encountered an error. Please try again.");
      } finally {
        setIsBotTyping(false); 
      }
    }
  };

  return (
    <div className="h-screen w-full bg-gray-100 flex items-center justify-center p-0 md:p-4 font-sans relative overflow-hidden">
      
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
          <div className="w-full h-full shadow-2xl md:rounded-2xl overflow-hidden bg-white">
            <ChatInterface 
              messages={messages}
              liveStatus={status}
              onConnect={handleConnectWithContext}
              onDisconnect={disconnect}
              volume={volume}
              onSendText={handleSendHybrid}
              isBotTyping={isBotTyping}
              selectedLanguage={selectedLanguage}
              onLanguageChange={setSelectedLanguage}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
