import { useState, useRef, useCallback, useEffect } from "react";
import { useChatStore } from "../../store/chatStore";
import SmartReplies from "./SmartReplies";
import AiToolbar from "./AiToolbar";
import { Send, Mic, X, Reply } from "lucide-react";

export default function MessageInput({ onVoiceRecord }) {
  const [text, setText] = useState("");
  const [originalText, setOriginalText] = useState(null);
  const ref = useRef(null);
  const typingTimeout = useRef(null);
  const { sendMessage, emitTyping, emitStopTyping, activeChatId, voiceSending, smartReplies, smartRepliesLoading, fetchSmartReplies, replyTo, clearReplyTo, isChatBlocked, getDraft, setDraft, clearDraft } = useChatStore();
  const blocked = isChatBlocked(activeChatId);
  const prevChatId = useRef(null);

  // Pack D: save draft when switching chats, restore draft on new chat
  useEffect(() => {
    // Save draft for the previous chat
    if (prevChatId.current && prevChatId.current !== activeChatId) {
      setDraft(prevChatId.current, text);
    }
    // Restore draft for the new chat
    const draft = activeChatId ? getDraft(activeChatId) : "";
    setText(draft);
    setOriginalText(null); // undo belongs to the previous chat's text
    if (ref.current) {
      ref.current.style.height = "auto";
      if (draft) ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + "px";
    }
    prevChatId.current = activeChatId;
  }, [activeChatId]);

  // Fetch smart replies when chat changes or new messages arrive
  useEffect(() => {
    if (activeChatId) fetchSmartReplies(activeChatId);
  }, [activeChatId]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    sendMessage(text.trim());
    // Pack D: clear draft on send
    if (activeChatId) clearDraft(activeChatId);
    setText("");
    setOriginalText(null);
    if (ref.current) ref.current.style.height = "auto";
    clearTimeout(typingTimeout.current);
    emitStopTyping();
    // Refresh smart replies after sending
    setTimeout(() => { if (activeChatId) fetchSmartReplies(activeChatId); }, 500);
  }, [text, sendMessage, emitStopTyping, activeChatId, fetchSmartReplies, clearDraft]);

  const handleSmartReplySelect = useCallback((reply) => {
    sendMessage(reply);
    setTimeout(() => { if (activeChatId) fetchSmartReplies(activeChatId); }, 500);
  }, [sendMessage, activeChatId, fetchSmartReplies]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setText(val);
    // Fix B: sync draft immediately — setDraft removes from localStorage when val is ""
    if (activeChatId) setDraft(activeChatId, val);
    setOriginalText(null);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    emitTyping();
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(emitStopTyping, 2000);
  }, [emitTyping, emitStopTyping, activeChatId, setDraft]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  if (blocked) {
    return (
      <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-secondary)", padding: "14px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 500 }}>
          You blocked this user. Unblock to send messages.
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
      {/* Voice sending indicator */}
      {voiceSending && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 24px", background: "var(--accent-soft)", fontSize: 12, color: "var(--accent)" }}>
          <div className="spinner spinner-sm" style={{ borderTopColor: "var(--accent)" }} />
          Processing voice message — transcribing & translating...
        </div>
      )}

      <div style={{ padding: "8px 24px 4px" }}>
        {/* Smart replies */}
        <SmartReplies
          replies={smartReplies}
          isLoading={smartRepliesLoading}
          onSelect={handleSmartReplySelect}
        />

        {/* AI toolbar — shows when there's text to transform */}
        <AiToolbar
          text={text}
          onTextChange={(newText) => {
            if (originalText === null) setOriginalText(text);  // ilk rewrite'ta sakla
            setText(newText);
            setDraft(activeChatId, newText);
            if (ref.current) {
              ref.current.value = newText;
              ref.current.style.height = "auto";
              ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + "px";
            }
          }}
          disabled={!text.trim()}
        />
        {originalText !== null && (
          <button
            onClick={() => {
              setText(originalText);
              setDraft(activeChatId, originalText);
              setOriginalText(null);
              if (ref.current) {
                ref.current.value = originalText;
                ref.current.style.height = "auto";
                ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + "px";
              }
            }}
            style={{ fontSize: 12, color: "#888", marginLeft: 4, background: "none", border: "none", cursor: "pointer" }}
          >
            ↩ Geri Al
          </button>
        )}
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 24px", background: "var(--bg-tertiary)",
          borderTop: "1px solid var(--border-subtle)",
        }}>
          <Reply size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div style={{
            flex: 1, minWidth: 0, borderLeft: "2px solid var(--accent)",
            paddingLeft: 8, overflow: "hidden",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>
              {replyTo.sender?.displayName || "Message"}
            </div>
            <div style={{
              fontSize: 12, color: "var(--text-secondary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {replyTo.content?.slice(0, 80) || (replyTo.type === "voice" ? "🎤 Voice message" : replyTo.type === "image" ? "📷 Image" : "📎 File")}
            </div>
          </div>
          <button onClick={clearReplyTo} title="Cancel reply" style={{
            width: 24, height: 24, borderRadius: 6, border: "none",
            background: "transparent", color: "var(--text-tertiary)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}><X size={14} /></button>
        </div>
      )}

      <div style={{ padding: "4px 24px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <textarea
              ref={ref} value={text} onChange={handleChange} onKeyDown={handleKeyDown}
              placeholder="Type a message..." rows={1}
              className="chat-msg-input-textarea"
              style={{
                width: "100%", padding: "12px 88px 12px 16px",
                background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                borderRadius: 20, color: "var(--text-primary)", fontSize: 14,
                fontFamily: "var(--font-sans)", outline: "none", resize: "none",
                minHeight: 44, maxHeight: 120, lineHeight: 1.4,
                transition: "border-color var(--duration) var(--ease), box-shadow var(--duration) var(--ease)",
              }}
              onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--accent-soft)"; }}
              onBlur={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.boxShadow = "none"; }}
            />
            <div style={{ position: "absolute", right: 8, bottom: 7, display: "flex", gap: 2, alignItems: "center" }}>
              <button onClick={onVoiceRecord} disabled={voiceSending} title="Voice message" className="chat-msg-input-btn" style={{
                width: 32, height: 32, borderRadius: 10, border: "none",
                background: "transparent", color: "var(--text-tertiary)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all var(--duration) var(--ease)",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--red-soft)"; e.currentTarget.style.color = "var(--red)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
              ><Mic size={15} /></button>
              <button onClick={handleSend} disabled={!text.trim()} className="chat-msg-input-btn" style={{
                width: 32, height: 32, borderRadius: 10, border: "none",
                background: text.trim() ? "var(--accent)" : "var(--bg-hover)",
                color: text.trim() ? "white" : "var(--text-tertiary)",
                cursor: text.trim() ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all var(--duration) var(--ease)",
              }}><Send size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
