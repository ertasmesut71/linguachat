import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuthStore } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import { getLanguage } from "../../lib/constants";
import { mediaUrl } from "../../api/client";
import api from "../../api/client";
import {
  Check, CheckCheck, Clock, Globe, ChevronDown, ChevronUp,
  Play, Pause, Mic, FileText, Download, Image, Video,
  Sparkles, Eye, Trash2, Reply, MoreVertical, Copy,
  RefreshCw, Languages, AlertCircle, Loader,
  Star, Pin, PinOff, Pencil, BoxSelect,
} from "lucide-react";

// BCP-47 locale tags for Web Speech API — mirrors LiveVoice.jsx SPEECH_LANG_MAP
const SPEECH_LANG_MAP = {
  en: "en-US", tr: "tr-TR", es: "es-ES", fr: "fr-FR", de: "de-DE",
  ja: "ja-JP", zh: "zh-CN", ar: "ar-SA", ko: "ko-KR", pt: "pt-BR",
  ru: "ru-RU", hi: "hi-IN", it: "it-IT", nl: "nl-NL", pl: "pl-PL",
};

/**
 * Select the best matching SpeechSynthesisVoice for a given BCP-47 locale.
 * Priority: exact locale match (e.g. "en-US") → base language prefix (e.g. "en-*") → null.
 * Returns null when no match is found so the browser default is used.
 *
 * @param {string} locale - BCP-47 locale string (e.g. "en-US", "tr-TR")
 * @param {SpeechSynthesisVoice[]} voices - voices from speechSynthesis.getVoices()
 * @returns {SpeechSynthesisVoice|null}
 */
function selectVoice(locale, voices) {
  if (!locale || !voices || voices.length === 0) return null;
  const localeLower = locale.toLowerCase();
  // 1. Exact match (case-insensitive)
  const exact = voices.find((v) => v.lang.toLowerCase() === localeLower);
  if (exact) return exact;
  // 2. Base language prefix match (e.g. "en" matches "en-GB", "en-US", etc.)
  const base = locale.split("-")[0].toLowerCase();
  const prefix = voices.find((v) => v.lang.toLowerCase().startsWith(base + "-") || v.lang.toLowerCase() === base);
  return prefix || null;
}

function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function formatDur(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

// Which MIME types / extensions are eligible for document intelligence
const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/markdown", "text/csv", "application/json", "application/rtf",
]);
const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|txt|md|csv|json|rtf)$/i;

function isSummarizable(meta) {
  if (!meta) return false;
  if (meta.mimeType && DOC_MIMES.has(meta.mimeType)) return true;
  if (meta.originalName && DOC_EXT_RE.test(meta.originalName)) return true;
  return false;
}

function StatusIcon({ status }) {
  if (status === "seen") return <CheckCheck size={13} style={{ color: "var(--blue)" }} />;
  if (status === "delivered") return <CheckCheck size={13} style={{ opacity: 0.6 }} />;
  if (status === "sent") return <Check size={13} style={{ opacity: 0.6 }} />;
  return <Clock size={11} style={{ opacity: 0.4 }} />;
}

function WaveformBars({ isMine }) {
  const bars = useMemo(() => Array.from({ length: 28 }, () => Math.random() * 18 + 4), []);
  return <div style={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, height: 28 }}>{bars.map((h, i) => <div key={i} style={{ width: 2.5, height: h, borderRadius: 1.5, background: isMine ? "rgba(255,255,255,0.45)" : "var(--accent)", opacity: 0.6 }} />)}</div>;
}

/**
 * Small pill button used inside a bubble. Designed to look good on both
 * "mine" (accent background) and "theirs" (surface background) bubbles.
 */
function BubbleAction({ onClick, icon: Icon, label, isMine, title }) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      title={title || label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "3px 8px", borderRadius: "var(--radius-full)",
        fontSize: 11, fontWeight: 500,
        border: isMine ? "1px solid rgba(255,255,255,0.35)" : "1px solid var(--border)",
        background: isMine ? "rgba(255,255,255,0.12)" : "var(--bg-tertiary)",
        color: isMine ? "white" : "var(--accent)",
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <Icon size={11} /> {label}
    </button>
  );
}

/**
 * MessageBubble props (new in Part 3):
 *   onOpenDocChat(fileId, originalName, kindHint)
 *     - called when user clicks "Summarize" on a file bubble
 *       or "OCR" on an image bubble
 *     - kindHint: "image" | "file" (document)
 */
