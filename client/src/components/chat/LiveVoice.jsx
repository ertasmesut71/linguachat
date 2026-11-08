import { useState, useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { getLanguage } from "../../lib/constants";
import socket from "../../api/socket";
import { Mic, MicOff, X, Volume2, VolumeX, Globe } from "lucide-react";

const SpeechRecognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

// Safari has webkitSpeechRecognition but its behavior differs significantly:
// - continuous mode often stops after each utterance
// - interimResults may not fire
// - iOS Safari requires HTTPS for mic access
const isSafari = typeof navigator !== "undefined" &&
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isIOS = typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.userAgent);

/**
 * Map language codes to BCP-47 for SpeechRecognition.
 */
const SPEECH_LANG_MAP = {
  en: "en-US", tr: "tr-TR", es: "es-ES", fr: "fr-FR", de: "de-DE",
  ja: "ja-JP", zh: "zh-CN", ar: "ar-SA", ko: "ko-KR", pt: "pt-BR",
  ru: "ru-RU", hi: "hi-IN", it: "it-IT", nl: "nl-NL", pl: "pl-PL",
};

export default function LiveVoice({ chatId, onClose }) {
  const me = useAuthStore((s) => s.user);
  const { getActiveChat, onlineUsers } = useChatStore();
  const chat = getActiveChat();

  const [isListening, setIsListening] = useState(false);
  const [myTranscript, setMyTranscript] = useState("");
  const [subtitles, setSubtitles] = useState([]); // [{ userId, userName, original, translated, sourceLang, targetLang, isFinal }]
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [error, setError] = useState(null);
  const [isActive, setIsActive] = useState(false);

  const recognitionRef = useRef(null);
  const synthRef = useRef(typeof window !== "undefined" ? window.speechSynthesis : null);
  const restartCountRef = useRef(0); // E13 — cap auto-restarts for Safari (fires onend per sentence)
  const MAX_AUTO_RESTARTS = 50;

  const myLang = me?.primaryLang || "en";

  // Listen for incoming subtitles from other speakers
  useEffect(() => {
    const unsub = socket.on("voice:live:subtitle", (data) => {
      if (data.chatId !== chatId) return;

      setSubtitles((prev) => {
        // Update existing or add new
        const existing = prev.findIndex((s) => s.userId === data.userId && !s.isFinal);
        const entry = {
          userId: data.userId,
          userName: data.userName,
          original: data.originalText,
          translated: data.translatedText,
          sourceLang: data.sourceLang,
          targetLang: data.targetLang,
          isFinal: data.isFinal,
          ts: Date.now(),
        };

        if (existing >= 0) {
          const next = [...prev];
          next[existing] = entry;
          return next;
        }
        return [...prev.slice(-10), entry]; // keep last 10
      });

      // TTS for final transcripts
      if (data.isFinal && ttsEnabled && synthRef.current && data.translatedText) {
        const utterance = new SpeechSynthesisUtterance(data.translatedText);
        utterance.lang = SPEECH_LANG_MAP[data.targetLang] || data.targetLang;
        utterance.rate = 1.0;
        synthRef.current.speak(utterance);
      }
    });

    return unsub;
  }, [chatId, ttsEnabled]);

  // Handle other user stopping
  useEffect(() => {
    const unsub = socket.on("voice:live:stopped", (data) => {
      if (data.chatId !== chatId) return;
      // Clear their subtitles after delay
      setTimeout(() => {
        setSubtitles((prev) => prev.filter((s) => s.userId !== data.userId));
      }, 3000);
    });
    return unsub;
  }, [chatId]);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    // E13 — iOS requires HTTPS for mic access
    if (isIOS && window.location.protocol !== "https:") {
      setError("iOS requires HTTPS for microphone access. Please use a secure connection.");
      return;
    }

    restartCountRef.current = 0; // reset on fresh start

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SPEECH_LANG_MAP[myLang] || myLang;

    recognition.onstart = () => {
      setIsListening(true);
      setIsActive(true);
      socket.send("voice:live:start", { chatId });
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interimTranscript += t;
        }
      }

      if (finalTranscript) {
        setMyTranscript(finalTranscript);
        socket.send("voice:live:chunk", { transcript: finalTranscript, isFinal: true });
        // Clear after brief display
        setTimeout(() => setMyTranscript(""), 3000);
      } else if (interimTranscript) {
        setMyTranscript(interimTranscript);
        socket.send("voice:live:chunk", { transcript: interimTranscript, isFinal: false });
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        setError("Microphone permission denied. Check your browser settings.");
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(`Speech error: ${event.error}`);
      }
    };

    // E13 — Safari fires onend after every sentence even with continuous:true.
    // We auto-restart up to MAX_AUTO_RESTARTS to keep the session alive, then
    // stop gracefully so we don't thrash in an infinite restart loop if the
    // browser is genuinely unable to sustain the session.
    recognition.onend = () => {
      if (isActive && restartCountRef.current < MAX_AUTO_RESTARTS) {
        restartCountRef.current += 1;
        try { recognition.start(); } catch {}
      } else if (isActive && restartCountRef.current >= MAX_AUTO_RESTARTS) {
        setError("Speech session ended — restart limit reached. Tap the mic to start again.");
        setIsListening(false);
        setIsActive(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [chatId, myLang, isActive]);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setIsActive(false);
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent auto-restart
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    socket.send("voice:live:stop", { chatId });
    if (synthRef.current) synthRef.current.cancel();
  }, [chatId]);

  const handleClose = () => {
    stopListening();
    onClose();
  };

  const otherMember = chat?.members?.find((m) => m.userId !== me?.id);
  const otherUser = otherMember?.user;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(12px)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", zIndex: 100,
      animation: "fadeIn 0.3s ease", padding: 24,
    }}>
      {/* Close button */}
      <button onClick={handleClose} style={{
        position: "absolute", top: 20, right: 20,
        width: 40, height: 40, borderRadius: "50%", border: "none",
        background: "rgba(255,255,255,0.1)", color: "white",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      }}><X size={20} /></button>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "white", marginBottom: 4 }}>
          Live Voice Translation
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
          {otherUser ? `With ${otherUser.displayName}` : chat?.name || "Conversation"}
          <span style={{ margin: "0 8px" }}>·</span>
          <Globe size={12} style={{ verticalAlign: -1 }} /> {getLanguage(myLang)?.flag} {getLanguage(myLang)?.name}
        </div>
      </div>

      {/* Subtitles area — other speakers */}
      <div style={{
        width: "100%", maxWidth: 600, minHeight: 120, marginBottom: 24,
        display: "flex", flexDirection: "column", gap: 8, alignItems: "center",
      }}>
        {subtitles.filter((s) => s.userId !== me?.id).map((s, i) => (
          <div key={`${s.userId}-${i}`} style={{
            background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 16px",
            maxWidth: "90%", textAlign: "center",
            border: s.isFinal ? "1px solid var(--accent)" : "1px solid transparent",
            animation: "fadeIn 0.2s ease",
          }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>
              {s.userName} · {getLanguage(s.sourceLang)?.flag} → {getLanguage(s.targetLang)?.flag}
            </div>
            <div style={{ fontSize: 16, color: "white", lineHeight: 1.5 }}>
              {s.translated}
            </div>
            {s.original !== s.translated && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4, fontStyle: "italic" }}>
                {s.original}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* My transcript */}
      {myTranscript && (
        <div style={{
          background: "var(--accent)", borderRadius: 12, padding: "8px 16px",
          maxWidth: "80%", textAlign: "center", marginBottom: 24,
          color: "white", fontSize: 14, animation: "fadeIn 0.15s ease",
        }}>
          🎤 {myTranscript}
        </div>
      )}

      {/* E13 — Safari/iOS capability warning */}
      {isSafari && !error && (
        <div style={{
          background: "rgba(253, 203, 110, 0.15)", border: "1px solid rgba(253, 203, 110, 0.3)",
          borderRadius: 10, padding: "8px 14px", maxWidth: "85%",
          textAlign: "center", marginBottom: 12, fontSize: 12, color: "var(--yellow)", lineHeight: 1.5,
        }}>
          ⚠ Safari has limited speech recognition — it may pause between sentences and interim results
          may not appear.{isIOS && window.location.protocol !== "https:" && " iOS also requires HTTPS for mic access."}
          {" "}For the best experience, use Chrome or Edge.
          Receiving translated subtitles from others works normally.
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
          {error}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {/* TTS toggle */}
        <button onClick={() => { setTtsEnabled(!ttsEnabled); if (synthRef.current) synthRef.current.cancel(); }} style={{
          width: 48, height: 48, borderRadius: "50%", border: "none",
          background: ttsEnabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
          color: ttsEnabled ? "white" : "rgba(255,255,255,0.3)",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }} title={ttsEnabled ? "Mute TTS" : "Enable TTS"}>
          {ttsEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>

        {/* Mic button */}
        <button onClick={isListening ? stopListening : startListening} style={{
          width: 72, height: 72, borderRadius: "50%", border: "none",
          background: isListening ? "var(--red)" : "var(--accent)",
          color: "white", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, transition: "all 0.2s ease",
          boxShadow: isListening ? "0 0 0 0 rgba(225,112,85,0.4)" : "none",
          animation: isListening ? "recordPulse 1.5s infinite" : "none",
        }}>
          {isListening ? <MicOff size={28} /> : <Mic size={28} />}
        </button>

        {/* End call */}
        <button onClick={handleClose} style={{
          width: 48, height: 48, borderRadius: "50%", border: "none",
          background: "var(--red)", color: "white",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }} title="End voice session">
          <X size={20} />
        </button>
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
        {isListening ? "Listening... speak naturally" : "Tap the microphone to start speaking"}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes recordPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225,112,85,0.4); }
          50% { box-shadow: 0 0 0 20px rgba(225,112,85,0); }
        }
      `}</style>
    </div>
  );
}
