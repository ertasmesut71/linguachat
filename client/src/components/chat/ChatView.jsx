import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { getLanguage } from "../../lib/constants";
import Avatar from "../ui/Avatar";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import TypingIndicator from "./TypingIndicator";
import ChatSettings from "./ChatSettings";
import VoiceRecorder from "./VoiceRecorder";
import LiveVoice from "./LiveVoice";
import MediaUpload from "./MediaUpload";
import SearchPanel from "./SearchPanel";
import SummaryPanel from "./SummaryPanel";
import DocChatPanel from "./DocChatPanel";
import { ArrowLeft, Globe, Phone, Search, Paperclip, Sparkles, Pin, Star, Trash2, X, ChevronDown } from "lucide-react";

function fmtStatus(u, s) {
  if (!u) return "";
  if (s === "online") return "Online";
  if (s === "away") return "Away";
  if (u.lastSeenAt) {
    const ms = Date.now() - new Date(u.lastSeenAt);
    if (ms < 60000) return "Just now";
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    return new Date(u.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return "Offline";
}

function groupByDate(msgs) {
  const g = []; let last = null;
  for (const m of msgs) {
    const d = new Date(m.createdAt).toLocaleDateString();
    if (d !== last) { g.push({ type: "date", ts: m.createdAt }); last = d; }
    g.push({ type: "msg", message: m });
  }
  return g;
}

function dateLabel(ts) {
  const d = new Date(ts);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export default function ChatView({ onBack }) {
  const me = useAuthStore((s) => s.user);
  const {
    activeChatId, getActiveChat, getChatMessages, getTypingUsers,
    onlineUsers, isLoadingMessages, fetchMessages, getMySettingsForChat,
    sendVoiceMessage, sendMessage, liveVoiceActive, setLiveVoiceActive,
    fetchStarredIds, fetchPinnedMessages, pinnedMessages,
    selectionMode, selectedMessageIds, exitSelectionMode, bulkAction,
    highlightMessage, getChatTheme,
  } = useChatStore();

  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null); // { allSucceeded, anySucceeded, counts }
  const messageRefs = useRef({});

  // Right-panel routing — mutually exclusive.
  // rightPanel can be: null | "settings" | "search" | "summary" | "docChat"
  const [rightPanel, setRightPanel] = useState(null);
  const [docChatFile, setDocChatFile] = useState(null); // { fileId, originalName, kindHint }

  const [showVoiceRec, setShowVoiceRec] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const endRef = useRef(null);
  const prevCount = useRef(0);

  const chat = getActiveChat();
  const messages = getChatMessages();
  const typingIds = getTypingUsers(activeChatId);
  const mySettings = getMySettingsForChat(activeChatId);

  useEffect(() => {
    // Reset panels when switching chats
    setRightPanel(null);
    setDocChatFile(null);
    setShowMedia(false);
    setPinnedExpanded(false);
    setBulkResult(null);
    if (activeChatId) {
      fetchStarredIds(activeChatId);
      fetchPinnedMessages(activeChatId);
    }
  }, [activeChatId]);

  const other = useMemo(() => chat?.members?.find((m) => m.userId !== me?.id), [chat, me]);
  const otherUser = other?.user;
  const otherStatus = otherUser ? onlineUsers[otherUser.id] || otherUser.status : "offline";
  const typingNames = useMemo(() =>
    typingIds.filter((id) => id !== me?.id)
      .map((id) => chat?.members?.find((m) => m.userId === id)?.user?.displayName?.split(" ")[0] || "Someone"),
    [typingIds, me, chat]
  );
  const grouped = useMemo(() => groupByDate(messages), [messages]);

  useEffect(() => { if (messages.length > prevCount.current) endRef.current?.scrollIntoView({ behavior: "smooth" }); prevCount.current = messages.length; }, [messages.length]);
  useEffect(() => { if (messages.length > 0) endRef.current?.scrollIntoView({ behavior: "auto" }); }, [activeChatId]);
  const handleScroll = (e) => { if (e.target.scrollTop === 0 && messages.length > 0 && !isLoadingMessages) fetchMessages(activeChatId, messages[0]?.createdAt); };

  const handleVoiceSend = ({ audioBase64, mimeType, duration }) => { setShowVoiceRec(false); sendVoiceMessage({ audioBase64, mimeType, duration }); };

  // Search navigation — scroll to message and briefly highlight
  const handleSearchNavigate = useCallback((msg) => {
    const el = messageRefs.current[msg.id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    highlightMessage(msg.id);
    setRightPanel(null);
  }, [highlightMessage]);

  // Bulk actions
  const handleBulkAction = async (action) => {
    const ids = [...selectedMessageIds];
    if (ids.length === 0) return;
    setBulkLoading(true);
    setBulkResult(null);
    try {
      const result = await bulkAction(ids, action);
      const succeeded = result.results?.filter((r) => r.success).length || 0;
      const failed = result.results?.filter((r) => !r.success).length || 0;
      setBulkResult({ allSucceeded: result.allSucceeded, anySucceeded: result.anySucceeded, succeeded, failed });
      if (result.allSucceeded) {
        exitSelectionMode();
        setTimeout(() => setBulkResult(null), 2000);
      }
    } catch (err) {
      setBulkResult({ allSucceeded: false, anySucceeded: false, error: err?.message || "Action failed" });
    }
    setBulkLoading(false);
  };

  const handleMediaUploaded = (fileData) => {
    setShowMedia(false);
    const msgType = fileData.messageType || (fileData.isImage ? "image" : fileData.isVideo ? "video" : "file");
    sendMessage(fileData.originalName, msgType, {
      url: fileData.url,
      fileId: fileData.fileId,
      originalName: fileData.originalName,
      mimeType: fileData.mimeType,
      size: fileData.size,
      kind: fileData.kind,
      isImage: fileData.isImage,
      isVideo: fileData.isVideo,
    });
  };

  // Part 3: open DocChatPanel for a given uploaded file.
  // Mutually exclusive with settings/search/summary.
  const handleOpenDocChat = (fileId, originalName, kindHint) => {
    if (!fileId) return;
    setDocChatFile({ fileId, originalName, kindHint });
    setRightPanel("docChat");
  };

  const togglePanel = (name) => {
    setRightPanel((prev) => {
      if (prev === name) { if (name === "docChat") setDocChatFile(null); return null; }
      if (prev === "docChat") setDocChatFile(null);
      return name;
    });
  };

  const closeRightPanel = () => {
    setRightPanel(null);
    setDocChatFile(null);
  };

  if (!chat) return (
    <div className="empty-state">
      <div className="empty-icon">💬</div>
      <div className="empty-title">Welcome to LinguaChat</div>
      <div className="empty-desc">Select a conversation to start chatting. Text, voice, images, video, and file messages are all translated automatically based on each participant's persistent language setting.</div>
    </div>
  );

  const isGroup = chat.type === "group";
  // Fix A: self-chat (1 member = self) must display "Saved Messages"
  const isSelfChat = !isGroup && chat.members?.length === 1;
  const chatName = isSelfChat ? "Saved Messages" : isGroup ? chat.name : otherUser?.displayName || "Chat";
  const receiveLang = mySettings?.receiveLang || mySettings?.effectiveReceiveLang || me?.primaryLang;
  const rl = getLanguage(receiveLang);
  const autoTr = mySettings?.autoTranslate !== false;

  // Fix D: apply per-chat theme as CSS variable overrides
  const THEME_COLORS = { default: null, ocean: "#0ea5e9", forest: "#22c55e", sunset: "#f97316", rose: "#f43f5e" };
  const chatThemeId = activeChatId ? getChatTheme(activeChatId) : "default";
  const themeColor = THEME_COLORS[chatThemeId] || null;
  const themeStyle = themeColor ? {
    "--accent": themeColor,
    "--accent-hover": themeColor,
    "--accent-soft": `${themeColor}1a`,
    "--accent-glow": `${themeColor}40`,
  } : {};

  return (
    <div style={{ display: "flex", height: "100%", minWidth: 0, flex: 1, ...themeStyle }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "12px 16px", paddingTop: "max(12px, calc(12px + env(safe-area-inset-top)))", borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <button className="icon-btn chat-back-btn chat-touch-target" onClick={onBack} aria-label="Back"><ArrowLeft size={18} /></button>
          {isSelfChat && <div style={{ width: 36, height: 36, borderRadius: 11, background: "linear-gradient(135deg, var(--accent), #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📌</div>}
          {!isSelfChat && otherUser && <Avatar user={{ ...otherUser, status: otherStatus }} size={36} showStatus />}
          {isGroup && <div style={{ width: 36, height: 36, borderRadius: 11, background: "linear-gradient(135deg, var(--accent), #a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👥</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{chatName}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              {typingNames.length > 0 ? <><span style={{ display: "inline-flex", gap: 2 }}>{[0,1,2].map(i => <span key={i} style={{ width:3,height:3,borderRadius:"50%",background:"var(--accent)",animation:`typingBounce 1.4s infinite ease-in-out`,animationDelay:`${i*.15}s` }}/>)}</span><span style={{ color: "var(--accent)" }}>{typingNames[0]} is typing...</span></> : isSelfChat ? "Your personal message storage" : isGroup ? `${chat.members?.length} members` : otherStatus === "online" ? <><div style={{ width:5,height:5,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite" }} />Online</> : fmtStatus(otherUser, otherStatus)}
            </div>
          </div>
          <button onClick={() => togglePanel("search")} className={`icon-btn chat-touch-target${rightPanel === "search" ? " active" : ""}`} title="Search"><Search size={15} /></button>
          <button onClick={() => togglePanel("summary")} className={`icon-btn chat-touch-target${rightPanel === "summary" ? " active" : ""}`} title="AI Summary"><Sparkles size={15} /></button>
          <button onClick={() => setShowMedia(!showMedia)} className="icon-btn chat-touch-target" title="Attach"><Paperclip size={15} /></button>
          <button onClick={() => setLiveVoiceActive(true)} className="icon-btn chat-touch-target" title="Live Voice" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Phone size={15} /></button>
          <div onClick={() => togglePanel("settings")} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: "var(--radius-full)", cursor: "pointer", fontSize: 11, fontWeight: 600, background: autoTr ? "var(--accent-soft)" : "var(--bg-tertiary)", border: `1px solid ${autoTr ? "var(--accent)" : "var(--border)"}`, color: autoTr ? "var(--accent)" : "var(--text-tertiary)" }}>
            <Globe size={12} /> {rl?.flag} {rl?.name}
          </div>
        </div>

        {/* I — Pinned messages banner */}
        {pinnedMessages.length > 0 && (
          <div style={{ background: "var(--surface-raised)", borderBottom: "1px solid var(--border)", padding: "6px 16px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Pin size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {pinnedMessages.length === 1 ? (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 600, color: "var(--accent)", marginRight: 4 }}>Pinned:</span>
                    {pinnedMessages[0].content?.slice(0, 80) || "📎 Media"}
                  </div>
                ) : (
                  <button onClick={() => setPinnedExpanded(!pinnedExpanded)} style={{
                    background: "none", border: "none", cursor: "pointer", fontSize: 12,
                    color: "var(--text-secondary)", padding: 0, fontFamily: "var(--font-sans)",
                    display: "flex", alignItems: "center", gap: 4, width: "100%",
                  }}>
                    <span style={{ fontWeight: 600, color: "var(--accent)" }}>{pinnedMessages.length} pinned messages</span>
                    <ChevronDown size={12} style={{ transform: pinnedExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                )}
              </div>
            </div>
            {pinnedExpanded && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {pinnedMessages.map((pm) => (
                  <div key={pm.id}
                    onClick={() => handleSearchNavigate(pm)}
                    style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 8px", borderRadius: 6, cursor: "pointer", background: "var(--bg-hover)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: 500, marginRight: 4 }}>{pm.sender?.displayName || ""}:</span>
                    {pm.content?.slice(0, 60) || "📎 Media"}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* E/F — Selection mode toolbar */}
        {selectionMode && (
          <div style={{
            padding: "8px 16px", background: "var(--surface-raised)", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap",
          }}>
            <button onClick={exitSelectionMode} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", display: "flex", alignItems: "center" }}><X size={16} /></button>
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{selectedMessageIds.size} selected</span>
            <button onClick={() => handleBulkAction("star")} disabled={bulkLoading || selectedMessageIds.size === 0}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <Star size={13} /> Star
            </button>
            <button onClick={() => handleBulkAction("unstar")} disabled={bulkLoading || selectedMessageIds.size === 0}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <Star size={13} style={{ opacity: 0.5 }} /> Unstar
            </button>
            <button onClick={() => handleBulkAction("delete_for_me")} disabled={bulkLoading || selectedMessageIds.size === 0}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--red)", background: "transparent", color: "var(--red)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
              <Trash2 size={13} /> Delete for me
            </button>
            {bulkResult && (
              <div style={{ fontSize: 11, color: bulkResult.allSucceeded ? "var(--green)" : bulkResult.anySucceeded ? "var(--yellow, #f59e0b)" : "var(--red)", width: "100%" }}>
                {bulkResult.error
                  ? `Error: ${bulkResult.error}`
                  : bulkResult.allSucceeded
                  ? `✓ Done (${bulkResult.succeeded})`
                  : bulkResult.anySucceeded
                  ? `Partial: ${bulkResult.succeeded} succeeded, ${bulkResult.failed} failed`
                  : `Failed: ${bulkResult.failed} items`
                }
              </div>
            )}
          </div>
        )}

        <div onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "16px 24px", display: "flex", flexDirection: "column", gap: 3 }}>
          {isLoadingMessages && messages.length === 0 && <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><div className="spinner spinner-md" /></div>}
          {grouped.map((item, i) => {
            if (item.type === "date") return <div key={`d${i}`} style={{ textAlign: "center", margin: "12px 0", position: "relative" }}><div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "var(--border-subtle)" }} /><span style={{ position: "relative", background: "var(--bg-primary)", padding: "4px 14px", fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500 }}>{dateLabel(item.ts)}</span></div>;
            const msg = item.message;
            const prev = i > 0 && grouped[i - 1].type === "msg" ? grouped[i - 1].message : null;
            return (
              <div key={msg.id} ref={(el) => { if (el) messageRefs.current[msg.id] = el; else delete messageRefs.current[msg.id]; }}>
                <MessageBubble
                  message={msg}
                  showSender={isGroup && (!prev || prev.senderId !== msg.senderId)}
                  isGroup={isGroup}
                  onOpenDocChat={handleOpenDocChat}
                  selectionMode={selectionMode}
                  isSelected={selectedMessageIds.has(msg.id)}
                />
              </div>
            );
          })}
          {typingNames.length > 0 && <TypingIndicator names={typingNames} />}
          <div ref={endRef} />
        </div>

        {showMedia && <MediaUpload onUploaded={handleMediaUploaded} onCancel={() => setShowMedia(false)} />}
        <MessageInput onVoiceRecord={() => setShowVoiceRec(true)} />
      </div>

      {/* Right-panel — mutually exclusive */}
      {rightPanel === "settings" && <ChatSettings chat={chat} onClose={closeRightPanel} />}
      {rightPanel === "search" && <SearchPanel chatId={activeChatId} onClose={closeRightPanel} onNavigate={handleSearchNavigate} />}
      {rightPanel === "summary" && <SummaryPanel chatId={activeChatId} onClose={closeRightPanel} />}
      {rightPanel === "docChat" && docChatFile && (
        <DocChatPanel
          fileId={docChatFile.fileId}
          originalName={docChatFile.originalName}
          kindHint={docChatFile.kindHint}
          chatId={activeChatId}
          onClose={closeRightPanel}
        />
      )}

      {showVoiceRec && <VoiceRecorder onSend={handleVoiceSend} onCancel={() => setShowVoiceRec(false)} />}
      {liveVoiceActive && <LiveVoice chatId={activeChatId} onClose={() => setLiveVoiceActive(false)} />}

      <style>{`
        @keyframes msgSlideIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes pulse { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:0.5; transform:scale(1.3) } }
        @keyframes typingBounce { 0%,80%,100% { transform:translateY(0) } 40% { transform:translateY(-5px) } }
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
      `}</style>
    </div>
  );
}
