import { useState, useRef, useEffect, useCallback } from "react";
import { Send, User, Bot, Menu, X, Wifi, WifiOff, Phone, Calendar, Stethoscope, AlertTriangle, ChevronRight, Clock, MapPin } from "lucide-react";
import { SYSTEM_PROMPT } from "./prompts";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: string;
}

// The backend appends a hidden `<!--BOOKING_STATE:{...}-->` comment to some
// bot replies so it can reliably carry doctor/date/time across the multi-step
// booking flow (confirm → name → phone). It must stay in `text` so it round-
// trips through `history` back to the server, but it should never be shown
// to the user — strip it before rendering.
function stripHiddenState(text: string): string {
  return text.replace(/\n?<!--BOOKING_STATE:.*?-->/s, "");
}

function MessageContent({ text }: { text: string }) {
  const lines = stripHiddenState(text).split("\n");
  return (
    <div className="msg-content">
      {lines.map((line, i) => {
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return (
            <div key={i} className="flex items-start gap-2 my-0.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
              <span>{line.slice(2)}</span>
            </div>
          );
        }
        if (line.startsWith("✅") || line.startsWith("📋") || line.startsWith("📅") || line.startsWith("🚨")) {
          return <div key={i} className="my-1 font-medium">{line}</div>;
        }
        if (line.trim() === "") return <div key={i} className="h-2" />;
        return <div key={i}>{line}</div>;
      })}
    </div>
  );
}

