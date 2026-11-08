const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { verifyToken } = require("../utils/jwt");
const { sanitizeText } = require("../utils/sanitize");
const store = require("../db/store");
const messagesService = require("../modules/messages/messages.service");
const translationService = require("../modules/translation/translation.service");
const voiceService = require("../modules/voice/voice.service");
const pushService = require("../utils/push");
const pubsub = require("../utils/pubsub");
const url = require("url");

// Unique per-process ID so cross-instance relay skips own messages.
const INSTANCE_ID = crypto.randomUUID();

const connections = new Map();
const activeChats = new Map();
const typingTimers = new Map();
const liveSessions = new Map();

// ─── Per-event payload size limits (bytes) ───
const EVENT_SIZE_LIMITS = {
  "message:send": 50000,        // 50 KB text
  "voice:send": 26214400,       // 25 MB audio
  "voice:live:start": 500,
  "voice:live:chunk": 10000,    // 10 KB transcript chunk
  "voice:live:stop": 500,
  "message:seen": 500,
  "chat:open": 500,
  "chat:close": 100,
  "typing:start": 500,
  "typing:stop": 500,
  "settings:update": 1000,
  "sync:since": 5000,           // small payload: timestamp + optional chatId list
};

// ─── D2 Reconnect Sync: config ───
const SYNC_MAX_MESSAGES_PER_CHAT = 200;
// Bound lookback so a client that's been offline for months doesn't trigger a
// very expensive replay. Anything older should be loaded on-demand via REST.
const SYNC_MAX_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function createSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 26 * 1024 * 1024 });

  // E3 — initialize cross-instance pub/sub relay (Redis if REDIS_URL set, local EventEmitter otherwise).
  _initPubsub();

  wss.on("connection", async (ws, req) => {
    const parsed = url.parse(req.url, true);
    const token = parsed.query.token;
    if (!token) { ws.close(4001, "No token"); return; }
    let decoded;
    try { decoded = verifyToken(token); } catch { ws.close(4001, "Invalid token"); return; }

    const userId = decoded.sub;
    const user = await store.findUserById(userId);
    if (!user) { ws.close(4001, "User not found"); return; }

    ws.userId = userId;
    ws.isAlive = true;
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(ws);

    await store.updateUserStatus(userId, "online");
    broadcastPresence(userId, "online");

    const onlineUsers = {};
    for (const [uid] of connections) {
      const u = await store.findUserById(uid);
      if (u) onlineUsers[uid] = u.status;
    }
    send(ws, "presence:init", { onlineUsers });

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", async (raw) => {
      const rawStr = raw.toString();

      // Parse
      let data;
      try { data = JSON.parse(rawStr); } catch { send(ws, "error", { message: "Invalid JSON" }); return; }
      const { event, payload } = data;
      if (!event || typeof event !== "string") { send(ws, "error", { message: "Missing event" }); return; }

      // Per-event size validation
      const limit = EVENT_SIZE_LIMITS[event];
      if (limit !== undefined && rawStr.length > limit) {
        send(ws, "error", { message: `Payload too large for ${event}. Max: ${limit} bytes, got: ${rawStr.length}` });
        return;
      }

      try {
        await handleMessage(ws, userId, data);
      } catch (err) {
        send(ws, "error", { message: err.message || "Internal error" });
      }
    });

    ws.on("close", async () => {
      const conns = connections.get(userId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) {
          connections.delete(userId);
          await store.updateUserStatus(userId, "offline");
          broadcastPresence(userId, "offline");
          activeChats.delete(userId);
          liveSessions.delete(userId);
        }
      }
      clearTyping(userId);
    });
  });

  const hb = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false; ws.ping();
    });
  }, 30000);
  wss.on("close", () => clearInterval(hb));

  console.log("  ⚡ WebSocket server attached at /ws");
  return wss;
}

async function handleMessage(ws, userId, data) {
  const { event, payload } = data;
  switch (event) {
    case "message:send": return handleSendMessage(ws, userId, payload);
    case "voice:send": return handleVoiceSend(ws, userId, payload);
    case "voice:live:start": return handleLiveStart(ws, userId, payload);
    case "voice:live:chunk": return handleLiveChunk(ws, userId, payload);
    case "voice:live:stop": return handleLiveStop(ws, userId, payload);
    case "message:seen": return handleSeen(ws, userId, payload);
    case "chat:open": return handleChatOpen(ws, userId, payload);
    case "chat:close": return activeChats.delete(userId);
    case "typing:start": return handleTypingStart(userId, payload);
    case "typing:stop": return handleTypingStop(userId, payload);
    case "settings:update": return handleSettingsUpdate(ws, userId, payload);
    case "sync:since": return handleSyncSince(ws, userId, payload);
    default: send(ws, "error", { message: `Unknown event: ${event}` });
  }
}