export default function MessageBubble({ message, showSender, isGroup, onOpenDocChat, onSelect, isSelected, selectionMode }) {
  const me = useAuthStore((s) => s.user);
  const {
    deleteMessage, setReplyTo, hideMessageForMe,
    starMessage, unstarMessage, starredMessageIds,
    pinMessage, unpinMessage, pinnedMessages,
    editMessage, activeChatId,
    enterSelectionMode, toggleMessageSelection,
    highlightedMessageId, getBilingualMode,
  } = useChatStore();
  const isMine = message.senderId === me?.id || message.senderId === "__self__";
  const isStarred = starredMessageIds?.has(message.id);
  const isPinned = pinnedMessages?.some((p) => p.id === message.id);
  const isHighlighted = highlightedMessageId === message.id;

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const sender = message.sender;
  const status = message._aggregateStatus || "sent";
  const translation = message.translation;
  const allTrans = message._allTranslations;
  const meta = message.metadata || {};

  const bilingualMode = getBilingualMode(message.chatId);
  const [showOriginal, setShowOriginal] = useState(bilingualMode);
  const [showSentTrans, setShowSentTrans] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [voiceTranslation, setVoiceTranslation] = useState(null); // Feature C/D live update
  const [voiceTransState, setVoiceTransState] = useState(null);   // "retranslating" | "error" | null
  const [showSourceOverride, setShowSourceOverride] = useState(false);
  const [overrideLang, setOverrideLang] = useState("");
  const audioRef = useRef(null);

  // TTS — browser Web Speech API (Feature A/B/C/D/E)
  const synthRef = useRef(typeof window !== "undefined" ? window.speechSynthesis : null);
  const voicesRef = useRef([]);                             // cached SpeechSynthesisVoice list
  const [ttsState, setTtsState] = useState(null);          // null | "speaking" | "error"
  const [ttsCachedKey, setTtsCachedKey] = useState(null);  // translated text that was last spoken (cache sentinel)

  // Load voices immediately (Chrome) and via voiceschanged (async in Firefox/Safari).
  // voiceschanged may fire multiple times; we always update voicesRef from the latest call.
  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length > 0) voicesRef.current = v;
    };
    loadVoices(); // Chrome: voices may already be available synchronously
    synth.addEventListener("voiceschanged", loadVoices);
    return () => {
      synth.removeEventListener("voiceschanged", loadVoices);
    };
  }, []); // run once on mount; synthRef.current is stable

  const isDeleted = !!message.deletedAt;

  const isVoice = message.type === "voice";
  const isImage = message.type === "image";
  const isVideo = message.type === "video";
  const isFile = message.type === "file";
  const isSystem = message.type === "system";
  const hasTranslation = translation?.translatedText && translation.translatedText !== message.content;
  const sentTransEntries = allTrans ? Object.values(allTrans) : [];

  // Build auth-bearing URLs (Part 1 fix preserved).
  const imageHref = useMemo(() => mediaUrl(meta.url), [meta.url]);
  const videoHref = useMemo(() => mediaUrl(meta.url), [meta.url]);
  const audioHref = useMemo(() => mediaUrl(meta.audioUrl), [meta.audioUrl]);
  const downloadHref = useMemo(() => {
    if (!meta.url) return null;
    const base = meta.url.replace(/\?.*$/, "");
    const withDownload = base.endsWith("/download") ? base : `${base}/download`;
    return mediaUrl(withDownload);
  }, [meta.url]);

  // Part 3: does this bubble support document-intelligence actions?
  const fileId = meta.fileId || null;
  const canSummarize = !!onOpenDocChat && isFile && fileId && isSummarizable(meta);
  const canOcr = !!onOpenDocChat && isImage && fileId;

  const handleSummarize = () => {
    if (!fileId) return;
    onOpenDocChat(fileId, meta.originalName || "", "file");
  };
  const handleOcr = () => {
    if (!fileId) return;
    onOpenDocChat(fileId, meta.originalName || "", "image");
  };

  // ─── System message ───
  if (isSystem) {
    return (
      <div style={{ textAlign: "center", padding: "6px 0", fontSize: 12, color: "var(--text-tertiary)", fontStyle: "italic" }}>
        {message.content}
      </div>
    );
  }

  const TranslationExpander = ({ forSender }) => {
    if (forSender && sentTransEntries.length > 0) return (
      <>
        <div onClick={() => setShowSentTrans(!showSentTrans)} style={{ marginTop: 6, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11, opacity: 0.7 }}>
          <Globe size={10} /><span style={{ flex: 1 }}>Translated to {sentTransEntries.length} lang{sentTransEntries.length > 1 ? "s" : ""}</span>
          {showSentTrans ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
        {showSentTrans && sentTransEntries.map((t, i) => <div key={i} style={{ marginTop: 3, fontSize: 12, opacity: 0.75, display: "flex", gap: 4 }}><span>{getLanguage(t.targetLang)?.flag}</span><span style={{ fontStyle: "italic" }}>{t.translatedText}</span></div>)}
      </>
    );
    if (!forSender && hasTranslation) return (
      <>
        <div onClick={() => setShowOriginal(!showOriginal)} style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${isMine ? "rgba(255,255,255,0.15)" : "var(--border)"}`, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: isMine ? "rgba(255,255,255,0.5)" : "var(--text-tertiary)" }}>
          <Globe size={10} /><span style={{ flex: 1 }}>Original ({getLanguage(translation.sourceLang)?.flag})</span>
          {showOriginal ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
        {showOriginal && <div style={{ marginTop: 4, fontSize: 13, fontStyle: "italic", opacity: 0.6 }}>{message.content}</div>}
      </>
    );
    return null;
  };

  const handleDelete = async () => {
    if (!confirm("Delete this message?")) return;
    try { await deleteMessage(message.id); } catch {}
  };

  const handleHideForMe = async () => {
    if (!confirm("Delete this message for you? It will stay visible to everyone else.")) return;
    try {
      await hideMessageForMe(message.id, message.chatId);
    } catch (err) {
      // The API client already toasts HTTP errors (other than 400); surface the rest here.
      if (!err?.status || err.status === 400) {
        const msg = err?.message || "Could not delete the message";
        if (window.__linguachat_toast) window.__linguachat_toast(msg, "error"); else alert(msg);
      }
    }
  };

  const handleCopy = async () => {
    const translatedText = message.translation?.translatedText;
    const text = (translatedText && translatedText !== message.content) ? translatedText : (message.content || "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
  };

  const handleReply = () => {
    setReplyTo(message);
  };

  // Star/Unstar
  const handleStar = async () => {
    try { await starMessage(message.id); } catch {}
  };
  const handleUnstar = async () => {
    try { await unstarMessage(message.id); } catch {}
  };

  // Pin/Unpin
  const handlePin = async () => {
    try { await pinMessage(activeChatId, message.id); } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Could not pin message";
      if (window.__linguachat_toast) window.__linguachat_toast(msg, "error"); else alert(msg);
    }
  };
  const handleUnpin = async () => {
    try { await unpinMessage(activeChatId, message.id); } catch {}
  };

  // Edit
  const handleStartEdit = () => {
    setEditContent(message.content || "");
    setEditError(null);
    setIsEditing(true);
  };
  const handleCancelEdit = () => { setIsEditing(false); setEditError(null); };
  const handleSaveEdit = async () => {
    const trimmed = editContent.trim();
    if (!trimmed) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await editMessage(message.id, trimmed);
      setIsEditing(false);
    } catch (err) {
      setEditError(err?.response?.data?.error || "Failed to save edit");
    }
    setEditLoading(false);
  };

  // Select
  const handleSelect = () => {
    if (selectionMode) { toggleMessageSelection(message.id); }
    else { enterSelectionMode(message.id); }
  };

  // Feature C — Retranslate voice transcript
  const handleRetranslate = useCallback(async () => {
    if (voiceTransState === "retranslating") return;
    setVoiceTransState("retranslating");
    // Feature F: invalidate TTS cache when translation changes
    if (synthRef.current) synthRef.current.cancel();
    setTtsState(null);
    setTtsCachedKey(null);
    try {
      const res = await api.post(`/voice/messages/${message.id}/retranslate`);
      const data = res.data?.data || res.data;
      if (data?.translatedText) {
        setVoiceTranslation({ translatedText: data.translatedText, sourceLang: data.sourceLang, targetLang: data.targetLang });
      }
      setVoiceTransState(null);
    } catch (err) {
      console.error("[retranslate]", err);
      setVoiceTransState("error");
    }
  }, [message.id, voiceTransState]);

  // Feature D — Source language override
  const handleSourceOverride = useCallback(async () => {
    if (!overrideLang || voiceTransState === "retranslating") return;
    setVoiceTransState("retranslating");
    // Feature G: invalidate TTS cache when source override causes new translation
    if (synthRef.current) synthRef.current.cancel();
    setTtsState(null);
    setTtsCachedKey(null);
    try {
      const res = await api.post(`/voice/messages/${message.id}/source-lang`, { sourceLang: overrideLang });
      const data = res.data?.data || res.data;
      if (data?.translatedText) {
        setVoiceTranslation({ translatedText: data.translatedText, sourceLang: data.sourceLang, targetLang: data.targetLang });
      }
      setVoiceTransState(null);
      setShowSourceOverride(false);
    } catch (err) {
      console.error("[source-override]", err);
      setVoiceTransState("error");
    }
  }, [message.id, overrideLang, voiceTransState]);

  // Feature A/B/C — Lazy TTS: synthesize translated audio on demand (browser Web Speech API)
  const handlePlayTranslation = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return; // browser doesn't support SpeechSynthesis
    const text = (voiceTranslation || translation)?.translatedText;
    const targetLang = (voiceTranslation || translation)?.targetLang;
    if (!text) return;

    // Stop any in-progress speech (original audio or previous TTS)
    synth.cancel();
    if (audioRef.current) { audioRef.current.pause(); setIsPlaying(false); }

    // Feature D: if same text was already spoken and not invalidated, re-speak (cache hit — still re-synthesise
    // since Web Speech API produces no storable Blob; "cache" here means we don't show "stale" warning)
    setTtsState("speaking");
    setTtsCachedKey(text); // mark this translation text as current

    const utterance = new SpeechSynthesisUtterance(text);
    const locale = SPEECH_LANG_MAP[targetLang] || targetLang || "en-US";
    utterance.lang = locale;
    // Explicitly set voice to override the browser default (e.g. system default Turkish voice).
    // selectVoice returns null when no match found → browser default used as-is.
    const voice = selectVoice(locale, voicesRef.current);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.onend = () => setTtsState(null);
    utterance.onerror = () => setTtsState("error");
    synth.speak(utterance);
  }, [voiceTranslation, translation]);

  // ─── Deleted message ─── (must be after ALL hooks to avoid Rules-of-Hooks violation)
  if (isDeleted) {
    return (
      <div style={{ maxWidth: "78%", alignSelf: isMine ? "flex-end" : "flex-start", display: "flex", flexDirection: "column", alignItems: isMine ? "flex-end" : "flex-start", gap: 2 }}>
        <div style={{
          padding: "10px 15px", borderRadius: 16,
          borderBottomRightRadius: isMine ? 4 : 16, borderBottomLeftRadius: isMine ? 16 : 4,
          background: isMine ? "var(--accent)" : "var(--surface-raised)",
          opacity: 0.5, fontSize: 13, fontStyle: "italic",
          color: isMine ? "rgba(255,255,255,0.7)" : "var(--text-tertiary)",
        }}>
          🚫 This message was deleted
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, paddingRight: isMine ? 2 : 0, paddingLeft: isMine ? 0 : 2 }}>
          <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{formatTime(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  // Resolved translation for voice: prefer live override result, then server-delivered
  const effectiveVoiceTranslation = voiceTranslation || translation;
  const hasVoiceTranslation = isVoice && effectiveVoiceTranslation?.translatedText &&
    effectiveVoiceTranslation.translatedText !== (meta.originalTranscript || message.content);

  // Feature E — voice transcript status
  const sttStatus = meta.sttStatus; // "ok" | "placeholder" | "failed"
  const translationStatus = meta.translationStatus; // "ok" | "pending" | "failed"

  return (
    <div
      style={{
        maxWidth: "78%", alignSelf: isMine ? "flex-end" : "flex-start",
        display: "flex", flexDirection: "column",
        alignItems: isMine ? "flex-end" : "flex-start",
        gap: 2, animation: "msgSlideIn 0.25s ease-out", position: "relative",
        outline: isHighlighted ? "2px solid var(--accent)" : isSelected ? "2px solid var(--accent)" : "none",
        outlineOffset: 4, borderRadius: 8,
        background: isHighlighted ? "var(--accent-soft)" : isSelected ? "var(--accent-soft)" : "transparent",
        transition: "background 0.3s, outline 0.3s",
        cursor: selectionMode ? "pointer" : "default",
      }}
      onClick={selectionMode ? handleSelect : undefined}
      onMouseEnter={() => !selectionMode && setShowActions(true)}
      onMouseLeave={() => !selectionMode && setShowActions(false)}
    >
      {/* Selection checkbox */}
      {selectionMode && (
        <div style={{
          position: "absolute", [isMine ? "right" : "left"]: -28, top: "50%", transform: "translateY(-50%)",
          width: 20, height: 20, borderRadius: "50%",
          border: `2px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
          background: isSelected ? "var(--accent)" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {isSelected && <Check size={11} style={{ color: "white" }} />}
        </div>
      )}
      {/* Hover action bar */}
      {showActions && !selectionMode && (
        <div style={{
          position: "absolute", top: -4, [isMine ? "left" : "right"]: -4, zIndex: 10,
          display: "flex", gap: 2, background: "var(--surface-raised)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
          padding: "2px 4px", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}>
          <button onClick={handleCopy} title="Copy" style={{
            width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
            color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}><Copy size={14} /></button>
          <button onClick={handleReply} title="Reply" style={{
            width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
            color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}><Reply size={14} /></button>
          {/* Star/Unstar */}
          <button onClick={isStarred ? handleUnstar : handleStar}
            title={isStarred ? "Unstar" : "Star"}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
              color: isStarred ? "var(--yellow, #f59e0b)" : "var(--text-secondary)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Star size={14} fill={isStarred ? "currentColor" : "none"} />
          </button>
          {/* Pin/Unpin */}
          <button onClick={isPinned ? handleUnpin : handlePin}
            title={isPinned ? "Unpin" : "Pin"}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
              color: isPinned ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          {/* Edit — own text messages only */}
          {isMine && !isDeleted && !isVoice && !isImage && !isVideo && !isFile && (
            <button onClick={handleStartEdit} title="Edit" style={{
              width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}><Pencil size={14} /></button>
          )}
          {/* Select */}
          <button onClick={handleSelect} title="Select" style={{
            width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
            color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}><BoxSelect size={14} /></button>
          {!isMine && (
            <button onClick={handleHideForMe} title="Delete for me" aria-label="Delete for me" style={{
              width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
              color: "var(--red)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}><Trash2 size={14} /></button>
          )}
          {isMine && (
            <button onClick={handleDelete} title="Delete" style={{
              width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
              color: "var(--red)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}><Trash2 size={14} /></button>
          )}
        </div>
      )}

      {showSender && !isMine && isGroup && sender && (
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", paddingLeft: 14, marginBottom: 1 }}>
          {sender.displayName} · {getLanguage(sender.primaryLang)?.flag}
        </div>
      )}

      <div style={{
        padding: (isImage || isVideo) ? 4 : "10px 15px", borderRadius: 16,
        borderBottomRightRadius: isMine ? 4 : 16, borderBottomLeftRadius: isMine ? 16 : 4,
        background: isMine ? "var(--accent)" : "var(--surface-raised)",
        color: isMine ? "white" : "var(--text-primary)",
        fontSize: 14, lineHeight: 1.5, wordBreak: "break-word",
        opacity: message._isOptimistic && status === "sending" ? 0.7 : 1,
        border: isMine ? "none" : "1px solid var(--border-subtle)",
        minWidth: isVoice ? 240 : hasTranslation ? 200 : undefined,
        overflow: "hidden",
      }}>
        {/* Reply-to context bar */}
        {message.replyToId && message.replyTo && (
          <div style={{
            padding: "6px 10px", marginBottom: 6,
            borderLeft: `3px solid ${isMine ? "rgba(255,255,255,0.5)" : "var(--accent)"}`,
            background: isMine ? "rgba(255,255,255,0.1)" : "var(--bg-tertiary)",
            borderRadius: "0 6px 6px 0", fontSize: 12, lineHeight: 1.4,
          }}>
            <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
              {message.replyTo.sender?.displayName || "Message"}
            </div>
            <div style={{ opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 250 }}>
              {message.replyTo.content?.slice(0, 80) || (message.replyTo.type === "voice" ? "🎤 Voice message" : message.replyTo.type === "image" ? "📷 Image" : "📎 File")}
            </div>
          </div>
        )}

        {/* ═══ IMAGE ═══ */}
        {isImage && (
          <>
            {imageHref && !imgError ? (
              <a href={downloadHref || imageHref} target="_blank" rel="noreferrer" download={meta.originalName || undefined}>
                <img
                  src={imageHref}
                  alt={meta.originalName || "Image"}
                  onError={() => setImgError(true)}
                  style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 12, display: "block", cursor: "zoom-in" }}
                />
              </a>
            ) : (
              <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 10, color: isMine ? "rgba(255,255,255,0.85)" : "var(--text-secondary)" }}>
                <Image size={24} style={{ opacity: 0.7 }} />
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 500 }}>{meta.originalName || "Image"}</div>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>Preview unavailable</div>
                </div>
                {downloadHref && (
                  <a href={downloadHref} download={meta.originalName || undefined} style={{ color: "inherit", marginLeft: "auto", display: "flex", alignItems: "center" }}>
                    <Download size={16} />
                  </a>
                )}
              </div>
            )}

            {/* Caption + Part 3 OCR button */}
            {(message.content && message.content !== meta.originalName) || canOcr ? (
              <div style={{ padding: "6px 10px 6px", fontSize: 13 }}>
                {message.content && message.content !== meta.originalName && (
                  <div style={{ marginBottom: canOcr ? 6 : 0 }}>
                    {!isMine && hasTranslation ? translation.translatedText : message.content}
                    <TranslationExpander forSender={isMine} />
                  </div>
                )}
                {canOcr && (
                  <BubbleAction onClick={handleOcr} icon={Eye} label="OCR + translate" isMine={isMine} title="Extract and translate text from this image" />
                )}
              </div>
            ) : null}
          </>
        )}

        {/* ═══ VIDEO ═══ */}
        {isVideo && (
          <>
            {videoHref ? (
              <video
                src={videoHref}
                controls
                preload="metadata"
                style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 12, display: "block", background: "#000" }}
              />
            ) : (
              <div style={{ padding: "20px 16px", display: "flex", alignItems: "center", gap: 10, color: isMine ? "rgba(255,255,255,0.85)" : "var(--text-secondary)" }}>
                <Video size={24} style={{ opacity: 0.7 }} />
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 500 }}>{meta.originalName || "Video"}</div>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>Video unavailable</div>
                </div>
              </div>
            )}
            {/* Caption / filename row */}
            <div style={{ padding: "6px 10px 4px", fontSize: 12, color: isMine ? "rgba(255,255,255,0.85)" : "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
              <Video size={11} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.originalName || "Video"}</span>
              {meta.size ? <span style={{ opacity: 0.6, fontSize: 11 }}>{formatBytes(meta.size)}</span> : null}
              {downloadHref && (
                <a href={downloadHref} download={meta.originalName || undefined} style={{ color: "inherit", display: "flex", alignItems: "center" }} title="Download">
                  <Download size={13} />
                </a>
              )}
            </div>
            {message.content && message.content !== meta.originalName && (
              <div style={{ padding: "0 10px 4px", fontSize: 13 }}>
                {!isMine && hasTranslation ? translation.translatedText : message.content}
                <TranslationExpander forSender={isMine} />
              </div>
            )}
          </>
        )}

        {/* ═══ FILE ═══ */}
        {isFile && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: isMine ? "rgba(255,255,255,0.15)" : "var(--bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={18} style={{ color: isMine ? "white" : "var(--text-tertiary)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.originalName || "File"}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{meta.size ? formatBytes(meta.size) : ""}</div>
              </div>
              {downloadHref && (
                <a
                  href={downloadHref}
                  download={meta.originalName || undefined}
                  style={{ color: isMine ? "white" : "var(--accent)", display: "flex", alignItems: "center", padding: 6 }}
                  title="Download"
                >
                  <Download size={16} />
                </a>
              )}
            </div>
            {/* Part 3: Summarize action */}
            {canSummarize && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <BubbleAction onClick={handleSummarize} icon={Sparkles} label="Summarize" isMine={isMine} title="Summarize this document with AI" />
                <BubbleAction onClick={handleSummarize} icon={FileText} label="Ask" isMine={isMine} title="Ask questions about this document" />
              </div>
            )}
          </>
        )}

        {/* ═══ VOICE ═══ */}
        {isVoice && (
          <>
            {/* Playback row — always shown; original audio is always preserved */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              {/* ▶ Original button */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <button
                  onClick={() => {
                    if (!audioRef.current) return;
                    // Stop any TTS before playing original
                    if (synthRef.current) { synthRef.current.cancel(); setTtsState(null); }
                    isPlaying ? audioRef.current.pause() : audioRef.current.play();
                    setIsPlaying(!isPlaying);
                  }}
                  disabled={!audioHref}
                  title="Play original recording"
                  style={{
                    width: 34, height: 34, borderRadius: "50%", border: "none",
                    background: isPlaying ? (isMine ? "rgba(255,255,255,0.35)" : "var(--accent)") : (isMine ? "rgba(255,255,255,0.2)" : "var(--accent-soft)"),
                    color: isPlaying ? "white" : (isMine ? "white" : "var(--accent)"),
                    cursor: audioHref ? "pointer" : "default",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.15s",
                  }}
                >
                  {audioHref ? (isPlaying ? <Pause size={14} /> : <Play size={14} />) : <Mic size={14} />}
                </button>
                {audioHref && (
                  <span style={{ fontSize: 9, opacity: 0.55, whiteSpace: "nowrap", letterSpacing: 0 }}>Original</span>
                )}
              </div>

              {/* ▶ Translation button — only shown for receivers with a translated text (Feature B) */}
              {!isMine && hasVoiceTranslation && synthRef.current !== null && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <button
                    onClick={handlePlayTranslation}
                    disabled={ttsState === "speaking"}
                    title={`Play translated audio (${effectiveVoiceTranslation?.targetLang?.toUpperCase() || ""})`}
                    style={{
                      width: 34, height: 34, borderRadius: "50%",
                      background: ttsState === "speaking"
                        ? (isMine ? "rgba(255,255,255,0.35)" : "var(--accent)")
                        : ttsState === "error"
                        ? "var(--red-soft, rgba(239,68,68,0.12))"
                        : (isMine ? "rgba(255,255,255,0.12)" : "var(--bg-tertiary)"),
                      color: ttsState === "speaking"
                        ? "white"
                        : ttsState === "error"
                        ? "var(--red)"
                        : (isMine ? "rgba(255,255,255,0.85)" : "var(--accent)"),
                      border: isMine ? "1px solid rgba(255,255,255,0.3)" : "1px solid var(--border)",
                      cursor: ttsState === "speaking" ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 0.15s",
                    }}
                  >
                    {ttsState === "speaking" ? <Pause size={14} /> : ttsState === "error" ? <AlertCircle size={14} /> : <Play size={14} />}
                  </button>
                  <span style={{ fontSize: 9, opacity: 0.55, whiteSpace: "nowrap" }}>
                    {ttsState === "speaking" ? "Speaking…" : ttsState === "error" ? "TTS error" : `${effectiveVoiceTranslation?.targetLang?.toUpperCase() || "Trans"}`}
                  </span>
                </div>
              )}

              <WaveformBars isMine={isMine} />
              <span style={{ fontSize: 11, opacity: 0.7, minWidth: 32, textAlign: "right" }}>{meta.duration ? formatDur(meta.duration) : "0:00"}</span>
            </div>
            {audioHref && <audio ref={audioRef} src={audioHref} preload="none" onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} style={{ display: "none" }} />}

            {/* Feature E: TTS error retry */}
            {!isMine && ttsState === "error" && (
              <div style={{ marginBottom: 4, fontSize: 11, display: "flex", alignItems: "center", gap: 6, color: "var(--red)" }}>
                <AlertCircle size={11} />
                <span>Translated audio unavailable</span>
                <button onClick={handlePlayTranslation} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--accent)", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 2 }}>
                  <RefreshCw size={10} /> Retry
                </button>
              </div>
            )}

            {/* Feature E — explicit transcript/translation status */}
            {isMine && sttStatus === "failed" && (
              <div style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, opacity: 0.7, marginBottom: 4 }}>
                <AlertCircle size={11} /> <span>Transcription unavailable</span>
              </div>
            )}

            {/* Transcript area — Feature B: show translation by default, toggle to original */}
            <div style={{ fontSize: 13, fontStyle: "italic", opacity: 0.8 }}>
              {!isMine && hasVoiceTranslation && !showOriginal
                ? effectiveVoiceTranslation.translatedText
                : (meta.originalTranscript || message.content)}
            </div>

            {/* Feature B: Original/Translation toggle (receiver side) */}
            {!isMine && hasVoiceTranslation && (
              <div onClick={() => setShowOriginal(!showOriginal)} style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${isMine ? "rgba(255,255,255,0.15)" : "var(--border)"}`, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: isMine ? "rgba(255,255,255,0.5)" : "var(--text-tertiary)" }}>
                <Globe size={10} />
                <span style={{ flex: 1 }}>
                  {showOriginal ? `Translation (${effectiveVoiceTranslation.targetLang?.toUpperCase()})` : `Original (${getLanguage(effectiveVoiceTranslation.sourceLang)?.flag || effectiveVoiceTranslation.sourceLang?.toUpperCase()})`}
                </span>
                {showOriginal ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </div>
            )}

            {/* Feature E — translation pending/failed state with retry */}
            {!isMine && !hasVoiceTranslation && translationStatus === "failed" && (
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.7 }}>
                <AlertCircle size={11} />
                <span>Translation unavailable</span>
                <button onClick={handleRetranslate} disabled={voiceTransState === "retranslating"} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--accent)", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 2 }}>
                  <RefreshCw size={10} /> Retry
                </button>
              </div>
            )}

            {/* Feature C — Retranslate button (always available for receiver) */}
            {!isMine && voiceTransState === "retranslating" && (
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.6, display: "flex", alignItems: "center", gap: 4 }}>
                <Loader size={10} style={{ animation: "spin 1s linear infinite" }} /> Translating…
              </div>
            )}
            {!isMine && voiceTransState === "error" && (
              <div style={{ marginTop: 4, fontSize: 11, color: "var(--red)", display: "flex", alignItems: "center", gap: 4 }}>
                <AlertCircle size={10} /> Translation failed —{" "}
                <button onClick={handleRetranslate} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, color: "var(--accent)", fontSize: 11, fontFamily: "inherit" }}>Retry</button>
              </div>
            )}
            {!isMine && voiceTransState === null && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <BubbleAction onClick={handleRetranslate} icon={RefreshCw} label="Retranslate" isMine={isMine} title="Retranslate into your current language" />
                <BubbleAction onClick={() => setShowSourceOverride(!showSourceOverride)} icon={Languages} label="Source lang" isMine={isMine} title="Override detected source language" />
              </div>
            )}

            {/* Feature D — Source language override picker */}
            {!isMine && showSourceOverride && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select value={overrideLang} onChange={(e) => setOverrideLang(e.target.value)} style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontFamily: "inherit" }}>
                  <option value="">— select —</option>
                  {["en","tr","es","fr","de","ja","zh","ar","ko","pt","ru","hi","it","nl","pl"].map((l) => (
                    <option key={l} value={l}>{getLanguage(l)?.flag} {getLanguage(l)?.name || l}</option>
                  ))}
                </select>
                <BubbleAction onClick={handleSourceOverride} icon={RefreshCw} label="Apply" isMine={isMine} title="Apply source language override and retranslate" />
              </div>
            )}

            {/* Sender side: show translations sent to others */}
            <TranslationExpander forSender={isMine} />
          </>
        )}

        {/* ═══ TEXT ═══ */}
        {!isVoice && !isImage && !isVideo && !isFile && (
          <>
            {isEditing ? (
              <div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } if (e.key === "Escape") handleCancelEdit(); }}
                  autoFocus
                  rows={3}
                  style={{
                    width: "100%", padding: "6px 8px", borderRadius: 8,
                    border: `1px solid ${editError ? "var(--red)" : "var(--border)"}`,
                    background: isMine ? "rgba(255,255,255,0.15)" : "var(--bg-tertiary)",
                    color: isMine ? "white" : "var(--text-primary)",
                    fontSize: 14, fontFamily: "var(--font-sans)", resize: "none", outline: "none",
                  }}
                />
                {editError && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>{editError}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                  <button onClick={handleCancelEdit} style={{
                    padding: "3px 10px", borderRadius: 6, border: `1px solid ${isMine ? "rgba(255,255,255,0.4)" : "var(--border)"}`,
                    background: "transparent", color: isMine ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
                    fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)",
                  }}>Cancel</button>
                  <button onClick={handleSaveEdit} disabled={editLoading || !editContent.trim()} style={{
                    padding: "3px 10px", borderRadius: 6, border: "none",
                    background: isMine ? "rgba(255,255,255,0.3)" : "var(--accent)",
                    color: "white", fontSize: 12, cursor: editLoading ? "default" : "pointer", fontFamily: "var(--font-sans)",
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                    {editLoading ? <><Loader size={10} style={{ animation: "spin 1s linear infinite" }} />Saving…</> : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {!isMine && hasTranslation ? (
                  <>{translation.translatedText}<TranslationExpander /></>
                ) : (
                  <>{message.content}<TranslationExpander forSender={isMine} /></>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, paddingRight: isMine ? 2 : 0, paddingLeft: isMine ? 0 : 2, flexWrap: "wrap" }}>
        {/* Star indicator */}
        {isStarred && <Star size={10} fill="currentColor" style={{ color: "var(--yellow, #f59e0b)" }} />}
        {/* Pin indicator */}
        {isPinned && <Pin size={10} style={{ color: "var(--accent)" }} />}
        {/* Edited indicator — Feature J */}
        {message.editedAt && !isDeleted && <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontStyle: "italic" }}>edited</span>}
        {!isMine && hasTranslation && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 500, padding: "1px 6px", borderRadius: "var(--radius-full)", color: "var(--accent)", background: "var(--accent-soft)" }}><Globe size={9} /> {translation.sourceLang?.toUpperCase()} → {translation.targetLang?.toUpperCase()}</span>}
        {isVoice && <Mic size={10} style={{ color: "var(--text-tertiary)" }} />}
        {isImage && <Image size={10} style={{ color: "var(--text-tertiary)" }} />}
        {isVideo && <Video size={10} style={{ color: "var(--text-tertiary)" }} />}
        {isFile && <FileText size={10} style={{ color: "var(--text-tertiary)" }} />}
        <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{formatTime(message.createdAt)}</span>
        {isMine && <StatusIcon status={status} />}
      </div>
    </div>
  );
}