function TypingMessage({ text, onDone }: { text: string; onDone: () => void }) {
  const visibleText = stripHiddenState(text);
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    if (visibleText.length < 80) {
      setDisplayed(visibleText);
      setDone(true);
      onDone();
      return;
    }
    const tick = () => {
      if (idx.current < visibleText.length) {
        idx.current++;
        setDisplayed(visibleText.slice(0, idx.current));
        setTimeout(tick, visibleText.length > 300 ? 6 : 14);
      } else {
        setDone(true);
        onDone();
      }
    };
    tick();
  }, [visibleText]);

  return (
    <div>
      <MessageContent text={displayed} />
      {!done && <span className="inline-block w-1.5 h-4 bg-teal-400 ml-0.5 animate-pulse rounded-sm" />}
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [typingIds, setTypingIds] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const resolveOnline = async (data: any, historyMsgs: ChatMessage[]): Promise<string> => {
    const chatHistory = historyMsgs.slice(-14).map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    }));
    const fullMessages = [
      { role: "user", content: `${SYSTEM_PROMPT}\n\nContext:\n${data.context}` },
      { role: "assistant", content: "Understood. I will answer based on the provided context only." },
      ...chatHistory,
      { role: "user", content: data.message },
    ];
    // @ts-ignore
    const puterResponse = await (window as any).puter.ai.chat(fullMessages, { model: "gemini-3.5-flash" });
    return typeof puterResponse === "string"
      ? puterResponse
      : puterResponse?.message?.content || puterResponse?.text || puterResponse?.response || JSON.stringify(puterResponse);
  };

  const resolveOfflineStream = (data: any, historyMsgs: ChatMessage[], botId: string): Promise<string> => {
    return new Promise((resolve) => {
      let full = "";
      const history = historyMsgs.slice(-15).map((m) => ({ role: m.sender, content: m.text }));

      fetch("/api/chat-offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: data.message, context: data.context, history }),
      })
        .then((res) => {
          if (!res.body) { resolve("Offline unavailable."); return; }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          const pump = () => {
            reader.read().then(({ done, value }) => {
              if (done) { resolve(full); return; }
              const text = decoder.decode(value, { stream: true });
              const lines = text.split("\n").filter((l) => l.startsWith("data:"));
              for (const line of lines) {
                try {
                  const json = JSON.parse(line.slice(5).trim());
                  if (json.token) {
                    full += json.token;
                    setMessages((prev) =>
                      prev.map((m) => (m.id === botId ? { ...m, text: full } : m))
                    );
                    scrollToBottom();
                  }
                  if (json.done) { resolve(full); return; }
                } catch {}
              }
              pump();
            }).catch(() => resolve(full || "Connection lost."));
          };
          pump();
        })
        .catch(() => resolve("Offline assistant unavailable. Please make sure Ollama is running."));
    });
  };

  useEffect(() => { scrollToBottom(); }, [messages, isLoading]);
  useEffect(() => { if (!isLoading) inputRef.current?.focus(); }, [isLoading]);

  useEffect(() => {
    const welcomeId = Date.now().toString();
    setMessages([{
      id: welcomeId,
      sender: "bot",
      text: "Assalam-o-Alaikum! 👋 I'm the AI assistant of Al-Shifa General Hospital, Karachi.\n\nI can help you:\n• Find a doctor & check timings\n• Book, cancel, or reschedule appointments\n• Answer hospital service questions\n\nHow can I help you today?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
    setTypingIds(new Set([welcomeId]));
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userText = input.trim();
    setInput("");

    const userMsg: ChatMessage = {
      id: Date.now().toString() + "-user",
      sender: "user",
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const history = messages.slice(-15).map((m) => ({ role: m.sender, content: m.text }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
      });
      const data = await response.json();

      if (data.final) {
        const botId = Date.now().toString() + "-bot";
        setMessages((prev) => [...prev, {
          id: botId,
          sender: "bot",
          text: data.response || "Sorry, I couldn't understand that.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]);
        setTypingIds((prev) => new Set(prev).add(botId));
        return;
      }

      if (mode === "offline") {
        const botId = Date.now().toString() + "-bot-stream";
        setMessages((prev) => [...prev, {
          id: botId,
          sender: "bot",
          text: "",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }]);
        await resolveOfflineStream(data, [...messages, userMsg], botId);
        return;
      }

      let botText: string;
      try {
        botText = await resolveOnline(data, [...messages, userMsg]);
      } catch {
        botText = "I'm sorry, I'm unable to answer right now. Please call us at +92-21-3456-7890.";
      }
      const botId = Date.now().toString() + "-bot";
      setMessages((prev) => [...prev, {
        id: botId,
        sender: "bot",
        text: botText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
      setTypingIds((prev) => new Set(prev).add(botId));

    } catch {
      setMessages((prev) => [...prev, {
        id: Date.now().toString() + "-error",
        sender: "bot",
        text: "Connection error. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendQuickMessage = (text: string) => {
    setInput(text);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const quickActions = [
    { icon: <Calendar className="w-4 h-4" />, label: "Book appointment", msg: "I want to book an appointment", color: "text-teal-300" },
    { icon: <Stethoscope className="w-4 h-4" />, label: "Find a doctor", msg: "List all doctors", color: "text-teal-300" },
    { icon: <Clock className="w-4 h-4" />, label: "Visiting hours", msg: "What are the visiting hours?", color: "text-teal-300" },
    { icon: <AlertTriangle className="w-4 h-4" />, label: "Emergency", msg: "What is the emergency contact number?", color: "text-red-400" },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#0f1923" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Syne:wght@600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .font-display { font-family: 'Syne', sans-serif; }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dotPulse { 0%,80%,100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }
        @keyframes orb { 0%,100% { box-shadow: 0 0 0 0 rgba(45,212,191,0.4); } 70% { box-shadow: 0 0 0 6px rgba(45,212,191,0); } }
        @keyframes orbOffline { 0%,100% { box-shadow: 0 0 0 0 rgba(251,146,60,0.4); } 70% { box-shadow: 0 0 0 6px rgba(251,146,60,0); } }

        .anim-msg { animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-fade { animation: fadeIn 0.3s ease both; }
        .dot-typing span { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #2dd4bf; animation: dotPulse 1.4s ease-in-out infinite; }
        .dot-typing span:nth-child(2) { animation-delay: 0.2s; }
        .dot-typing span:nth-child(3) { animation-delay: 0.4s; }
        .status-online { animation: orb 2s ease infinite; }
        .status-offline { animation: orbOffline 2s ease infinite; }
        .glass { background: rgba(255,255,255,0.04); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); }
        .header-gradient { background: linear-gradient(135deg, #0b2437 0%, #0f1923 100%); border-bottom: 1px solid rgba(45,212,191,0.15); }
        .bot-bubble { background: linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%); border: 1px solid rgba(255,255,255,0.10); color: #e2e8f0; }
        .user-bubble { background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); color: #fff; }
        .input-field { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; transition: all 0.2s ease; }
        .input-field::placeholder { color: rgba(226,232,240,0.35); }
        .input-field:focus { outline: none; border-color: rgba(45,212,191,0.5); background: rgba(255,255,255,0.09); box-shadow: 0 0 0 3px rgba(45,212,191,0.08); }
        .send-btn { background: linear-gradient(135deg, #0d9488, #0891b2); transition: all 0.2s ease; }
        .send-btn:hover:not(:disabled) { background: linear-gradient(135deg, #14b8a6, #0ea5e9); transform: scale(1.05); }
        .send-btn:active:not(:disabled) { transform: scale(0.95); }
        .send-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .quick-chip { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); border: 1px solid rgba(255,255,255,0.07); }
        .quick-chip:hover { background: rgba(45,212,191,0.08); border-color: rgba(45,212,191,0.2); transform: translateX(3px); }
        .mode-pill { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
        .sidebar-bg { background: linear-gradient(180deg, #071320 0%, #0b1a28 50%, #071320 100%); border-right: 1px solid rgba(45,212,191,0.1); }
        .cross-line { background: linear-gradient(90deg, transparent, #2dd4bf, transparent); height: 1px; opacity: 0.3; }
        .logo-ring { background: linear-gradient(135deg, #0d9488, #0891b2); padding: 2px; border-radius: 14px; }
        .logo-inner { background: #071320; border-radius: 12px; display: flex; align-items: center; justify-content: center; padding: 8px; }
        .chat-bg { background: #0f1923; background-image: radial-gradient(ellipse at 20% 20%, rgba(13,148,136,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(8,145,178,0.04) 0%, transparent 50%); }
        .msg-content { line-height: 1.65; font-size: 0.9375rem; }
        .timestamp { font-size: 10.5px; color: rgba(148,163,184,0.6); }
        .badge { font-size: 10px; padding: 2px 7px; border-radius: 999px; font-weight: 600; letter-spacing: 0.04em; }
        @media (prefers-reduced-motion: reduce) { .anim-msg, .anim-fade { animation: none; } }
      `}</style>

      {/* Sidebar */}
      <aside className={`sidebar-bg w-72 shrink-0 flex flex-col fixed sm:static inset-y-0 left-0 z-30 transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"}`}>
        <div className="px-5 pt-6 pb-5 flex items-center gap-3.5">
          <div className="logo-ring shrink-0">
            <div className="logo-inner w-10 h-10">
              <svg className="w-5 h-5 text-teal-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14h-2v-4H5v-2h4V7h2v4h4v2h-4v4z" />
              </svg>
            </div>
          </div>
          <div>
            <h1 className="font-display text-white text-lg font-bold leading-tight tracking-tight">Al-Shifa</h1>
            <p className="text-teal-400/70 text-xs font-medium tracking-wide">GENERAL HOSPITAL</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="sm:hidden ml-auto text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="cross-line mx-5" />
        <div className="px-5 py-4">
          <p className="text-slate-500 text-[10.5px] uppercase tracking-widest font-semibold mb-3">System Status</p>
          <div className="glass rounded-xl px-3.5 py-3 flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${mode === "online" ? "bg-teal-400 status-online" : "bg-orange-400 status-offline"}`} />
            <div>
              <p className="text-white text-sm font-medium">{mode === "online" ? "Online" : "Offline"}</p>
              <p className="text-slate-500 text-[11px]">{mode === "online" ? "Gemini · OpenRouter" : "Ollama · phi4-mini · streaming"}</p>
            </div>
            <span className={`ml-auto badge ${mode === "online" ? "bg-teal-400/10 text-teal-400" : "bg-orange-400/10 text-orange-400"}`}>
              {mode === "online" ? "LIVE" : "LOCAL"}
            </span>
          </div>
        </div>
        <div className="px-5 pb-4">
          <p className="text-slate-500 text-[10.5px] uppercase tracking-widest font-semibold mb-2.5">Mode</p>
          <div className="glass rounded-xl p-1 flex gap-1">
            {(["online", "offline"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`mode-pill flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${mode === m ? "bg-teal-500/20 text-teal-300 border border-teal-500/30" : "text-slate-400 hover:text-slate-200"}`}>
                {m === "online" ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="cross-line mx-5" />
        <div className="px-5 py-4 flex-1">
          <p className="text-slate-500 text-[10.5px] uppercase tracking-widest font-semibold mb-3">Quick Actions</p>
          <div className="space-y-1.5">
            {quickActions.map((action, i) => (
              <button key={i} onClick={() => sendQuickMessage(action.msg)}
                className={`quick-chip w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm ${action.color === "text-red-400" ? "text-red-400" : "text-slate-300"}`}>
                <span className={action.color}>{action.icon}</span>
                <span>{action.label}</span>
                <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-40" />
              </button>
            ))}
          </div>
        </div>
        <div className="cross-line mx-5" />
        <div className="px-5 py-4 space-y-2">
          <div className="flex items-center gap-2.5 text-slate-500 text-[11.5px]">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-teal-600" />
            <span>Karachi, Pakistan</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-500 text-[11.5px]">
            <Phone className="w-3.5 h-3.5 shrink-0 text-teal-600" />
            <span>+92-21-3456-7890</span>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 sm:hidden anim-fade" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="header-gradient px-4 py-3.5 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="sm:hidden p-2 -ml-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0b2437] ${mode === "online" ? "bg-teal-400 status-online" : "bg-orange-400"}`} />
              </div>
              <div>
                <h2 className="font-display text-white text-sm sm:text-base font-bold leading-tight">Al-Shifa Assistant</h2>
                <p className="text-slate-500 text-[11px]">
                  {isLoading
                    ? <span className="text-teal-400 animate-pulse">{mode === "offline" ? "Generating…" : "Thinking…"}</span>
                    : mode === "online" ? "Powered by Gemini" : "Running locally · Ollama (streaming)"}
                </p>
              </div>
            </div>
            <div className="ml-auto">
              <span className={`badge ${mode === "online" ? "bg-teal-400/10 text-teal-400 border border-teal-400/20" : "bg-orange-400/10 text-orange-400 border border-orange-400/20"}`}>
                {mode.toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        <main className="chat-bg flex-1 overflow-y-auto px-3 sm:px-5 py-5">
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((msg, idx) => (
              <div key={msg.id} className={`anim-msg flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                style={{ animationDelay: `${Math.min(idx * 0.02, 0.1)}s` }}>
                <div className={`flex gap-2.5 max-w-[90%] sm:max-w-[78%] ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="shrink-0 mt-0.5">
                    {msg.sender === "bot" ? (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                        <Bot className="w-3.5 h-3.5 text-white" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-slate-200" />
                      </div>
                    )}
                  </div>
                  <div className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}>
                    <div className={`px-4 py-3 rounded-2xl ${msg.sender === "user" ? "user-bubble rounded-tr-sm" : "bot-bubble rounded-tl-sm"}`}>
                      {msg.sender === "bot" && typingIds.has(msg.id) ? (
                        <TypingMessage text={msg.text} onDone={() => {
                          setTypingIds((prev) => { const n = new Set(prev); n.delete(msg.id); return n; });
                          scrollToBottom();
                        }} />
                      ) : msg.sender === "bot" ? (
                        msg.text === "" ? (
                          <span className="inline-block w-1.5 h-4 bg-teal-400 animate-pulse rounded-sm" />
                        ) : (
                          <MessageContent text={msg.text} />
                        )
                      ) : (
                        <p className="msg-content">{msg.text}</p>
                      )}
                    </div>
                    <span className="timestamp mt-1 px-1">{msg.timestamp}</span>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && mode === "online" && (
              <div className="anim-msg flex justify-start">
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bot-bubble px-5 py-3.5 rounded-2xl rounded-tl-sm">
                    <div className="dot-typing flex gap-1.5"><span /><span /><span /></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        <div className="shrink-0 px-3 sm:px-5 py-3.5" style={{ background: "#0b1520", borderTop: "1px solid rgba(45,212,191,0.1)" }}>
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 mb-2.5 overflow-x-auto pb-0.5">
              {[
                { label: "Book appointment", msg: "I want to book an appointment" },
                { label: "List doctors", msg: "List all doctors" },
                { label: "Emergency", msg: "What is the emergency contact?" },
              ].map((chip) => (
                <button key={chip.label} onClick={() => sendQuickMessage(chip.msg)} disabled={isLoading}
                  className="shrink-0 px-3 py-1 rounded-full text-[11.5px] font-medium transition-all duration-150 disabled:opacity-30"
                  style={{ background: "rgba(45,212,191,0.07)", border: "1px solid rgba(45,212,191,0.2)", color: "#5eead4" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(45,212,191,0.14)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(45,212,191,0.07)")}>
                  {chip.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2.5">
              <input ref={inputRef} type="text"
                className="input-field flex-1 px-4 py-3 rounded-xl text-sm"
                placeholder="Ask about doctors, appointments, services…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                disabled={isLoading}
              />
              <button onClick={handleSend} disabled={!input.trim() || isLoading}
                className="send-btn p-3 rounded-xl text-white shrink-0">
                <Send className="w-[18px] h-[18px]" />
              </button>
            </div>
            <p className="text-center text-[10px] mt-2" style={{ color: "rgba(100,116,139,0.6)" }}>
              Al-Shifa General Hospital · Karachi · Emergency: +92-21-3456-7999
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