// ═══ TEXT MESSAGE ═══

async function handleSendMessage(ws, userId, payload) {
  const { chatId, content, type = "text", metadata = {}, tempId, replyToId } = payload;
  try {
    // Block enforcement for direct chats — check BEFORE persistence
    const chat = await store.findChatById(chatId);
    if (chat && chat.type === "direct") {
      const members = await store.getChatMembers(chatId);
      const otherMember = members.find((m) => m.userId !== userId);
      if (otherMember) {
        const blocked = await store.isBlockedEitherWay(userId, otherMember.userId);
        if (blocked) {
          send(ws, "message:error", { tempId, error: "Cannot send message — blocked relationship", code: "USER_BLOCKED" });
          return;
        }
      }
    }

    // Sanitize content via the messages service (which calls sanitizeText internally)
    const message = await messagesService.sendMessage(chatId, userId, { content, type, metadata, replyToId });
    const sender = await store.findUserById(userId);
    const senderLang = sender?.primaryLang || "en";

    // Pass senderId explicitly so sender is skipped
    const recipientTranslations = await translationService.translateForRecipients(
      message.id, message.content, senderLang, chatId, userId
    );

    send(ws, "message:sent", { message, tempId, translations: recipientTranslations });

    const members = await store.getChatMembers(chatId);
    for (const m of members) {
      if (m.userId === userId) continue;
      // Feature G: If recipient had deleted this chat locally, unhide it so conversation reappears
      if (m.hiddenAt || m.archivedAt) {
        try { await store.unhideChatForUser(chatId, m.userId); } catch (_) {}
      }
      // Notify recipient to refresh their chat list (handles new DMs & unhidden chats)
      sendToUser(m.userId, "chat:updated", { chatId });
      if (activeChats.get(m.userId) === chatId) {
        await store.upsertReceipt(message.id, m.userId, "seen");
        sendToUser(userId, "message:status", { messageId: message.id, chatId, status: "seen", userId: m.userId });
      }
      sendToUser(m.userId, "message:new", {
        message: { ...message, translation: recipientTranslations[m.userId] || null },
      });
      // E2 — push notification for offline recipients (skip muted chats)
      if (!connections.has(m.userId) && !m.muted) {
        const translatedText = recipientTranslations[m.userId] || message.content || "";
        pushService.sendPushToUser(m.userId, {
          type: "message:new",
          chatId,
          messageId: message.id,
          title: sender?.displayName || "New message",
          body: translatedText.slice(0, 140),
          url: `/chats/${chatId}`,
        }).catch(() => {}); // fire-and-forget; push must never block delivery
      }
    }
  } catch (err) {
    send(ws, "message:error", { tempId, error: err.message || "Send failed" });
  }
}

// ═══ VOICE MESSAGE ═══

