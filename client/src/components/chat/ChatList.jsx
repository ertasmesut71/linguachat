import { useMemo } from "react";
import { useChatStore } from "../../store/chatStore";
import { useAuthStore } from "../../store/authStore";
import { getLanguage } from "../../lib/constants";
import Avatar from "../ui/Avatar";

// Pack D: check localStorage for draft
function getDraft(chatId) {
  try { return localStorage.getItem(`draft:${chatId}`) || ""; } catch { return ""; }
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatList({ searchQuery, onSelect, filter = "all", chatList }) {
  const { chats, activeChatId, setActiveChat, typingUsers, onlineUsers, mySettings } =
    useChatStore();
  const currentUser = useAuthStore((s) => s.user);

  const filtered = useMemo(() => {
    // Fix C: allow passing an explicit chatList (e.g. for archived view)
    let list = chatList !== undefined ? chatList : chats;
    // Pack B: favorites filter (only applies when using default chats list)
    if (!chatList && filter === "favorites") {
      list = list.filter((c) => mySettings[c.id]?.favorited);
    }
    if (!searchQuery?.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((chat) => {
      if (chat.name) return chat.name.toLowerCase().includes(q);
      const other = chat.members?.find((m) => m.userId !== currentUser?.id);
      return other?.user?.displayName?.toLowerCase().includes(q);
    });
  }, [chats, chatList, searchQuery, currentUser, filter, mySettings]);

  const handleClick = (chatId) => {
    setActiveChat(chatId);
    onSelect?.(chatId);
  };

  if (filtered.length === 0) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--text-tertiary)",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {searchQuery
          ? "No chats found"
          : "No conversations yet. Open the Contacts tab to start chatting."}
      </div>
    );
  }

  return (
    <div>
      {filtered.map((chat) => {
        const isActive = chat.id === activeChatId;
        const isGroup = chat.type === "group";
        const otherMember = chat.members?.find(
          (m) => m.userId !== currentUser?.id
        );
        const otherUser = otherMember?.user;

        // Fix A: self-chat has no otherUser (1 member = self); detect and label correctly
        const isSelfChat = !isGroup && chat.members?.length === 1;
        const displayName = isSelfChat
          ? "Saved Messages"
          : isGroup
          ? chat.name
          : otherUser?.displayName || "Unknown";
        const lang = otherUser ? getLanguage(otherUser.primaryLang) : null;
        const status = otherUser
          ? onlineUsers[otherUser.id] || otherUser.status
          : null;
        const userForAvatar = isSelfChat
          ? { id: "saved", displayName: "📌", status: "online" }
          : isGroup
          ? { id: chat.id, displayName: chat.name || "G", status: "online" }
          : otherUser
          ? { ...otherUser, status }
          : { id: "?", displayName: "?", status: "offline" };

        const chatTyping = typingUsers[chat.id] || [];
        const isTyping = chatTyping.length > 0;

        const lastMsg = chat.lastMessage;
        // Pack D: show draft if no typing
        const draft = !isTyping ? getDraft(chat.id) : "";
        let preview = "";
        let isDraft = false;
        if (isTyping) {
          preview = "typing...";
        } else if (draft) {
          preview = draft.slice(0, 50);
          isDraft = true;
        } else if (lastMsg) {
          const isMine = lastMsg.senderId === currentUser?.id;
          const prefix =
            isGroup && !isMine
              ? `${lastMsg.sender?.displayName?.split(" ")[0] || ""}: `
              : isMine
              ? "You: "
              : "";
          if (lastMsg.type === "voice") {
            preview = prefix + "🎤 Voice message";
          } else if (lastMsg.type === "file") {
            preview = prefix + "📎 File";
          } else {
            preview = prefix + (lastMsg.content || "").slice(0, 50);
          }
        }

        // Pack B: is this chat favorited?
        const isFavorited = mySettings[chat.id]?.favorited;

        const time = lastMsg?.createdAt || chat.createdAt;

        return (
          <div
            key={chat.id}
            className="chat-touch-target"
            onClick={() => handleClick(chat.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              transition: "background var(--duration) var(--ease)",
              background: isActive ? "var(--bg-active)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "transparent";
            }}
          >
            <Avatar user={userForAvatar} size={46} showStatus={!isGroup} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {displayName}
                </span>
                {/* Pack B: favorite star indicator */}
                {isFavorited && (
                  <span title="Favorite" style={{ fontSize: 11, flexShrink: 0 }}>⭐</span>
                )}
                {lang && !isGroup && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      background: "var(--accent-soft)",
                      color: "var(--accent)",
                      borderRadius: "var(--radius-full)",
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {lang.flag}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: isTyping ? "var(--accent)" : isDraft ? "var(--accent)" : "var(--text-tertiary)",
                  fontStyle: isTyping ? "italic" : "normal",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginTop: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                {/* Pack D: "Draft:" label */}
                {isDraft && (
                  <span style={{ color: "#e55", fontWeight: 600, flexShrink: 0 }}>Draft:</span>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {preview || "Start a conversation"}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  fontWeight: 500,
                }}
              >
                {formatTime(time)}
              </div>
              {(chat.unreadCount || 0) > 0 && (
                <div
                  style={{
                    background: "var(--red)",
                    color: "white",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "var(--radius-full)",
                    marginTop: 4,
                    display: "inline-block",
                  }}
                >
                  {chat.unreadCount}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
