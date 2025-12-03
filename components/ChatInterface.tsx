
import React, { useEffect, useRef, useState } from 'react';
import { Message, LiveStatus } from '../types';
import { Phone, PhoneOff, Activity, Send, Link as LinkIcon, MessageSquare, MapPin, ExternalLink, Star, Clock, Banknote, User } from 'lucide-react';

interface ChatInterfaceProps {
  messages: Message[];
  liveStatus: LiveStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  volume: number;
  onSendText?: (text: string) => void;
  isBotTyping?: boolean;
}

// Helper to format text with Markdown-like syntax and Card support
const FormattedText = ({ text, isUser }: { text: string; isUser: boolean }) => {
  if (!text) return null;

  // Process inline formatting (bold, links)
  const processInline = (str: string) => {
    // Regex for links: [Text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    // Regex for bold: **text**
    const boldRegex = /\*\*([^*]+)\*\*/g;
    
    // We'll separate by links first
    const parts = [];
    let lastIndex = 0;
    let match;

    // Helper to process bold inside a string
    const processBold = (s: string) => {
      const boldParts = [];
      let lastBoldIndex = 0;
      let boldMatch;
      
      while ((boldMatch = boldRegex.exec(s)) !== null) {
        if (boldMatch.index > lastBoldIndex) {
          boldParts.push(s.slice(lastBoldIndex, boldMatch.index));
        }
        boldParts.push(<strong key={boldMatch.index} className="font-bold text-gray-900">{boldMatch[1]}</strong>);
        lastBoldIndex = boldMatch.index + boldMatch[0].length;
      }
      if (lastBoldIndex < s.length) {
        boldParts.push(s.slice(lastBoldIndex));
      }
      return boldParts;
    };

    while ((match = linkRegex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        boldPartsPush(parts, processBold(str.slice(lastIndex, match.index)));
      }
      
      const isMapLink = match[2].includes('maps.google.com') || match[2].includes('google.com/maps');
      
      parts.push(
        <a 
          key={match.index} 
          href={match[2]} 
          target="_blank" 
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 font-medium underline decoration-1 underline-offset-2 transition-colors ${
            isMapLink 
              ? 'text-blue-600 hover:text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded text-xs no-underline border border-blue-100' 
              : 'text-blue-600 hover:text-blue-800'
          }`}
        >
          {isMapLink ? <MapPin size={10} /> : <ExternalLink size={10} />}
          {match[1]}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < str.length) {
      boldPartsPush(parts, processBold(str.slice(lastIndex)));
    }
    
    return parts;
  };
  
  // Helper to push array of nodes to parts
  const boldPartsPush = (target: any[], nodes: any[]) => {
      nodes.forEach(n => target.push(n));
  };

  // Split content by '---' to detect cards
  // We filter out empty splits caused by consecutive delimiters or start/end delimiters
  const sections = text.split(/\n\s*---\s*\n/).filter(s => s.trim().length > 0);

  // If we have multiple sections, we treat them as a "Intro + Cards" layout
  if (sections.length > 1) {
      return (
          <div className="space-y-3">
              {sections.map((section, idx) => {
                  // Heuristic: If section contains "Location:" or "Fee:", look like a doctor card
                  const isCard = (section.includes("Location:") || section.includes("Fee:")) && !isUser;
                  
                  return (
                      <div 
                        key={idx} 
                        className={isCard ? "bg-gray-50 p-3 rounded-lg border-l-4 border-[#024751] shadow-sm text-sm" : ""}
                      >
                          <SectionContent text={section} processInline={processInline} />
                      </div>
                  );
              })}
          </div>
      );
  }

  // Single section (standard message)
  return <SectionContent text={text} processInline={processInline} />;
};

const SectionContent = ({ text, processInline }: { text: string, processInline: (s: string) => any }) => {
    const lines = text.split('\n');
    return (
        <div className="space-y-1">
            {lines.map((line, i) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={i} className="h-1" />;

                // Check for specific prefixes to add icons
                let icon = null;
                let className = "flex items-start gap-2";
                
                if (trimmed.includes('Location:') || trimmed.includes('📍')) icon = <MapPin size={14} className="mt-1 text-red-500 shrink-0" />;
                else if (trimmed.includes('Experience:') || trimmed.includes('👨‍⚕️')) icon = <User size={14} className="mt-1 text-blue-500 shrink-0" />;
                else if (trimmed.includes('Fee:') || trimmed.includes('💰')) icon = <Banknote size={14} className="mt-1 text-green-600 shrink-0" />;
                else if (trimmed.includes('Availability:') || trimmed.includes('🕒')) icon = <Clock size={14} className="mt-1 text-orange-500 shrink-0" />;
                else if (trimmed.includes('Rating:') || trimmed.includes('⭐')) icon = <Star size={14} className="mt-1 text-yellow-500 shrink-0" />;
                
                // Remove the emojis if we are replacing them with Lucide icons (optional, but cleaner)
                // We keep the logic simple: just render the line with processInline
                
                if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                    return (
                        <div key={i} className={className + " ml-2"}>
                            {icon || <div className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2 shrink-0" />}
                            <span className="flex-1">{processInline(trimmed.replace(/^[\*\-\•]\s+/, ''))}</span>
                        </div>
                    );
                }

                // Headers
                if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                   return <div key={i} className="mb-1">{processInline(trimmed)}</div>; // Bold handles the styling
                }

                return (
                    <div key={i} className={className}>
                         {icon}
                         <span className="flex-1">{processInline(trimmed)}</span>
                    </div>
                );
            })}
        </div>
    );
};

// Typing Indicator Component
const TypingIndicator = () => (
  <div className="flex justify-start animate-in fade-in duration-200">
    <div className="bg-white border border-gray-200 p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1">
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
    </div>
  </div>
);

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  liveStatus,
  onConnect,
  onDisconnect,
  volume,
  onSendText,
  isBotTyping = false
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, messages.length, isBotTyping]); 

  const handleSend = () => {
    if (!inputText.trim()) return;

    if (onSendText) {
      onSendText(inputText.trim());
      setInputText("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  const handlePhoneClick = () => {
    if (liveStatus === 'connected') {
      onDisconnect();
    } else {
      onConnect();
    }
  };

  // Visualizer bars
  const bars = Array.from({ length: 5 });

  const isConnected = liveStatus === 'connected';

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200 relative">
      
      {/* Header */}
      <div className="bg-[#024751] p-4 text-white flex justify-between items-center shadow-md z-10 flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold">Doctor Availability Assistant</h1>
          <p className="text-xs text-gray-300 flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></span>
            {isConnected ? 'Live Connection' : 'Text & Voice Chat'}
          </p>
        </div>
        {isConnected && (
           <div className="flex items-center gap-1">
             {bars.map((_, i) => (
               <div 
                 key={i}
                 className="w-1 bg-white/50 rounded-full transition-all duration-75 ease-in-out"
                 style={{ 
                   height: `${Math.max(4, volume * 30 * (Math.random() + 0.5))}px` 
                 }}
               />
             ))}
           </div>
        )}
      </div>

      {/* Messages Area (Transcript) - Flex-1 takes remaining space */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 scrollbar-hide">
        {messages.length === 0 && !isConnected && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
             <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
                <MessageSquare size={36} className="text-gray-300" />
             </div>
             <div className="text-center px-6">
               <h3 className="font-semibold text-gray-600 mb-1">How can I help?</h3>
               <p className="text-sm opacity-75">
                 Type a query below or use the phone button to speak.
               </p>
               <div className="mt-4 flex flex-wrap justify-center gap-2">
                 <span className="text-xs bg-white border px-3 py-1 rounded-full cursor-pointer hover:bg-gray-50" onClick={() => setInputText("Is Apollo Clinic open now?")}>Is Apollo Clinic open now?</span>
                 <span className="text-xs bg-white border px-3 py-1 rounded-full cursor-pointer hover:bg-gray-50" onClick={() => setInputText("Find a Cardiologist near me")}>Find a Cardiologist near me</span>
               </div>
             </div>
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] md:max-w-[85%] p-3 rounded-2xl shadow-sm transition-all duration-75 ${
                msg.role === 'user'
                  ? 'bg-[#F0943F] text-white rounded-tr-none'
                  : 'bg-white text-gray-800 border border-gray-200 rounded-tl-none'
              }`}
            >
              <FormattedText text={msg.text} isUser={msg.role === 'user'} />
              
              {msg.isStreaming && (
                <span className="inline-block w-1 h-3 ml-1 bg-current animate-pulse align-middle"></span>
              )}
            </div>
          </div>
        ))}
        
        {isBotTyping && <TypingIndicator />}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Control Area (Input + Buttons) - Flex-shrink-0 to prevent squashing */}
      <div className="flex-shrink-0 bg-white border-t border-gray-100 p-4 z-20">
        
        {/* Input Bar */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type message or paste URL..."
              className={`w-full pl-4 pr-10 py-3 rounded-full bg-gray-100 border-none focus:ring-2 focus:ring-[#024751] focus:bg-white text-sm transition-all`}
            />
            <LinkIcon size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 opacity-0" />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="w-10 h-10 rounded-full bg-[#024751] text-white flex items-center justify-center disabled:opacity-30 hover:bg-[#01353d] transition-colors shadow-sm"
            title="Send"
          >
            <Send size={18} />
          </button>
        </div>

        {/* Call Buttons - Centered below text input */}
        <div className="flex justify-center items-center relative">
            {liveStatus === 'connecting' ? (
            <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-full">
                <div className="w-4 h-4 border-2 border-[#024751] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm font-medium text-gray-600">Connecting...</span>
            </div>
            ) : (
            <button
                onClick={handlePhoneClick}
                className={`
                relative group flex items-center justify-center w-12 h-12 rounded-full shadow-md transition-all duration-300 transform hover:scale-105 active:scale-95
                ${isConnected 
                    ? 'bg-red-500 hover:bg-red-600 text-white ring-2 ring-red-100' 
                    : 'bg-white text-[#024751] border border-gray-200 hover:bg-gray-50'
                }
                `}
                title={isConnected ? "End Call" : "Start Voice Call"}
            >
                {isConnected ? (
                <PhoneOff size={20} />
                ) : (
                <Phone size={20} />
                )}
                
                {/* Ripple effect when connected */}
                {isConnected && (
                <span className="absolute w-full h-full rounded-full bg-red-400 opacity-20 animate-ping"></span>
                )}
            </button>
            )}
            
            {isConnected && (
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <div className="flex items-center gap-2 text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                <Activity size={10} className="text-green-500" />
                <span>VOICE ON</span>
                </div>
            </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