async function handleVoiceSend(ws, userId, payload) {
  const { chatId, audio, mimeType, duration, tempId } = payload;
  try {
    // Block enforcement for direct chats
    const chat = await store.findChatById(chatId);
    if (chat && chat.type === "direct") {
      const members = await store.getChatMembers(chatId);
      const otherMember = members.find((m) => m.userId !== userId);
      if (otherMember) {
        const blocked = await store.isBlockedEitherWay(userId, otherMember.userId);
        if (blocked) {
          send(ws, "message:error", { tempId, error: "Cannot send message — blocked relationship", code: "USER_BLOCKED" });
          return;
        }
      }
    }

    const audioBuffer = Buffer.from(audio, "base64");
    const { message, recipientTranslations } = await voiceService.processVoiceMessage(
      audioBuffer, mimeType, duration, userId, chatId
    );

    send(ws, "message:sent", { message, tempId, translations: recipientTranslations });

    const sender = await store.findUserById(userId);
    const members = await store.getChatMembers(chatId);
    for (const m of members) {
      if (m.userId === userId) continue;
      if (activeChats.get(m.userId) === chatId) {
        await store.upsertReceipt(message.id, m.userId, "seen");
        sendToUser(userId, "message:status", { messageId: message.id, chatId, status: "seen", userId: m.userId });
      }
      sendToUser(m.userId, "message:new", {
        message: { ...message, translation: recipientTranslations[m.userId] || null },
      });
      // E2 — push for offline recipients (skip muted chats)
      if (!connections.has(m.userId) && !m.muted) {
        pushService.sendPushToUser(m.userId, {
          type: "message:new",
          chatId,
          messageId: message.id,
          title: sender?.displayName || "Voice message",
          body: "🎤 Voice message",
          url: `/chats/${chatId}`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    send(ws, "message:error", { tempId, error: err.message || "Voice send failed" });
  }
}

// ═══ LIVE VOICE ═══

async function handleLiveStart(ws, userId, payload) {
  const { chatId } = payload;
  const sender = await store.findUserById(userId);
  liveSessions.set(userId, { chatId, senderLang: sender?.primaryLang || "en" });
  broadcastToChat(chatId, userId, "voice:live:started", { chatId, userId, userName: sender?.displayName });
  send(ws, "voice:live:ready", { chatId });
}

async function handleLiveChunk(ws, userId, payload) {
  const { transcript, isFinal } = payload;
  const session = liveSessions.get(userId);
  if (!session) return;

  const cleanTranscript = sanitizeText(transcript, { maxLength: 2000 });
  const { chatId, senderLang } = session;
  const sender = await store.findUserById(userId);

  const members = await store.getChatMembers(chatId);
  for (const m of members) {
    if (m.userId === userId) continue;
    const membership = await store.findChatMember(chatId, m.userId);
    if (!membership?.autoTranslate) {
      sendToUser(m.userId, "voice:live:subtitle", {
        chatId, userId, userName: sender?.displayName,
        originalText: cleanTranscript, translatedText: cleanTranscript,
        sourceLang: senderLang, targetLang: senderLang, isFinal,
      });
      continue;
    }
    try {
      const { translatedText, targetLang } = await voiceService.translateLiveChunk(cleanTranscript, senderLang, chatId, m.userId);
      sendToUser(m.userId, "voice:live:subtitle", {
        chatId, userId, userName: sender?.displayName,
        originalText: cleanTranscript, translatedText, sourceLang: senderLang, targetLang, isFinal,
      });
    } catch {
      sendToUser(m.userId, "voice:live:subtitle", {
        chatId, userId, userName: sender?.displayName,
        originalText: cleanTranscript, translatedText: cleanTranscript,
        sourceLang: senderLang, targetLang: senderLang, isFinal,
      });
    }
  }
}

async function handleLiveStop(ws, userId) {
  const session = liveSessions.get(userId);
  if (!session) return;
  liveSessions.delete(userId);
  broadcastToChat(session.chatId, userId, "voice:live:stopped", { chatId: session.chatId, userId });
}

// ═══ SETTINGS / SEEN / TYPING ═══

async function handleSettingsUpdate(ws, userId, payload) {
  const { chatId, receiveLang, autoTranslate } = payload;
  if (!chatId) return;
  const updates = {};
  if (receiveLang !== undefined) updates.receiveLang = receiveLang;
  if (autoTranslate !== undefined) updates.autoTranslate = autoTranslate;
  await store.updateChatMember(chatId, userId, updates);
  send(ws, "settings:updated", { chatId, ...updates });
}

async function handleSeen(ws, userId, payload) {
  const { messageId, chatId } = payload;
  try {
    if (chatId) {
      await messagesService.markAllSeen(chatId, userId);
      const msgs = await store.listMessages(chatId, { limit: 100 });
      const sids = [...new Set(msgs.filter((m) => m.senderId !== userId).map((m) => m.senderId))];
      for (const s of sids) sendToUser(s, "message:status", { chatId, status: "seen", userId, bulk: true });
    } else if (messageId) {
      await messagesService.markMessageSeen(messageId, userId);
      const msg = await store.findMessageById(messageId);
      if (msg) sendToUser(msg.senderId, "message:status", { messageId, chatId: msg.chatId, status: "seen", userId });
    }
  } catch {}
}

async function handleChatOpen(ws, userId, payload) {
  activeChats.set(userId, payload.chatId);
  try {
    await messagesService.markAllSeen(payload.chatId, userId);
    const msgs = await store.listMessages(payload.chatId, { limit: 100 });
    const sids = [...new Set(msgs.filter((m) => m.senderId !== userId).map((m) => m.senderId))];
    for (const s of sids) sendToUser(s, "message:status", { chatId: payload.chatId, status: "seen", userId, bulk: true });
  } catch {}
}

function handleTypingStart(uid, p) {
  if (!p.chatId) return;
  broadcastToChat(p.chatId, uid, "typing:update", { chatId: p.chatId, userId: uid, isTyping: true });
  clearTyping(uid);
  typingTimers.set(uid, setTimeout(() => broadcastToChat(p.chatId, uid, "typing:update", { chatId: p.chatId, userId: uid, isTyping: false }), 3000));
}

function handleTypingStop(uid, p) {
  if (!p.chatId) return;
  clearTyping(uid);
  broadcastToChat(p.chatId, uid, "typing:update", { chatId: p.chatId, userId: uid, isTyping: false });
}

function clearTyping(uid) { const t = typingTimers.get(uid); if (t) { clearTimeout(t); typingTimers.delete(uid); } }

// ═══ D2 — RECONNECT SYNC ═══

/**
 * Replay messages the user missed while disconnected.
 *
 * Payload:
 *   { lastSeenAt: ISODate string, chatIds?: uuid[] }
 *
 * Behavior:
 *   - Clamps lookback to SYNC_MAX_LOOKBACK_MS (14 days).
 *   - Without chatIds: iterates every chat the user is a member of.
 *     With chatIds: limits the sync to those chats (still validated for
 *     membership so an attacker can't probe other chats).
 *   - For each chat, fetches messages created after lastSeenAt.
 *   - Caps each chat's replay at SYNC_MAX_MESSAGES_PER_CHAT (200).
 *   - Emits each message as a standard "message:new" so client code that
 *     already handles real-time delivery transparently handles replay too.
 *   - Emits "message:deleted" for messages deleted after lastSeenAt. Safe to
 *     repeat: the client ignores a message that is already deleted.
 *   - If any chat hit the 200-cap, emits "sync:truncated" with a list of
 *     affected chatIds so the client can fetch older history via REST.
 *   - Emits "sync:complete" with { at: ISODate, chatsSynced, totalMessages }.
 */
async function handleSyncSince(ws, userId, payload) {
  try {
    const { lastSeenAt, chatIds } = payload || {};

    // Validate timestamp. Anchor to "now - 14 days" if missing or invalid or too old.
    let sinceMs = Date.parse(lastSeenAt);
    const nowMs = Date.now();
    const floorMs = nowMs - SYNC_MAX_LOOKBACK_MS;
    if (!Number.isFinite(sinceMs) || sinceMs < floorMs) {
      sinceMs = floorMs;
    }
    const since = new Date(sinceMs);

    // Determine target chats
    const userChats = await store.listUserChats(userId);
    let targetChats = userChats;
    if (Array.isArray(chatIds) && chatIds.length > 0) {
      const allowed = new Set(userChats.map((c) => c.id));
      targetChats = chatIds.filter((id) => allowed.has(id)).map((id) => userChats.find((c) => c.id === id));
    }

    const truncatedChats = [];
    let totalReplayed = 0;

    for (const chat of targetChats) {
      if (!chat) continue;

      // Fetch messages strictly AFTER since, oldest → newest, capped.
      const recent = await store.listMessages(chat.id, { limit: SYNC_MAX_MESSAGES_PER_CHAT + 1, forUserId: userId });
      const missed = recent
        .filter((m) => new Date(m.createdAt) > since && m.senderId !== userId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      let truncated = false;
      let toSend = missed;
      if (missed.length > SYNC_MAX_MESSAGES_PER_CHAT) {
        toSend = missed.slice(-SYNC_MAX_MESSAGES_PER_CHAT);
        truncated = true;
      }

      if (truncated) truncatedChats.push(chat.id);

      // Resolve per-recipient translation for this user only.
      const receiveLang = await store.getEffectiveReceiveLang(chat.id, userId);
      const senderCache = new Map();

      for (const msg of toSend) {
        let sender = senderCache.get(msg.senderId);
        if (!sender) {
          sender = await store.findUserById(msg.senderId);
          senderCache.set(msg.senderId, sender);
        }

        // Try to use an already-cached translation; don't trigger new API calls
        // during replay to avoid surprise cost + latency spikes on reconnect.
        let translation = null;
        if (receiveLang && sender?.primaryLang && receiveLang !== sender.primaryLang) {
          const cached = await store.findTranslation(msg.id, receiveLang);
          if (cached) {
            translation = {
              translatedText: cached.translatedText,
              sourceLang: cached.sourceLang,
              targetLang: cached.targetLang,
            };
          }
        }

        // Emit in the same shape as real-time delivery, so the client reuses
        // its existing "message:new" reducer.
        send(ws, "message:new", {
          message: { ...msg, sender, translation },
          _replayed: true,
        });
        totalReplayed++;
      }
    }

    // Deletions the client missed while disconnected. message:new can't carry these:
    // deleted rows aren't replayed and the client skips messages it already holds.
    const deletions = await store.listDeletedMessagesSince(userId, since, {
      chatIds: Array.isArray(chatIds) ? chatIds : undefined,
    });
    for (const d of deletions) {
      send(ws, "message:deleted", { chatId: d.chatId, messageId: d.id, deletedAt: d.deletedAt });
    }

    if (truncatedChats.length > 0) {
      send(ws, "sync:truncated", {
        chatIds: truncatedChats,
        capPerChat: SYNC_MAX_MESSAGES_PER_CHAT,
        message: "Too many missed messages in these chats. Fetch older history via REST.",
      });
    }

    send(ws, "sync:complete", {
      at: new Date().toISOString(),
      since: since.toISOString(),
      chatsSynced: targetChats.filter(Boolean).length,
      totalMessages: totalReplayed,
    });
  } catch (err) {
    send(ws, "error", { message: `sync:since failed: ${err.message}` });
  }
}

// ═══ TRANSPORT (E3 — pubsub-aware for multi-instance scaling) ═══

/**
 * Send directly to one WebSocket connection (always local).
 */
function send(ws, event, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ event, payload }));
}

/**
 * Deliver to a user's local connections only (no cross-instance relay).
 * Used by the pubsub subscriber and by direct-response sends (e.g.
 * sending message:status back to the sender — always on this instance).
 */
function _sendLocal(uid, event, payload) {
  const c = connections.get(uid);
  if (!c) return;
  const m = JSON.stringify({ event, payload });
  for (const ws of c) if (ws.readyState === 1) ws.send(m);
}

/**
 * Send to a user — delivers locally AND publishes via pubsub so other
 * instances can deliver to their local connections for the same user.
 * The pubsub subscriber skips messages from the same INSTANCE_ID to
 * prevent double delivery.
 */
function sendToUser(uid, event, payload) {
  _sendLocal(uid, event, payload);
  pubsub.publish("ws:relay", { iid: INSTANCE_ID, uid, event, payload });
}

/**
 * Broadcast to all members of a chat except `excl` (the sender).
 */
async function broadcastToChat(chatId, excl, event, payload) {
  const ms = await store.getChatMembers(chatId);
  for (const mb of ms) {
    if (mb.userId === excl) continue;
    sendToUser(mb.userId, event, payload);
  }
}

/**
 * Broadcast presence to all connected users except the one who changed.
 */
function broadcastPresence(uid, status) {
  const payload = { userId: uid, status };
  for (const [u] of connections) {
    if (u === uid) continue;
    _sendLocal(u, "presence:update", payload);
  }
  // Also relay so other instances update their local connections.
  pubsub.publish("ws:presence", { iid: INSTANCE_ID, uid, status });
}

/**
 * Initialize pubsub subscriptions. Called once when the WS server starts.
 */
function _initPubsub() {
  pubsub.init();

  // Cross-instance user-targeted relay.
  pubsub.subscribe("ws:relay", (msg) => {
    if (msg.iid === INSTANCE_ID) return; // skip own messages
    _sendLocal(msg.uid, msg.event, msg.payload);
  });

  // Cross-instance presence broadcast.
  pubsub.subscribe("ws:presence", (msg) => {
    if (msg.iid === INSTANCE_ID) return;
    const payload = { userId: msg.uid, status: msg.status };
    for (const [u] of connections) {
      if (u === msg.uid) continue;
      _sendLocal(u, "presence:update", payload);
    }
  });

  // Real-time profile updates — broadcast to all connected users
  pubsub.subscribe("ws:profile-updated", (msg) => {
    const { userId, displayName, bio, avatarUrl, primaryLang, status } = msg;
    for (const [u] of connections) {
      if (u === userId) continue;
      _sendLocal(u, "user:profile-updated", { userId, displayName, bio, avatarUrl, primaryLang, status });
    }
  });

  // Real-time block/unblock sync — notify both parties via WebSocket
  pubsub.subscribe("ws:block-state", (msg) => {
    const { blockerId, blockedId, chatId, blocked } = msg;
    // Notify the blocked user (so their composer updates)
    sendToUser(blockedId, "user:block-state-changed", { userId: blockerId, chatId, blocked });
    // Notify the blocker (multi-device sync)
    sendToUser(blockerId, "user:block-state-changed", { userId: blockedId, chatId, blocked });
  });
}

module.exports = { createSocketServer, sendToUser, broadcastToChat };
