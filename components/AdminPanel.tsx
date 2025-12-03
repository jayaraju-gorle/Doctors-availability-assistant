import React, { useState } from 'react';
import { CallRecord, ChatSession, Message } from '../types';
import { Play, Download, Phone, Clock, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';

interface AdminPanelProps {
  recordings: CallRecord[];
  chatSessions: ChatSession[];
  onBack: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ recordings, chatSessions, onBack }) => {
  const [activeTab, setActiveTab] = useState<'voice' | 'text'>('voice');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const renderTranscript = (messages: Message[] | undefined) => {
    if (!messages || messages.length === 0) return <div className="text-gray-400 text-xs italic">No transcript available.</div>;
    
    return (
      <div className="bg-white rounded-lg p-3 space-y-2 max-h-60 overflow-y-auto border border-gray-100">
        {messages.map((m, i) => (
          <div key={i} className={`text-xs flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
             <span className={`px-2 py-1 rounded-lg max-w-[90%] ${m.role === 'user' ? 'bg-[#F0943F]/10 text-orange-800' : 'bg-gray-100 text-gray-700'}`}>
               <span className="font-bold mr-1 uppercase text-[10px]">{m.role}:</span> 
               {m.text}
             </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200 h-full flex flex-col">
      <div className="bg-[#024751] p-4 text-white flex justify-between items-center shadow-md">
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
        <button onClick={onBack} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors">
          Back to App
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        <button 
          onClick={() => setActiveTab('voice')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'voice' ? 'text-[#024751] border-b-2 border-[#024751] bg-gray-50' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-center gap-2">
            <Phone size={16} /> Voice Logs
          </div>
        </button>
        <button 
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'text' ? 'text-[#024751] border-b-2 border-[#024751] bg-gray-50' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          <div className="flex items-center justify-center gap-2">
            <MessageSquare size={16} /> Text Chats
          </div>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        
        {/* Voice Recordings Tab */}
        {activeTab === 'voice' && (
          <div className="space-y-4">
            {recordings.length === 0 ? (
              <div className="text-center p-8 text-gray-400">No voice recordings available.</div>
            ) : (
              recordings.map((rec) => (
                <div key={rec.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-bold text-gray-800">Call ID: {rec.id.slice(-6)}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <Clock size={12} />
                        {rec.timestamp.toLocaleString()} · {rec.duration.toFixed(0)}s
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <audio src={rec.url} controls className="h-8 w-28 md:w-40" />
                      <a 
                        href={rec.url} 
                        download={`recording-${rec.id}.webm`}
                        className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 text-[#024751]"
                        title="Download"
                      >
                        <Download size={14} />
                      </a>
                    </div>
                  </div>
                  
                  {/* Transcript Toggle */}
                  <div className="border-t border-gray-100 pt-2">
                    <button 
                      onClick={() => toggleExpand(rec.id)}
                      className="w-full text-left text-xs text-[#024751] font-medium flex items-center justify-between hover:bg-gray-50 p-1 rounded"
                    >
                      <span>{expandedId === rec.id ? 'Hide Transcript' : 'View Transcript'}</span>
                      {expandedId === rec.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    
                    {expandedId === rec.id && (
                      <div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        {renderTranscript(rec.transcript)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Text Chats Tab */}
        {activeTab === 'text' && (
          <div className="space-y-4">
            {chatSessions.length === 0 ? (
              <div className="text-center p-8 text-gray-400">No text chats available.</div>
            ) : (
              chatSessions.map((session) => (
                <div key={session.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                   <div 
                      onClick={() => toggleExpand(session.id)}
                      className="cursor-pointer"
                   >
                     <div className="flex justify-between items-start">
                       <div>
                         <div className="text-sm font-bold text-gray-800">Session: {session.id.slice(0, 15)}...</div>
                         <div className="text-xs text-gray-500 mt-0.5">
                           {session.timestamp.toLocaleString()} · {session.messages?.length || 0} msgs
                         </div>
                       </div>
                       {expandedId === session.id ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
                     </div>
                     <div className="mt-2 text-xs text-gray-600 truncate bg-gray-50 p-2 rounded">
                       Last: "{session.lastMessage || '...'}"
                     </div>
                   </div>

                   {expandedId === session.id && (
                      <div className="mt-3 pt-3 border-t border-gray-100 animate-in fade-in">
                        {renderTranscript(session.messages)}
                      </div>
                   )}
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminPanel;