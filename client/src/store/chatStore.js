import { create } from "zustand";
import api from "../api/client";
import socket from "../api/socket";

const EXPIRY_CHECK_MS = 1000;
let expiryTimer = null;

export const useChatStore = create((set, get) => ({
  chats: [],
  archivedChats: [],
  activeChatId: null,
  messages: {},
  typingUsers: {},
  onlineUsers: {},
  isLoadingChats: false,
  isLoadingMessages: false,
  isConnected: false,
  pendingMessages: {},
  mySettings: {},
  liveVoiceActive: false,
  voiceSending: false,
  blockedChatIds: new Set(),

  // Message actions
  replyTo: null,

  // Phase 6: AI state
  smartReplies: [],
  smartRepliesLoading: false,

  // Message Management UI state
  starredMessageIds: new Set(),   // per-user starred ids for active chat
  pinnedMessages: [],             // pinned messages for active chat
  selectionMode: false,
  selectedMessageIds: new Set(),
  highlightedMessageId: null,     // for search navigation highlight

  // ═══ SOCKET ═══

  initSocket: () => {
    clearInterval(expiryTimer);
    expiryTimer = setInterval(() => get().pruneExpiredMessages(), EXPIRY_CHECK_MS);
    socket.connect();
    socket.on("_connected", () => set({ isConnected: true }));
    socket.on("_disconnected", () => set({ isConnected: false }));
    socket.on("presence:init", ({ onlineUsers }) => set({ onlineUsers }));
    socket.on("presence:update", ({ userId, status }) => set((s) => ({ onlineUsers: { ...s.onlineUsers, [userId]: status } })));

    socket.on("message:new", ({ message }) => {
      set((s) => {
        const cid = message.chatId;
        const ex = s.messages[cid] || [];
        if (ex.some((m) => m.id === message.id)) return s;
        const msgs = { ...s.messages, [cid]: [...ex, message] };
        const chats = s.chats.map((c) =>
          c.id === cid ? { ...c, lastMessage: message, unreadCount: s.activeChatId === cid ? 0 : (c.unreadCount || 0) + 1, updatedAt: message.createdAt } : c
        ).sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
        if (s.activeChatId === cid) socket.markSeen(cid);
        return { messages: msgs, chats };
      });

      // B fix: if message is for a chat not in our list (e.g. newly added
      // to a group), refresh the chat list so the sidebar shows it.
      if (!get().chats.some((c) => c.id === message.chatId)) {
        get().fetchChats();
      }

      // Refresh smart replies on incoming message
      const s = get();
      if (message.chatId === s.activeChatId && message.senderId !== "__self__") {
        get().fetchSmartReplies(s.activeChatId);
      }
    });

    // Server sends this when a message arrives in a chat the recipient may not have in their list yet
    socket.on("chat:updated", ({ chatId }) => {
      if (!get().chats.some((c) => c.id === chatId)) {
        get().fetchChats();
      }
    });

    socket.on("message:sent", ({ message, tempId, translations }) => {
      set((s) => {
        const cid = message.chatId;
        const ex = s.messages[cid] || [];
        const filtered = ex.filter((m) => m.id !== tempId);
        if (filtered.some((m) => m.id === message.id)) return { messages: { ...s.messages, [cid]: filtered }, voiceSending: false };
        const enriched = { ...message, _allTranslations: translations };
        const msgs = { ...s.messages, [cid]: [...filtered, enriched] };
        const chats = s.chats.map((c) =>
          c.id === cid ? { ...c, lastMessage: message, updatedAt: message.createdAt } : c
        ).sort((a, b) => new Date(b.lastMessage?.createdAt || b.createdAt) - new Date(a.lastMessage?.createdAt || a.createdAt));
        const p = { ...s.pendingMessages }; delete p[tempId];
        return { messages: msgs, chats, pendingMessages: p, voiceSending: false };
      });
    });

    socket.on("message:status", ({ messageId, chatId, status, bulk }) => {
      set((s) => {
        const msgs = s.messages[chatId]; if (!msgs) return s;
        const updated = bulk ? msgs.map((m) => ({ ...m, _aggregateStatus: status })) : msgs.map((m) => m.id === messageId ? { ...m, _aggregateStatus: status } : m);
        return { messages: { ...s.messages, [chatId]: updated } };
      });
    });

    socket.on("typing:update", ({ chatId, userId, isTyping }) => {
      set((s) => { const c = new Set(s.typingUsers[chatId] || []); isTyping ? c.add(userId) : c.delete(userId); return { typingUsers: { ...s.typingUsers, [chatId]: c.size ? [...c] : [] } }; });
    });

    // C fix: when someone starts live voice in the chat we currently have
    // open, auto-activate the LiveVoice overlay so incoming subtitle events
    // are rendered instead of silently dropped.
    // Real-time profile/bio updates — no refresh needed
    socket.on("user:profile-updated", ({ userId, displayName, bio, avatarUrl, primaryLang, status }) => {
      set((s) => ({
        chats: s.chats.map((c) => ({
          ...c,
          members: c.members?.map((m) =>
            m.userId === userId
              ? { ...m, user: { ...m.user, displayName, bio, avatarUrl, primaryLang, status } }
              : m
          ),
        })),
      }));
    });

    // Real-time block/unblock sync — updates composer immediately, no refresh
    socket.on("user:block-state-changed", ({ chatId, blocked }) => {
      if (!chatId) return;
      const s = new Set(get().blockedChatIds);
      if (blocked) { s.add(chatId); } else { s.delete(chatId); }
      set({ blockedChatIds: s });
    });

    socket.on("voice:live:started", ({ chatId }) => {
      const s = get();
      if (s.activeChatId === chatId && !s.liveVoiceActive) {
        set({ liveVoiceActive: true });
      }
    });

    socket.on("message:error", ({ tempId, error, code }) => {
      if (code === "USER_BLOCKED") {
        // Mark this chat as blocked so composer disables
        const cid = get().activeChatId;
        if (cid) {
          const blocked = new Set(get().blockedChatIds);
          blocked.add(cid);
          set({ blockedChatIds: blocked });
        }
      }
      set((s) => { const p = { ...s.pendingMessages }; if (p[tempId]) p[tempId].error = error; return { pendingMessages: p, voiceSending: false }; });
    });

    socket.on("settings:updated", ({ chatId, receiveLang, autoTranslate }) => {
      set((s) => ({ mySettings: { ...s.mySettings, [chatId]: { ...s.mySettings[chatId], receiveLang, autoTranslate } } }));
    });

    // D2 — reconnect sync feedback
    socket.on("sync:complete", ({ at, chatsSynced, totalMessages }) => {
      if (totalMessages > 0 && typeof window !== "undefined" && window.__linguachat_toast) {
        window.__linguachat_toast(
          `Restored ${totalMessages} missed message${totalMessages === 1 ? "" : "s"} across ${chatsSynced} chat${chatsSynced === 1 ? "" : "s"}.`,
          "info",
        );
      }
    });

    // Message Management WS events
    socket.on("message:edited", ({ messageId, content, editedAt, chatId: cid }) => {
      if (!messageId || !cid) return;
      set((s) => {
        const msgs = s.messages[cid];
        if (!msgs) return s;
        return {
          messages: {
            ...s.messages,
            [cid]: msgs.map((m) => m.id === messageId
              ? { ...m, content, editedAt, translation: null, _allTranslations: null }
              : m
            ),
          },
        };
      });
    });

    // Delete-for-everyone: also echoes to the sender, so an already-deleted message is left as is.
    socket.on("message:deleted", ({ messageId, deletedAt, chatId: cid }) => {
      if (!messageId || !cid) return;
      set((s) => {
        const msgs = s.messages[cid];
        return {
          messages: msgs
            ? {
                ...s.messages,
                [cid]: msgs.map((m) => m.id === messageId && !m.deletedAt
                  ? { ...m, content: "This message was deleted", deletedAt, translation: null, _allTranslations: null }
                  : m
                ),
              }
            : s.messages,
          pinnedMessages: s.pinnedMessages.filter((p) => p.id !== messageId),
        };
      });
      // Sidebar preview may have been the deleted message — refresh from the server.
      if (get().chats.some((c) => c.id === cid && c.lastMessage?.id === messageId)) get().fetchChats();
    });

    // Apply fresh translation after edit (server regenerates per-recipient)
    socket.on("message:translation-updated", ({ messageId, chatId: cid, translation }) => {
      if (!messageId || !cid) return;
      set((s) => {
        const msgs = s.messages[cid];
        if (!msgs) return s;
        return {
          messages: {
            ...s.messages,
            [cid]: msgs.map((m) => m.id === messageId ? { ...m, translation } : m),
          },
        };
      });
    });

    socket.on("message:pinned", ({ chatId }) => {
      const s = get();
      if (s.activeChatId === chatId) {
        get().fetchPinnedMessages(chatId);
      }
    });

    socket.on("message:unpinned", ({ chatId, messageId }) => {
      const s = get();
      if (s.activeChatId === chatId) {
        set((prev) => ({
          pinnedMessages: prev.pinnedMessages.filter((p) => p.id !== messageId),
        }));
      }
    });

    socket.on("sync:truncated", ({ chatIds, capPerChat }) => {
      if (typeof window !== "undefined" && window.__linguachat_toast) {
        window.__linguachat_toast(
          `You missed more than ${capPerChat} messages in ${chatIds.length} chat${chatIds.length === 1 ? "" : "s"}. Scroll up to load older history.`,
          "info",
        );
      }
    });
  },

  disconnectSocket: () => {
    // Clear the sync anchor on explicit disconnect (logout) so the next user's
    // session doesn't inherit it and accidentally replay another account's
    // messages (which would fail at membership checks anyway, but better to
    // be explicit).
    clearInterval(expiryTimer);
    socket.clearSyncAnchor();
    socket.disconnect();
    set({ isConnected: false });
  },

  // Disappearing messages: hide locally once expired. The rows stay in the DB and
  // the server filters them from every read, so a refetch agrees with this.
  pruneExpiredMessages: (now = Date.now()) => {
    const isExpired = (m) => !!m?.expiresAt && new Date(m.expiresAt).getTime() <= now;
    const s = get();
    const expiredChatIds = Object.keys(s.messages).filter((cid) => s.messages[cid].some(isExpired));
    const previewExpired = s.chats.some((c) => isExpired(c.lastMessage));
    if (!expiredChatIds.length && !previewExpired && !s.pinnedMessages.some(isExpired)) return;

    const messages = { ...s.messages };
    for (const cid of expiredChatIds) messages[cid] = messages[cid].filter((m) => !isExpired(m));
    set({
      messages,
      pinnedMessages: s.pinnedMessages.filter((p) => !isExpired(p)),
      chats: previewExpired
        ? s.chats.map((c) => isExpired(c.lastMessage) ? { ...c, lastMessage: null } : c)
        : s.chats,
    });
    // The server knows the previous visible message for the sidebar preview.
    if (previewExpired) get().fetchChats();
  },

  // ═══ CHATS ═══

  fetchChats: async () => {
    set({ isLoadingChats: true });
    // The open chat counts as read even if the server hasn't processed our "seen" yet.
    try { const d = await api.get("/chats"); set((s) => ({ chats: d.data.chats.map((c) => c.id === s.activeChatId ? { ...c, unreadCount: 0 } : c), isLoadingChats: false })); }
    catch { set({ isLoadingChats: false }); }
  },

  // Fix C: fetch only archived chats for the archived view
  fetchArchivedChats: async () => {
    try {
      const d = await api.get("/chats?includeArchived=true");
      const all = d.data.chats || [];
      // Server exposes myArchivedAt (the requesting user's own archivedAt) on each chat
      const archived = all.filter((c) => c.myArchivedAt != null);
      set({ archivedChats: archived });
      return archived;
    } catch { set({ archivedChats: [] }); return []; }
  },

  openDirectChat: async (otherUserId) => {
    const d = await api.post("/chats/direct", { otherUserId });
    const chat = d.data.chat;
    const wasMissing = !get().chats.some((c) => c.id === chat.id);
    set((s) => ({ chats: wasMissing ? [chat, ...s.chats] : s.chats, activeChatId: chat.id }));
    // POST /chats/direct has no lastMessage; reload the list so the preview and date are right.
    if (wasMissing) get().fetchChats();
    get().fetchMessages(chat.id);
    get().fetchMySettings(chat.id);
    get().fetchSmartReplies(chat.id);
    socket.openChat(chat.id);
    return chat;
  },

  setActiveChat: (chatId) => {
    const prev = get().activeChatId;
    if (prev) socket.closeChat();
    set((s) => ({
      activeChatId: chatId,
      smartReplies: [],
      chats: s.chats.map((c) => c.id === chatId ? { ...c, unreadCount: 0 } : c),
      starredMessageIds: new Set(),
      pinnedMessages: [],
      selectionMode: false,
      selectedMessageIds: new Set(),
      highlightedMessageId: null,
    }));
    if (chatId) {
      if (!get().messages[chatId]) get().fetchMessages(chatId);
      get().fetchMySettings(chatId);
      get().fetchSmartReplies(chatId);
      socket.openChat(chatId);
    }
  },

  // ═══ MESSAGES ═══

  fetchMessages: async (chatId, before) => {
    set({ isLoadingMessages: true });
    try {
      const p = new URLSearchParams({ limit: "60" });
      if (before) p.set("before", before);
      const d = await api.get(`/chats/${chatId}/messages?${p}`);
      set((s) => ({
        messages: { ...s.messages, [chatId]: before ? [...d.data.messages, ...(s.messages[chatId] || [])] : d.data.messages },
        isLoadingMessages: false,
      }));
    } catch { set({ isLoadingMessages: false }); }
  },

  sendMessage: (content, type = "text", metadata = {}) => {
    const chatId = get().activeChatId;
    if (!chatId) return;
    if (type === "text" && !content?.trim()) return;
    const replyToId = get().replyTo?.id || null;
    const tempId = socket.sendMessage(chatId, content, type, metadata, replyToId);
    set((s) => ({
      messages: { ...s.messages, [chatId]: [...(s.messages[chatId] || []), {
        id: tempId, chatId, senderId: "__self__", type,
        content: content?.trim() || "", metadata,
        replyToId, replyTo: s.replyTo || null,
        createdAt: new Date().toISOString(),
        _isOptimistic: true, _aggregateStatus: "sending", translation: null,
      }] },
      pendingMessages: { ...s.pendingMessages, [tempId]: { chatId, content } },
      smartReplies: [],
      replyTo: null, // clear reply after sending
    }));
    socket.stopTyping(chatId);
  },

  sendVoiceMessage: ({ audioBase64, mimeType, duration }) => {
    const chatId = get().activeChatId;
    if (!chatId) return;
    set({ voiceSending: true });
    const tempId = socket.sendVoiceMessage(chatId, audioBase64, mimeType, duration);
    set((s) => ({
      messages: { ...s.messages, [chatId]: [...(s.messages[chatId] || []), {
        id: tempId, chatId, senderId: "__self__", type: "voice",
        content: "🎤 Processing voice message...",
        metadata: { duration, audioUrl: null, originalTranscript: null },
        createdAt: new Date().toISOString(),
        _isOptimistic: true, _aggregateStatus: "sending", translation: null,
      }] },
      pendingMessages: { ...s.pendingMessages, [tempId]: { chatId, type: "voice" } },
    }));
  },

  // ═══ PER-CHAT SETTINGS ═══

  fetchMySettings: async (chatId) => {
    try { const d = await api.get(`/chats/${chatId}/my-settings`); set((s) => ({ mySettings: { ...s.mySettings, [chatId]: d.data.settings } })); } catch {}
  },

  updateMySettings: async (chatId, settings) => {
    set((s) => ({ mySettings: { ...s.mySettings, [chatId]: { ...s.mySettings[chatId], ...settings } } }));
    try { await api.patch(`/chats/${chatId}/my-settings`, settings); } catch { get().fetchMySettings(chatId); }
    socket.send("settings:update", { chatId, ...settings });
  },

  // ═══ AI FEATURES ═══

  fetchSmartReplies: async (chatId) => {
    set({ smartRepliesLoading: true });
    try {
      const d = await api.get(`/ai/chats/${chatId}/smart-replies`);
      // Only update if still on the same chat
      if (get().activeChatId === chatId) {
        set({ smartReplies: d.data.replies || [], smartRepliesLoading: false });
      } else {
        set({ smartRepliesLoading: false });
      }
    } catch {
      set({ smartReplies: [], smartRepliesLoading: false });
    }
  },

  // ═══ MESSAGE ACTIONS ═══

  // "Delete for me": hide a received message from MY view only (server-persisted).
  hideMessageForMe: async (messageId, chatId) => {
    const cid = chatId || get().activeChatId;
    await api.post(`/messages/${messageId}/hide`); // errors propagate to the caller
    if (cid) {
      set((s) => ({
        messages: { ...s.messages, [cid]: (s.messages[cid] || []).filter((m) => m.id !== messageId) },
      }));
    }
    // Sidebar preview may have been the hidden message — refresh from the server.
    get().fetchChats();
  },

  deleteMessage: async (messageId) => {
    try {
      await api.delete(`/messages/${messageId}`);
      // Update local state — mark the message as deleted
      const chatId = get().activeChatId;
      if (chatId) {
        set((s) => ({
          messages: {
            ...s.messages,
            [chatId]: (s.messages[chatId] || []).map((m) =>
              m.id === messageId && !m.deletedAt
                ? { ...m, content: "This message was deleted", deletedAt: new Date().toISOString() }
                : m
            ),
          },
        }));
      }
    } catch (err) {
      console.error("[chatStore] deleteMessage failed:", err);
      throw err;
    }
  },

  setReplyTo: (message) => set({ replyTo: message }),
  clearReplyTo: () => set({ replyTo: null }),

  // ═══ MISC ═══

  setLiveVoiceActive: (active) => set({ liveVoiceActive: active }),
  emitTyping: () => { const c = get().activeChatId; if (c) socket.startTyping(c); },
  emitStopTyping: () => { const c = get().activeChatId; if (c) socket.stopTyping(c); },

  getActiveChat: () => {
    const s = get();
    // Fix C: also check archivedChats in store for chats opened from archived view
    return s.chats.find((c) => c.id === s.activeChatId) || s.archivedChats?.find((c) => c.id === s.activeChatId) || null;
  },
  getChatMessages: () => get().messages[get().activeChatId] || [],
  getUserStatus: (uid) => get().onlineUsers[uid] || "offline",
  getTypingUsers: (cid) => get().typingUsers[cid] || [],
  getMySettingsForChat: (cid) => get().mySettings[cid] || null,
  markChatBlocked: (chatId) => { const s = new Set(get().blockedChatIds); s.add(chatId); set({ blockedChatIds: s }); },
  markChatUnblocked: (chatId) => { const s = new Set(get().blockedChatIds); s.delete(chatId); set({ blockedChatIds: s }); },
  isChatBlocked: (chatId) => get().blockedChatIds.has(chatId),

  // ═══ STAR ═══

  starMessage: async (messageId) => {
    await api.post(`/messages/${messageId}/star`);
    set((s) => { const ids = new Set(s.starredMessageIds); ids.add(messageId); return { starredMessageIds: ids }; });
  },

  unstarMessage: async (messageId) => {
    await api.delete(`/messages/${messageId}/star`);
    set((s) => { const ids = new Set(s.starredMessageIds); ids.delete(messageId); return { starredMessageIds: ids }; });
  },

  fetchStarredIds: async (chatId) => {
    try {
      const d = await api.get(`/starred?chatId=${chatId}`);
      const msgs = d.data.messages || [];
      set({ starredMessageIds: new Set(msgs.map((m) => m.id)) });
    } catch {}
  },

  // ═══ PIN ═══

  fetchPinnedMessages: async (chatId) => {
    try {
      const d = await api.get(`/chats/${chatId}/pinned`);
      // Backend returns { data: { pins: [...] } } — each pin row has messageId/messageContent/senderId
      const raw = d.data.pins || [];
      const normalized = raw.map((p) => ({
        id: p.messageId,          // message id — used for scroll nav + React key
        content: p.messageContent, // message text for banner display
        expiresAt: p.expiresAt,
        pinnedAt: p.pinnedAt,
        pinnedBy: p.pinnedBy,
        chatId: p.chatId,
      }));
      set({ pinnedMessages: normalized });
    } catch {}
  },

  pinMessage: async (chatId, messageId) => {
    await api.post(`/chats/${chatId}/pin`, { messageId });
    // Re-fetch the full pinned list so the banner has correct message content
    await get().fetchPinnedMessages(chatId);
  },

  unpinMessage: async (chatId, messageId) => {
    await api.delete(`/chats/${chatId}/pin/${messageId}`);
    set((s) => ({ pinnedMessages: s.pinnedMessages.filter((p) => p.id !== messageId) }));
  },

  // ═══ EDIT ═══

  editMessage: async (messageId, content) => {
    const d = await api.patch(`/messages/${messageId}`, { content });
    const updated = d.data.message;
    if (updated) {
      const chatId = get().activeChatId;
      if (chatId) {
        set((s) => ({
          messages: {
            ...s.messages,
            [chatId]: (s.messages[chatId] || []).map((m) =>
              m.id === messageId
                ? { ...m, content: updated.content, editedAt: updated.editedAt, translation: null, _allTranslations: null }
                : m
            ),
          },
        }));
      }
    }
    return updated;
  },

  // ═══ BULK ═══

  bulkAction: async (messageIds, action) => {
    const d = await api.post("/messages/bulk", { messageIds, action });
    const result = d.data;
    if (action === "delete_for_me") {
      const succeeded = result.results?.filter((r) => r.success).map((r) => r.messageId) || [];
      if (succeeded.length > 0) {
        const chatId = get().activeChatId;
        if (chatId) {
          set((s) => ({
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] || []).filter((m) => !succeeded.includes(m.id)),
            },
          }));
        }
      }
    } else if (action === "star") {
      const succeeded = result.results?.filter((r) => r.success).map((r) => r.messageId) || [];
      if (succeeded.length > 0) {
        set((s) => { const ids = new Set(s.starredMessageIds); succeeded.forEach((id) => ids.add(id)); return { starredMessageIds: ids }; });
      }
    } else if (action === "unstar") {
      const succeeded = result.results?.filter((r) => r.success).map((r) => r.messageId) || [];
      if (succeeded.length > 0) {
        set((s) => { const ids = new Set(s.starredMessageIds); succeeded.forEach((id) => ids.delete(id)); return { starredMessageIds: ids }; });
      }
    }
    return result;
  },

  // ═══ SELECTION ═══

  enterSelectionMode: (firstMessageId) => {
    const ids = new Set();
    if (firstMessageId) ids.add(firstMessageId);
    set({ selectionMode: true, selectedMessageIds: ids });
  },

  exitSelectionMode: () => set({ selectionMode: false, selectedMessageIds: new Set() }),

  toggleMessageSelection: (messageId) => {
    set((s) => {
      const ids = new Set(s.selectedMessageIds);
      ids.has(messageId) ? ids.delete(messageId) : ids.add(messageId);
      return { selectedMessageIds: ids };
    });
  },

  // ═══ CLEAR / DELETE CHAT ═══

  clearChat: async (chatId) => {
    await api.post(`/chats/${chatId}/clear`);
    set((s) => ({ messages: { ...s.messages, [chatId]: [] } }));
    get().fetchChats();
  },

  deleteLocalChat: async (chatId) => {
    await api.delete(`/chats/${chatId}/local`);
    set((s) => ({
      chats: s.chats.filter((c) => c.id !== chatId),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
      messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => k !== chatId)),
    }));
  },

  // ═══ SEARCH NAVIGATION ═══

  highlightMessage: (messageId) => {
    set({ highlightedMessageId: messageId });
    setTimeout(() => set({ highlightedMessageId: null }), 2000);
  },

  // ═══ PACK A: ARCHIVE ═══

  archiveChat: async (chatId, archived) => {
    await api.patch(`/chats/${chatId}/my-settings`, { archived });
    if (archived) {
      // Remove from main list
      set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId), archivedChats: [] }));
    } else {
      // Restore — refresh list; also clear archivedChats so stale view isn't shown
      set({ archivedChats: [] });
      get().fetchChats();
    }
  },

  // ═══ PACK B: FAVORITES ═══

  favoriteChat: async (chatId, favorited) => {
    await api.patch(`/chats/${chatId}/my-settings`, { favorited });
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, _favorited: favorited }
          : c
      ),
      mySettings: {
        ...s.mySettings,
        [chatId]: { ...s.mySettings[chatId], favorited, favoritedAt: favorited ? new Date().toISOString() : null },
      },
    }));
  },

  // ═══ PACK G: MARK ALL READ ═══

  markAllChatsRead: async () => {
    const d = await api.post("/chats/read-all");
    set((s) => ({ chats: s.chats.map((c) => ({ ...c, unreadCount: 0 })) }));
    return d.data;
  },

  // ═══ PACK H: SAVED MESSAGES (SELF-CHAT) ═══

  openSavedMessages: async () => {
    const d = await api.post("/chats/self");
    const chat = d.data.chat;
    set((s) => ({
      chats: s.chats.some((c) => c.id === chat.id) ? s.chats : [chat, ...s.chats],
      activeChatId: chat.id,
    }));
    get().fetchMessages(chat.id);
    get().fetchMySettings(chat.id);
    socket.openChat(chat.id);
    return chat;
  },

  // ═══ PACK D: DRAFTS (localStorage) ═══

  getDraft: (chatId) => {
    try { return localStorage.getItem(`draft:${chatId}`) || ""; } catch { return ""; }
  },

  setDraft: (chatId, text) => {
    try {
      if (text) { localStorage.setItem(`draft:${chatId}`, text); }
      else { localStorage.removeItem(`draft:${chatId}`); }
    } catch {}
  },

  clearDraft: (chatId) => {
    try { localStorage.removeItem(`draft:${chatId}`); } catch {}
  },

  // ═══ PACK F: PER-CHAT THEME (localStorage) ═══

  getChatTheme: (chatId) => {
    try { return localStorage.getItem(`theme:${chatId}`) || "default"; } catch { return "default"; }
  },

  setChatTheme: (chatId, theme) => {
    try {
      if (theme && theme !== "default") { localStorage.setItem(`theme:${chatId}`, theme); }
      else { localStorage.removeItem(`theme:${chatId}`); }
    } catch {}
  },

  // ═══ FIX G: CUSTOM LISTS ═══

  customLists: [],

  fetchCustomLists: async () => {
    try {
      const d = await api.get("/chats/lists");
      set({ customLists: d.data.lists || [] });
    } catch { set({ customLists: [] }); }
  },

  createCustomList: async (name) => {
    const d = await api.post("/chats/lists", { name });
    const list = d.data.list;
    set((s) => ({ customLists: [...s.customLists, list] }));
    return list;
  },

  renameCustomList: async (listId, name) => {
    const d = await api.patch(`/chats/lists/${listId}`, { name });
    const updated = d.data.list;
    set((s) => ({ customLists: s.customLists.map((l) => l.id === listId ? updated : l) }));
    return updated;
  },

  deleteCustomList: async (listId) => {
    await api.delete(`/chats/lists/${listId}`);
    set((s) => ({ customLists: s.customLists.filter((l) => l.id !== listId) }));
  },

  addChatToList: async (listId, chatId) => {
    await api.post(`/chats/lists/${listId}/chats`, { chatId });
    // Reload lists so member counts refresh
    get().fetchCustomLists();
  },

  removeChatFromList: async (listId, chatId) => {
    await api.delete(`/chats/lists/${listId}/chats/${chatId}`);
    get().fetchCustomLists();
  },
}));
