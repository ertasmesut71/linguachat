import { useState, useEffect } from "react";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { getLanguage, LANGUAGES } from "../../lib/constants";
import Avatar from "../ui/Avatar";
import SidePanel from "../ui/SidePanel";
import { X, Globe, Languages, Users, Check, Shield, UserMinus, VolumeX, Volume2, ChevronUp, Ban, Flag, BellOff, Bell, Trash2, Eraser, Archive, Star, Timer, Palette } from "lucide-react";
import api from "../../api/client";

const THEMES = [
  { id: "default", label: "Default", color: "var(--accent)" },
  { id: "ocean", label: "Ocean", color: "#0ea5e9" },
  { id: "forest", label: "Forest", color: "#22c55e" },
  { id: "sunset", label: "Sunset", color: "#f97316" },
  { id: "rose", label: "Rose", color: "#f43f5e" },
];

const TIMER_OPTIONS = [
  { value: null, label: "Off" },
  { value: 30, label: "30 seconds" },
  { value: 300, label: "5 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "24 hours" },
  { value: 604800, label: "7 days" },
];

export default function ChatSettings({ chat, onClose }) {
  const me = useAuthStore((s) => s.user);
  const { mySettings, updateMySettings, onlineUsers, fetchChats, markChatBlocked, markChatUnblocked, clearChat, deleteLocalChat, archiveChat, favoriteChat, getChatTheme, setChatTheme } = useChatStore();
  const [adminAction, setAdminAction] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  // Pack A+B state
  const [isArchived, setIsArchived] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  // Pack E: disappearing timer
  const [disappearingTimer, setDisappearingTimer] = useState(null);
  const [timerLoading, setTimerLoading] = useState(false);
  // Pack F: theme
  const [currentTheme, setCurrentTheme] = useState("default");

  const settings = mySettings[chat?.id] || {};
  const currentReceiveLang = settings.receiveLang || settings.effectiveReceiveLang || me?.primaryLang || "en";
  const autoTranslate = settings.autoTranslate !== false;
  const isGroup = chat?.type === "group";
  // Fix A: self-chat has exactly 1 member (the user themselves)
  const isSelfChat = !isGroup && chat?.members?.length === 1;
  const otherMember = chat?.members?.find((m) => m.userId !== me?.id);
  const otherUser = otherMember?.user;
  const myMembership = chat?.members?.find((m) => m.userId === me?.id);
  const isAdmin = myMembership?.role === "owner" || myMembership?.role === "admin";

  // Clear/Delete chat state
  const [chatActionLoading, setChatActionLoading] = useState(null);

  const handleClearChat = async () => {
    if (!confirm("Clear chat history for you only? This cannot be undone. The other participant's history is unaffected.")) return;
    setChatActionLoading("clear");
    try {
      await clearChat(chat.id);
      onClose();
    } catch (err) {
      alert(err?.message || "Failed to clear chat");
    }
    setChatActionLoading(null);
  };

  const handleDeleteChat = async () => {
    if (!confirm("Remove this chat from your list? The other participant's history is unaffected. A new message from them will restore it.")) return;
    setChatActionLoading("delete");
    try {
      await deleteLocalChat(chat.id);
      onClose();
    } catch (err) {
      alert(err?.message || "Failed to delete chat");
    }
    setChatActionLoading(null);
  };

  // H — Block / Report state
  const [isBlocked, setIsBlocked] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [modLoading, setModLoading] = useState(false);

  // Fetch fresh public profile + block status on mount for 1-on-1 chats
  const [freshProfile, setFreshProfile] = useState(null);
  useEffect(() => {
    if (!isGroup && otherUser) {
      api.get(`/users/${otherUser.id}/block-status`).then((res) => {
        setIsBlocked(res.data?.blockedByMe || false);
      }).catch(() => {});
      // Fetch fresh profile to ensure bio/name are current
      api.get(`/users/${otherUser.id}`).then((res) => {
        if (res.data?.user) setFreshProfile(res.data.user);
      }).catch(() => {});
    }
  }, [chat?.id, isGroup, otherUser?.id]);

  // When chatStore otherUser updates via real-time event, it becomes
  // fresher than the initial fetch — clear stale freshProfile so live
  // store data wins. We detect this by comparing bio/displayName.
  useEffect(() => {
    if (freshProfile && otherUser) {
      const storeNewer =
        otherUser.bio !== freshProfile.bio ||
        otherUser.displayName !== freshProfile.displayName ||
        otherUser.avatarUrl !== freshProfile.avatarUrl;
      if (storeNewer) setFreshProfile(null);
    }
  }, [otherUser?.bio, otherUser?.displayName, otherUser?.avatarUrl]);

  // Merge: freshProfile fills in stale chat-list data on first open;
  // once a real-time update arrives, freshProfile is cleared and
  // otherUser (from live chatStore) is used directly.
  const displayUser = freshProfile ? { ...otherUser, ...freshProfile } : otherUser;

  // Load mute + archive + favorite state from server
  useEffect(() => {
    if (chat?.id) {
      api.get(`/chats/${chat.id}/my-settings`).then((res) => {
        const s = res.data?.settings || {};
        setIsMuted(s.muted || false);
        setIsArchived(s.archived || false);
        setIsFavorited(s.favorited || false);
      }).catch(() => {});
      // Pack E: load disappearing timer from chat
      setDisappearingTimer(chat.disappearingTimer || null);
      // The chat list can be stale (another member may have changed it), and a wrong
      // "Off" would make picking "Off" a no-op — so read the current value.
      api.get(`/chats/${chat.id}`).then((res) => {
        setDisappearingTimer(res.data?.chat?.disappearingTimer || null);
      }).catch(() => {});
      // Pack F: load theme from localStorage
      setCurrentTheme(getChatTheme(chat.id));
    }
  }, [chat?.id]);

  const handleReceiveLangChange = (code) => updateMySettings(chat.id, { receiveLang: code });
  const handleAutoTranslateToggle = () => updateMySettings(chat.id, { autoTranslate: !autoTranslate });

  const handleMuteToggle = async () => {
    const newVal = !isMuted;
    try {
      await api.patch(`/chats/${chat.id}/my-settings`, { muted: newVal });
      setIsMuted(newVal);
    } catch (err) {
      alert(err?.message || "Failed to update mute setting");
    }
  };

  // Pack A: archive/unarchive
  const handleArchiveToggle = async () => {
    const newVal = !isArchived;
    try {
      await archiveChat(chat.id, newVal);
      setIsArchived(newVal);
      if (newVal) onClose(); // archived chats disappear from main list
    } catch (err) {
      alert(err?.message || "Failed to update archive setting");
    }
  };

  // Pack B: favorite/unfavorite
  const handleFavoriteToggle = async () => {
    const newVal = !isFavorited;
    try {
      await favoriteChat(chat.id, newVal);
      setIsFavorited(newVal);
    } catch (err) {
      alert(err?.message || "Failed to update favorite setting");
    }
  };

  // Pack E: set disappearing timer
  const handleTimerChange = async (value) => {
    setTimerLoading(true);
    try {
      await api.patch(`/chats/${chat.id}`, { disappearingTimer: value });
      setDisappearingTimer(value);
    } catch (err) {
      alert(err?.message || "Failed to update disappearing timer");
    }
    setTimerLoading(false);
  };

  // Pack F: change theme
  const handleThemeChange = (themeId) => {
    setChatTheme(chat.id, themeId);
    setCurrentTheme(themeId);
  };

  const doAdminAction = async (action, targetUserId) => {
    setAdminAction(`${action}-${targetUserId}`);
    try {
      if (action === "kick") await api.delete(`/chats/${chat.id}/members/${targetUserId}`);
      else if (action === "promote") await api.post(`/chats/${chat.id}/members`, { userId: targetUserId, role: "admin" });
      else if (action === "demote") await api.patch(`/chats/${chat.id}/members/me`, { role: "member" });
      fetchChats();
    } catch {}
    setAdminAction(null);
  };

  const handleLeaveGroup = async () => {
    if (!confirm("Leave this group? You won't receive messages from it anymore.")) return;
    setAdminAction("leaving");
    try {
      await api.delete(`/chats/${chat.id}/members/${me.id}`);
      fetchChats();
      onClose();
    } catch {}
    setAdminAction(null);
  };

  return (
    <SidePanel onClose={onClose}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}><Languages size={16} /> Settings</h3>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 20px" }}>
        {isSelfChat && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: "linear-gradient(135deg, var(--accent), #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto" }}>📌</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 10 }}>Saved Messages</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>Your personal message storage</div>
          </div>
        )}
        {!isGroup && !isSelfChat && otherUser && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ display: "inline-block" }}><Avatar user={{ ...displayUser, status: onlineUsers[displayUser.id] || displayUser.status }} size={60} showStatus /></div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 10 }}>{displayUser.displayName}</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Globe size={12} /> Speaks {getLanguage(displayUser.primaryLang).flag} {getLanguage(displayUser.primaryLang).name}</div>
            {/* Bio */}
            {displayUser.bio && (
              <div style={{ marginTop: 10, padding: "8px 14px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, fontStyle: "italic", textAlign: "left" }}>
                {displayUser.bio}
              </div>
            )}
          </div>
        )}

        {/* H — Block + Report for 1-on-1 chats (not self-chat) */}
        {!isGroup && !isSelfChat && otherUser && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 8 }}>
            <button
              onClick={async () => {
                setModLoading(true);
                try {
                  if (isBlocked) {
                    await api.delete(`/users/${otherUser.id}/block`);
                    setIsBlocked(false);
                    markChatUnblocked(chat.id);
                  } else {
                    if (!confirm(`Block ${otherUser.displayName}?\nYou will not be able to exchange direct messages until unblocked.`)) { setModLoading(false); return; }
                    await api.post(`/users/${otherUser.id}/block`);
                    setIsBlocked(true);
                    markChatBlocked(chat.id);
                  }
                } catch {}
                setModLoading(false);
              }}
              disabled={modLoading}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "7px 14px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${isBlocked ? "var(--green)" : "var(--red)"}`,
                background: "transparent",
                color: isBlocked ? "var(--green)" : "var(--red)",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
              }}
            >
              <Ban size={13} /> {isBlocked ? "Unblock" : "Block"}
            </button>
            <button
              onClick={() => setReportOpen(!reportOpen)}
              disabled={modLoading}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "7px 14px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
              }}
            >
              <Flag size={13} /> Report
            </button>
          </div>
        )}

        {/* Report form */}
        {reportOpen && otherUser && (
          <div style={{
            margin: "0 0 12px", padding: 12, background: "var(--surface-raised)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Report {otherUser.displayName}</div>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the issue..."
              rows={3}
              style={{
                width: "100%", padding: 8, background: "var(--bg-tertiary)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-sans)",
                resize: "vertical", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setReportOpen(false); setReportReason(""); }} style={{
                padding: "5px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                background: "transparent", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-sans)",
              }}>Cancel</button>
              <button
                disabled={!reportReason.trim() || modLoading}
                onClick={async () => {
                  setModLoading(true);
                  try {
                    await api.post(`/users/${otherUser.id}/report`, { reason: reportReason.trim() });
                    setReportOpen(false);
                    setReportReason("");
                    alert("Report submitted. Thank you.");
                  } catch {}
                  setModLoading(false);
                }}
                style={{
                  padding: "5px 12px", borderRadius: "var(--radius-sm)", border: "none",
                  background: reportReason.trim() ? "var(--red)" : "var(--bg-hover)",
                  color: reportReason.trim() ? "white" : "var(--text-tertiary)",
                  fontSize: 11, fontWeight: 600, cursor: reportReason.trim() ? "pointer" : "default", fontFamily: "var(--font-sans)",
                }}
              >Submit Report</button>
            </div>
          </div>
        )}

        {/* Mute toggle */}
        <div style={{ margin: "12px 0", padding: "10px 16px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <button onClick={handleMuteToggle} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "6px 0", background: "transparent", border: "none",
            color: isMuted ? "var(--accent)" : "var(--text-secondary)",
            fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "var(--font-sans)", textAlign: "left",
          }}>
            {isMuted ? <BellOff size={15} /> : <Bell size={15} />}
            <span style={{ flex: 1 }}>{isMuted ? "Notifications muted" : "Mute notifications"}</span>
            {isMuted && <Check size={14} style={{ color: "var(--accent)" }} />}
          </button>
        </div>

        {/* Persistent language selection */}
        <div style={{ margin: "16px 0", padding: 16, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>I want to receive messages in:</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 12, lineHeight: 1.5 }}>Persists for this conversation — applies to text and voice.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {LANGUAGES.slice(0, 12).map((lang) => {
              const sel = lang.code === currentReceiveLang;
              return (
                <button key={lang.code} onClick={() => handleReceiveLangChange(lang.code)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--radius-md)",
                  border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                  background: sel ? "var(--accent-soft)" : "var(--bg-tertiary)",
                  color: sel ? "var(--accent)" : "var(--text-secondary)",
                  fontSize: 12, fontWeight: sel ? 600 : 400, cursor: "pointer", fontFamily: "var(--font-sans)", textAlign: "left",
                }}>
                  <span style={{ fontSize: 16 }}>{lang.flag}</span><span style={{ flex: 1 }}>{lang.name}</span>{sel && <Check size={14} />}
                </button>
              );
            })}
          </div>
          <select value={currentReceiveLang} onChange={(e) => handleReceiveLangChange(e.target.value)} style={{ width: "100%", marginTop: 8, padding: "8px 10px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-sans)", outline: "none", cursor: "pointer" }}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.name} ({l.nativeName})</option>)}
          </select>
        </div>

        {/* Auto-translate */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <div><div style={{ fontSize: 13, fontWeight: 500 }}>Auto-translate</div><div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{autoTranslate ? "Active" : "Paused"}</div></div>
          <button onClick={handleAutoTranslateToggle} style={{ width: 44, height: 24, borderRadius: "var(--radius-full)", background: autoTranslate ? "var(--accent)" : "var(--bg-tertiary)", border: `1px solid ${autoTranslate ? "var(--accent)" : "var(--border)"}`, cursor: "pointer", position: "relative" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "white", position: "absolute", top: 2, left: autoTranslate ? 22 : 2, transition: "left 0.2s ease" }} />
          </button>
        </div>

        {/* Group members + admin */}
        {isGroup && chat.members && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Users size={12} /> Members ({chat.members.length})</div>
            {chat.members.map((member) => {
              const u = member.user; if (!u) return null;
              const lang = getLanguage(u.primaryLang);
              const status = onlineUsers[u.id] || u.status;
              const isMe = u.id === me?.id;
              const rl = getLanguage(member.receiveLang || u.primaryLang);
              return (
                <div key={member.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar user={{ ...u, status }} size={32} showStatus />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>{u.displayName}{isMe && <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>(you)</span>}</div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{lang.flag} speaks · {rl.flag} receives</div>
                    </div>
                    {member.role === "owner" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-full)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 }}>Owner</span>}
                    {member.role === "admin" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: "var(--radius-full)", background: "var(--green-soft)", color: "var(--green)", fontWeight: 600 }}>Admin</span>}
                  </div>
                  {isAdmin && !isMe && member.role !== "owner" && (
                    <div style={{ display: "flex", gap: 4, marginTop: 6, paddingLeft: 42, flexWrap: "wrap" }}>
                      {member.role !== "admin" && <button onClick={() => doAdminAction("promote", u.id)} disabled={!!adminAction} style={{ fontSize: 10, padding: "3px 8px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 3 }}><Shield size={9} /> Promote</button>}
                      {member.role === "admin" && <button onClick={() => doAdminAction("demote", u.id)} disabled={!!adminAction} style={{ fontSize: 10, padding: "3px 8px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 3 }}><ChevronUp size={9} style={{ transform: "rotate(180deg)" }} /> Demote</button>}
                      <button onClick={() => doAdminAction(member.muted ? "unmute" : "mute", u.id)} disabled={!!adminAction} style={{ fontSize: 10, padding: "3px 8px", borderRadius: "var(--radius-full)", border: "1px solid var(--border)", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 3 }}>{member.muted ? <><Volume2 size={9} /> Unmute</> : <><VolumeX size={9} /> Mute</>}</button>
                      <button onClick={() => doAdminAction("kick", u.id)} disabled={!!adminAction} style={{ fontSize: 10, padding: "3px 8px", borderRadius: "var(--radius-full)", border: "1px solid var(--red)", background: "transparent", color: "var(--red)", cursor: "pointer", fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 3 }}><UserMinus size={9} /> Remove</button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Leave group — available to all members */}
            <button onClick={handleLeaveGroup} disabled={!!adminAction} style={{
              width: "100%", marginTop: 16, padding: "10px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--red)", background: "transparent", color: "var(--red)",
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              <UserMinus size={14} /> Leave Group
            </button>
          </div>
        )}

        {/* Pack A+B: Archive / Favorite */}
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            onClick={handleFavoriteToggle}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: "var(--radius-md)",
              border: `1px solid ${isFavorited ? "#f59e0b" : "var(--border)"}`,
              background: isFavorited ? "rgba(245,158,11,0.1)" : "transparent",
              color: isFavorited ? "#f59e0b" : "var(--text-secondary)",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            }}
          >
            <Star size={13} fill={isFavorited ? "#f59e0b" : "none"} />
            {isFavorited ? "Favorited" : "Favorite"}
          </button>
          <button
            onClick={handleArchiveToggle}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: "var(--radius-md)",
              border: `1px solid ${isArchived ? "var(--accent)" : "var(--border)"}`,
              background: isArchived ? "var(--accent-soft)" : "transparent",
              color: isArchived ? "var(--accent)" : "var(--text-secondary)",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            }}
          >
            <Archive size={13} />
            {isArchived ? "Unarchive" : "Archive"}
          </button>
        </div>

        {/* Pack E: Disappearing Messages */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
            <Timer size={13} /> Disappearing Messages
          </div>
          <select
            value={disappearingTimer ?? ""}
            onChange={(e) => handleTimerChange(e.target.value ? Number(e.target.value) : null)}
            disabled={timerLoading || (isGroup && !isAdmin)}
            title={isGroup && !isAdmin ? "Only the group owner or an admin can change this" : undefined}
            style={{ width: "100%", padding: "7px 10px", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-sans)", outline: "none", cursor: isGroup && !isAdmin ? "not-allowed" : "pointer" }}
          >
            {TIMER_OPTIONS.map((opt) => (
              <option key={opt.value ?? "off"} value={opt.value ?? ""}>{opt.label}</option>
            ))}
          </select>
          {disappearingTimer && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
              New messages will disappear after {TIMER_OPTIONS.find(o => o.value === disappearingTimer)?.label || `${disappearingTimer}s`}.
            </div>
          )}
        </div>

        {/* Pack F: Chat Theme */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
            <Palette size={13} /> Chat Theme
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                onClick={() => handleThemeChange(theme.id)}
                title={theme.label}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: theme.color,
                  border: currentTheme === theme.id ? "3px solid var(--text-primary)" : "3px solid transparent",
                  cursor: "pointer", outline: "none",
                  boxShadow: currentTheme === theme.id ? "0 0 0 2px var(--accent)" : "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* G — Clear Chat / H — Delete Chat */}
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={handleClearChat}
            disabled={!!chatActionLoading}
            style={{
              width: "100%", padding: "10px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", fontFamily: "var(--font-sans)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: chatActionLoading === "clear" ? 0.6 : 1,
            }}
          >
            <Eraser size={14} /> {chatActionLoading === "clear" ? "Clearing…" : "Clear Chat (for me only)"}
          </button>
          <button
            onClick={handleDeleteChat}
            disabled={!!chatActionLoading}
            style={{
              width: "100%", padding: "10px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--red)", background: "transparent",
              color: "var(--red)", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "var(--font-sans)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: chatActionLoading === "delete" ? 0.6 : 1,
            }}
          >
            <Trash2 size={14} /> {chatActionLoading === "delete" ? "Removing…" : "Delete Chat (remove from my list)"}
          </button>
        </div>
      </div>
    </SidePanel>
  );
}
