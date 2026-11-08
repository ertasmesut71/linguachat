/**
 * Build a fresh Express app for testing.
 *
 * Replaces server/db/store with an in-memory implementation so the real
 * auth/media/message routes run end-to-end without a Postgres server.
 * The in-memory store implements every method actually used by the
 * tested routes.
 *
 * Returns { app, store } so tests can both hit the HTTP API and peek
 * at or pre-seed the store.
 */

const path = require("path");
const { v4: uuidv4 } = require("uuid");

/**
 * Minimal in-memory store matching the public API of server/db/store.js.
 * Only methods used by tested routes need to be implemented; anything
 * unused is left undefined and will throw clearly if touched, which
 * surfaces accidental cross-test dependencies.
 */
function createMemoryStore() {
  const users = new Map();
  const chats = new Map();
  const chatMembers = new Map();      // key: `${chatId}:${userId}`
  const messages = new Map();
  const receipts = new Map();         // key: `${messageId}:${userId}`
  const translations = new Map();     // key: `${messageId}:${targetLang}`
  const refreshTokens = new Map();    // key: tokenHash
  const passwordResetTokens = new Map(); // key: tokenHash
  const pairingTokens = new Map();       // key: code
  const pushSubscriptions = new Map();   // key: endpoint
  const blockedUsers = new Map();        // key: "blockerId:blockedId"
  const reports = [];
  const hiddenMessages = new Set();       // key: "messageId:userId" (per-user Delete for me)
  const starredMessages = new Set();     // key: "messageId:userId" (per-user stars)
  const pinnedMessages = new Map();      // key: chatId -> Map(messageId -> pin record)
  const otpCodes = [];                   // { id, phone, code, purpose, attempts, maxAttempts, consumed, expiresAt, createdAt }
  // Pack C: Custom Lists
  const chatLists = new Map();           // key: listId
  const chatListMembers = new Map();     // key: `${listId}:${chatId}`

  function sanitize(user) {
    if (!user) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  }

  const store = {
    prisma: { $connect: async () => {}, $disconnect: async () => {} },

    async createUser(data) {
      const id = uuidv4();
      const now = new Date().toISOString();
      const user = {
        id,
        email: data.email ? data.email.toLowerCase().trim() : null,
        phoneNumber: data.phoneNumber || null,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl || null,
        bio: data.bio || "",
        role: data.role || "user",
        status: "offline",
        primaryLang: data.primaryLang || "en",
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      };
      users.set(id, user);
      return sanitize(user);
    },

    async findUserByEmail(email) {
      if (!email) return null;
      const e = email.toLowerCase().trim();
      for (const u of users.values()) {
        if (u.email && u.email === e) return { ...u };
      }
      return null;
    },

    async findUserByEmailWithPassword(email) {
      return store.findUserByEmail(email);
    },

    async findUserByPhone(phone) {
      if (!phone) return null;
      for (const u of users.values()) {
        if (u.phoneNumber === phone) return sanitize(u);
      }
      return null;
    },

    async findUserByPhoneWithPassword(phone) {
      if (!phone) return null;
      for (const u of users.values()) {
        if (u.phoneNumber === phone) return { ...u };
      }
      return null;
    },

    async findUserById(id) {
      const u = users.get(id);
      return u ? sanitize(u) : null;
    },

    async updateUser(id, data) {
      const u = users.get(id);
      if (!u) return null;
      const { id: _i, email: _e, passwordHash: _p, ...safe } = data;
      Object.assign(u, safe, { updatedAt: new Date().toISOString() });
      return sanitize(u);
    },

    async updateUserPassword(id, passwordHash) {
      const u = users.get(id);
      if (!u) return null;
      u.passwordHash = passwordHash;
      u.updatedAt = new Date().toISOString();
      return sanitize(u);
    },

    async updateUserStatus(id, status) {
      const u = users.get(id);
      if (!u) return null;
      u.status = status;
      u.lastSeenAt = new Date().toISOString();
      return sanitize(u);
    },

    async listUsers({ excludeId, limit = 50 } = {}) {
      const all = [...users.values()].filter((u) => u.id !== excludeId);
      return all.slice(0, limit).map(sanitize);
    },

    async searchUsers(query, excludeId) {
      const q = (query || "").toLowerCase();
      const phoneQ = q.replace(/[^\d]/g, "");
      return [...users.values()]
        .filter((u) => u.id !== excludeId)
        .filter((u) => {
          if (u.displayName.toLowerCase().includes(q)) return true;
          if (u.email && u.email.toLowerCase().includes(q)) return true;
          if (phoneQ.length >= 4 && u.phoneNumber && u.phoneNumber.includes(phoneQ)) return true;
          return false;
        })
        .map(sanitize);
    },

    async createChat(data) {
      const id = uuidv4();
      const now = new Date().toISOString();
      const chat = {
        id,
        type: data.type || "direct",
        name: data.name || null,
        description: data.description || null,
        avatarUrl: data.avatarUrl || null,
        createdBy: data.createdBy || null,
        disappearingTimer: data.disappearingTimer || null,  // Pack E
        createdAt: now,
        updatedAt: now,
      };
      chats.set(id, chat);
      return { ...chat };
    },

    async findChatById(id) {
      const c = chats.get(id);
      return c ? { ...c } : null;
    },

    async updateChat(id, data) {
      const c = chats.get(id);
      if (!c) return null;
      // Pack E: allow disappearingTimer to be set/cleared (including null)
      const updates = { ...data, updatedAt: new Date().toISOString() };
      Object.assign(c, updates);
      return { ...c };
    },

    async findDirectChat(userIdA, userIdB) {
      for (const c of chats.values()) {
        if (c.type !== "direct") continue;
        const memberIds = [...chatMembers.values()]
          .filter((m) => m.chatId === c.id)
          .map((m) => m.userId);
        if (memberIds.length === 2 && memberIds.includes(userIdA) && memberIds.includes(userIdB)) {
          return { ...c };
        }
      }
      return null;
    },

    async listUserChats(userId, { includeArchived = false } = {}) {
      const now = new Date();
      const result = [];
      for (const [key, mb] of chatMembers) {
        if (mb.userId !== userId) continue;
        if (mb.hiddenAt) continue;  // Feature G: skip chats user has deleted locally
        // Pack A: skip archived chats unless requested
        if (!includeArchived && mb.archivedAt) continue;
        const chat = chats.get(mb.chatId);
        if (!chat) continue;
        const members = [...chatMembers.values()]
          .filter((m) => m.chatId === chat.id)
          .map((m) => ({
            ...m,
            user: sanitize(users.get(m.userId)),
            archivedAt: m.archivedAt || null,
            favoritedAt: m.favoritedAt || null,
          }));
        const clearedAt = mb.clearedAt ? new Date(mb.clearedAt) : null;
        const chatMsgs = [...messages.values()]
          .filter((m) => {
            if (m.chatId !== chat.id) return false;
            if (m.deletedAt) return false;
            if (hiddenMessages.has(`${m.id}:${userId}`)) return false;
            if (clearedAt && new Date(m.createdAt) <= clearedAt) return false;
            // Pack E: filter expired messages
            if (m.expiresAt && new Date(m.expiresAt) <= now) return false;
            return true;
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        result.push({
          ...chat,
          members,
          myArchivedAt: mb.archivedAt ? new Date(mb.archivedAt).toISOString() : null,
          lastMessage: chatMsgs[0] ? { ...chatMsgs[0], sender: sanitize(users.get(chatMsgs[0].senderId)) } : null,
          unreadCount: chatMsgs.filter((m) => m.senderId !== userId && new Date(m.createdAt) > new Date(mb.lastReadAt)).length,
        });
      }
      result.sort((a, b) => {
        const aT = a.lastMessage?.createdAt || a.createdAt;
        const bT = b.lastMessage?.createdAt || b.createdAt;
        return new Date(bT) - new Date(aT);
      });
      return result;
    },

    async addChatMember(data) {
      const id = uuidv4();
      const now = new Date().toISOString();
      const member = {
        id,
        chatId: data.chatId,
        userId: data.userId,
        role: data.role || "member",
        receiveLang: data.receiveLang || null,
        autoTranslate: data.autoTranslate !== false,
        muted: false,
        lastReadAt: now,
        joinedAt: now,
        hiddenAt: null,
        clearedAt: null,
        archivedAt: null,   // Pack A
        favoritedAt: null,  // Pack B
      };
      chatMembers.set(`${data.chatId}:${data.userId}`, member);
      return { ...member };
    },

    async findChatMember(chatId, userId) {
      const m = chatMembers.get(`${chatId}:${userId}`);
      return m ? { ...m } : null;
    },

    async getChatMembers(chatId) {
      return [...chatMembers.values()]
        .filter((m) => m.chatId === chatId)
        .map((m) => ({ ...m, user: sanitize(users.get(m.userId)) }));
    },

    async updateChatMember(chatId, userId, data) {
      const key = `${chatId}:${userId}`;
      const m = chatMembers.get(key);
      if (!m) return null;
      Object.assign(m, data);
      return { ...m };
    },

    async removeChatMember(chatId, userId) {
      return chatMembers.delete(`${chatId}:${userId}`);
    },

    async getEffectiveReceiveLang(chatId, userId) {
      const m = chatMembers.get(`${chatId}:${userId}`);
      if (m?.receiveLang) return m.receiveLang;
      const u = users.get(userId);
      return u?.primaryLang || "en";
    },

    async createMessage(data) {
      const id = uuidv4();
      const now = new Date().toISOString();
      // Pack E: compute expiresAt from chat's disappearingTimer
      let expiresAt = null;
      const chat = chats.get(data.chatId);
      if (chat?.disappearingTimer) {
        expiresAt = new Date(Date.now() + chat.disappearingTimer * 1000).toISOString();
      }
      const msg = {
        id,
        chatId: data.chatId,
        senderId: data.senderId,
        type: data.type || "text",
        content: data.content || "",
        metadata: data.metadata || {},
        replyToId: data.replyToId || null,
        editedAt: null,
        deletedAt: null,
        expiresAt,  // Pack E
        createdAt: now,
      };
      messages.set(id, msg);
      if (chat) chat.updatedAt = now;
      return { ...msg };
    },

    async getChatDisappearingTimer(chatId) {
      const chat = chats.get(chatId);
      return chat?.disappearingTimer || null;
    },

    async findMessageById(id) {
      const m = messages.get(id);
      return m ? { ...m } : null;
    },

    async listMessages(chatId, { limit = 50, before, forUserId } = {}) {
      const now = new Date();
      let list = [...messages.values()].filter((m) => m.chatId === chatId && !m.deletedAt);
      if (forUserId) list = list.filter((m) => !hiddenMessages.has(`${m.id}:${forUserId}`));
      if (before) list = list.filter((m) => new Date(m.createdAt) < new Date(before));
      // Feature F: Clear Chat — filter out messages before clearedAt
      if (forUserId) {
        const mb = chatMembers.get(`${chatId}:${forUserId}`);
        if (mb?.clearedAt) {
          const clearedAt = new Date(mb.clearedAt);
          list = list.filter((m) => new Date(m.createdAt) > clearedAt);
        }
      }
      // Pack E: filter expired messages
      list = list.filter((m) => !m.expiresAt || new Date(m.expiresAt) > now);
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      return list.slice(-limit);
    },

    async hideMessageForUser(messageId, userId) {
      hiddenMessages.add(`${messageId}:${userId}`);
      return true;
    },

    async getHiddenMessageIds(userId, chatId) {
      return [...hiddenMessages]
        .filter((k) => k.endsWith(`:${userId}`))
        .map((k) => k.split(":")[0])
        .filter((mid) => !chatId || messages.get(mid)?.chatId === chatId);
    },

    async searchMessages(chatId, query, { forUserId } = {}) {
      const q = (query || "").toLowerCase();
      const now = new Date();
      let list = [...messages.values()]
        .filter((m) => m.chatId === chatId && !m.deletedAt)
        .filter((m) => !forUserId || !hiddenMessages.has(`${m.id}:${forUserId}`))
        .filter((m) => (m.content || "").toLowerCase().includes(q));
      // Feature F: Clear Chat — exclude cleared messages
      if (forUserId) {
        const mb = chatMembers.get(`${chatId}:${forUserId}`);
        if (mb?.clearedAt) {
          const clearedAt = new Date(mb.clearedAt);
          list = list.filter((m) => new Date(m.createdAt) > clearedAt);
        }
      }
      // Pack E: filter expired messages
      list = list.filter((m) => !m.expiresAt || new Date(m.expiresAt) > now);
      return list;
    },

    async softDeleteMessage(messageId, replacement) {
      const m = messages.get(messageId);
      if (!m) return null;
      m.deletedAt = new Date().toISOString();
      m.content = replacement || "[Message deleted by admin]";
      return { ...m };
    },

    async listDeletedMessagesSince(userId, since, { chatIds, limit = 500 } = {}) {
      return [...messages.values()]
        .filter((m) => m.deletedAt && new Date(m.deletedAt) > new Date(since))
        .filter((m) => chatMembers.has(`${m.chatId}:${userId}`))
        .filter((m) => !chatIds?.length || chatIds.includes(m.chatId))
        .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt))
        .slice(0, limit)
        .map((m) => ({ id: m.id, chatId: m.chatId, deletedAt: m.deletedAt }));
    },

    async upsertReceipt(messageId, userId, status) {
      const key = `${messageId}:${userId}`;
      const existing = receipts.get(key);
      if (existing) {
        existing.status = status;
        existing.updatedAt = new Date().toISOString();
        return { ...existing };
      }
      const r = { id: uuidv4(), messageId, userId, status, updatedAt: new Date().toISOString() };
      receipts.set(key, r);
      return { ...r };
    },

    async getMessageReceipts(messageId) {
      return [...receipts.values()].filter((r) => r.messageId === messageId);
    },

    async createTranslation(data) {
      const key = `${data.messageId}:${data.targetLang}`;
      const t = {
        id: uuidv4(),
        messageId: data.messageId,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        translatedText: data.translatedText,
        createdAt: new Date().toISOString(),
      };
      translations.set(key, t);
      return { ...t };
    },

    async upsertTranslation(data) {
      const key = `${data.messageId}:${data.targetLang}`;
      const existing = translations.get(key);
      if (existing) {
        existing.translatedText = data.translatedText;
        existing.sourceLang = data.sourceLang;
        return { ...existing };
      }
      return store.createTranslation(data);
    },

    async updateMessageMetadata(messageId, metadataPatch) {
      const m = messages.get(messageId);
      if (!m) return null;
      m.metadata = { ...(m.metadata || {}), ...metadataPatch };
      return { ...m };
    },

    async findTranslation(messageId, targetLang) {
      const t = translations.get(`${messageId}:${targetLang}`);
      return t ? { ...t } : null;
    },

    async getMessageTranslations(messageId) {
      return [...translations.values()].filter((t) => t.messageId === messageId);
    },

    async storeRefreshToken(data) {
      const t = {
        id: uuidv4(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      refreshTokens.set(data.tokenHash, t);
      return { ...t };
    },

    async findRefreshToken(tokenHash) {
      const t = refreshTokens.get(tokenHash);
      return t && !t.revoked ? { ...t } : null;
    },

    async revokeRefreshToken(tokenHash) {
      const t = refreshTokens.get(tokenHash);
      if (t) t.revoked = true;
      return true;
    },

    async revokeAllUserRefreshTokens(userId) {
      for (const t of refreshTokens.values()) {
        if (t.userId === userId) t.revoked = true;
      }
    },

    // ─── Password reset tokens ───

    async createPasswordResetToken(data) {
      const t = {
        id: uuidv4(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt instanceof Date ? data.expiresAt.toISOString() : data.expiresAt,
        consumedAt: null,
        createdAt: new Date().toISOString(),
      };
      passwordResetTokens.set(data.tokenHash, t);
      return { ...t };
    },

    async findPasswordResetTokenByHash(tokenHash) {
      const t = passwordResetTokens.get(tokenHash);
      return t ? { ...t } : null;
    },

    async consumePasswordResetToken(tokenHash) {
      const t = passwordResetTokens.get(tokenHash);
      if (!t) return null;
      t.consumedAt = new Date().toISOString();
      return { ...t };
    },

    async revokeUserPasswordResetTokens(userId) {
      for (const t of passwordResetTokens.values()) {
        if (t.userId === userId && !t.consumedAt) {
          t.consumedAt = new Date().toISOString();
        }
      }
    },

    // ─── Pairing tokens (D8 — QR-based desktop login) ───

    async createPairingToken(data) {
      const t = {
        id: uuidv4(),
        code: data.code,
        nonceHash: data.nonceHash,
        deviceLabel: data.deviceLabel || null,
        status: "pending",
        approvedUserId: null,
        expiresAt: data.expiresAt instanceof Date ? data.expiresAt.toISOString() : data.expiresAt,
        consumedAt: null,
        createdAt: new Date().toISOString(),
      };
      pairingTokens.set(data.code, t);
      return { ...t };
    },

    async findPairingTokenByCode(code) {
      const t = pairingTokens.get(code);
      return t ? { ...t } : null;
    },

    async approvePairingToken(code, userId) {
      const t = pairingTokens.get(code);
      if (!t) return null;
      t.status = "approved";
      t.approvedUserId = userId;
      return { ...t };
    },

    async consumePairingToken(code) {
      const t = pairingTokens.get(code);
      if (!t) return null;
      t.status = "consumed";
      t.consumedAt = new Date().toISOString();
      return { ...t };
    },

    // ─── Push Subscriptions (E2) ───

    async upsertPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
      const existing = pushSubscriptions.get(endpoint);
      if (existing) {
        existing.userId = userId;
        existing.p256dh = p256dh;
        existing.auth = auth;
        existing.userAgent = userAgent || null;
        existing.lastSeenAt = new Date().toISOString();
        return { ...existing };
      }
      const rec = {
        id: uuidv4(),
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent || null,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      pushSubscriptions.set(endpoint, rec);
      return { ...rec };
    },

    async removePushSubscription(endpoint) {
      return pushSubscriptions.delete(endpoint);
    },

    async getPushSubscriptionsForUser(userId) {
      const out = [];
      for (const s of pushSubscriptions.values()) {
        if (s.userId === userId) out.push({ ...s });
      }
      return out;
    },

    async touchPushSubscription(endpoint) {
      const s = pushSubscriptions.get(endpoint);
      if (!s) return false;
      s.lastSeenAt = new Date().toISOString();
      return true;
    },

    // Internal state access for tests
    // ─── Block / Report (H) ───
    blockUser(blockerId, blockedId) { blockedUsers.set(`${blockerId}:${blockedId}`, { blockerId, blockedId, createdAt: new Date().toISOString() }); return true; },
    unblockUser(blockerId, blockedId) { return blockedUsers.delete(`${blockerId}:${blockedId}`); },
    isBlocked(blockerId, blockedId) { return blockedUsers.has(`${blockerId}:${blockedId}`); },
    isBlockedEitherWay(userA, userB) { return blockedUsers.has(`${userA}:${userB}`) || blockedUsers.has(`${userB}:${userA}`); },
    getBlockedUserIds(userId) { const ids = []; for (const [k, v] of blockedUsers) { if (v.blockerId === userId) ids.push(v.blockedId); } return ids; },
    createReport(reporterId, reportedId, reason) { reports.push({ reporterId, reportedId, reason, createdAt: new Date().toISOString() }); return true; },

    // ─── OTP ───
    createOtp(phone, code, purpose, expiresAt) {
      // Invalidate previous
      for (const o of otpCodes) { if (o.phone === phone && o.purpose === purpose && !o.consumed) o.consumed = true; }
      otpCodes.push({ id: `otp_${Date.now()}`, phone, code, purpose, attempts: 0, maxAttempts: 5, consumed: false, expiresAt, createdAt: new Date().toISOString() });
      return true;
    },
    verifyOtp(phone, code, purpose) {
      const candidates = otpCodes.filter((o) => o.phone === phone && o.purpose === purpose && !o.consumed);
      if (candidates.length === 0) return { valid: false, reason: "no_code" };
      const otp = candidates[candidates.length - 1];
      if (new Date(otp.expiresAt) < new Date()) return { valid: false, reason: "expired" };
      if (otp.attempts >= otp.maxAttempts) return { valid: false, reason: "too_many_attempts" };
      if (otp.code !== code) { otp.attempts++; return { valid: false, reason: "wrong_code" }; }
      otp.consumed = true;
      return { valid: true };
    },
    countRecentOtps(phone, windowMs = 600000) {
      const since = Date.now() - windowMs;
      return otpCodes.filter((o) => o.phone === phone && new Date(o.createdAt).getTime() > since).length;
    },

    // ─── Contacts bulk match ───
    findUsersByPhones(phones) {
      if (!phones || phones.length === 0) return [];
      const phoneSet = new Set(phones);
      return [...users.values()]
        .filter((u) => u.phoneNumber && phoneSet.has(u.phoneNumber))
        .map(sanitize);
    },

    // ─── Feature A: Starred Messages ───
    async starMessage(messageId, userId) {
      starredMessages.add(`${messageId}:${userId}`);
      return true;
    },
    async unstarMessage(messageId, userId) {
      starredMessages.delete(`${messageId}:${userId}`);
      return true;
    },
    async isStarred(messageId, userId) {
      return starredMessages.has(`${messageId}:${userId}`);
    },
    async getStarredMessages(userId) {
      const results = [];
      for (const key of starredMessages) {
        const [mid, uid] = key.split(":");
        if (uid !== userId) continue;
        const m = messages.get(mid);
        if (!m || m.deletedAt) continue;
        if (m.expiresAt && new Date(m.expiresAt) <= new Date()) continue;
        results.push({ ...m, starredAt: new Date().toISOString() });
      }
      return results;
    },

    // ─── Feature B: Pinned Messages ───
    async pinMessage(chatId, messageId, pinnedBy) {
      const key = chatId;
      if (!pinnedMessages.has(key)) pinnedMessages.set(key, new Map());
      pinnedMessages.get(key).set(messageId, { id: uuidv4(), chatId, messageId, pinnedBy, pinnedAt: new Date().toISOString() });
      return true;
    },
    async unpinMessage(chatId, messageId) {
      const m = pinnedMessages.get(chatId);
      if (m) m.delete(messageId);
      return true;
    },
    async getPinnedMessages(chatId) {
      const m = pinnedMessages.get(chatId);
      if (!m) return [];
      const results = [];
      for (const [messageId, pin] of m) {
        const msg = messages.get(messageId);
        if (msg?.expiresAt && new Date(msg.expiresAt) <= new Date()) continue;
        results.push({
          ...pin,
          messageType: msg?.type || "text",
          messageContent: msg?.content || "",
          senderId: msg?.senderId || null,
          deletedAt: msg?.deletedAt || null,
          expiresAt: msg?.expiresAt || null,
          messageMetadata: msg?.metadata || {},
        });
      }
      return results;
    },

    // ─── Feature C: Edit Message ───
    async editMessage(messageId, newContent) {
      const m = messages.get(messageId);
      if (!m) return null;
      m.content = newContent;
      m.editedAt = new Date().toISOString();
      return { ...m };
    },
    async deleteTranslationsForMessage(messageId) {
      for (const [key] of translations) {
        if (key.startsWith(`${messageId}:`)) translations.delete(key);
      }
      return true;
    },

    // ─── Feature F: Clear Chat ───
    async clearChatForUser(chatId, userId) {
      const key = `${chatId}:${userId}`;
      const m = chatMembers.get(key);
      if (!m) return null;
      const now = new Date().toISOString();
      m.clearedAt = now;
      return { clearedAt: now };
    },

    // ─── Feature G: Delete Chat / Hide Chat ───
    async hideChatForUser(chatId, userId) {
      const key = `${chatId}:${userId}`;
      const m = chatMembers.get(key);
      if (!m) return null;
      const now = new Date().toISOString();
      m.hiddenAt = now;
      return { hiddenAt: now };
    },
    async unhideChatForUser(chatId, userId) {
      const key = `${chatId}:${userId}`;
      const m = chatMembers.get(key);
      if (m) m.hiddenAt = null;
      return true;
    },

    // ─── Pack H: Self-chat (Saved Messages) ───
    async findSelfChat(userId) {
      for (const c of chats.values()) {
        if (c.type !== "direct") continue;
        if (c.name !== "Saved Messages") continue;
        if (c.createdBy !== userId) continue;
        const members = [...chatMembers.values()].filter((m) => m.chatId === c.id);
        if (members.length === 1 && members[0].userId === userId) return { ...c };
      }
      return null;
    },

    // ─── Pack C: Custom Lists ───
    async listChatLists(userId) {
      return [...chatLists.values()]
        .filter((l) => l.userId === userId)
        .map((l) => {
          const items = [...chatListMembers.values()].filter((m) => m.listId === l.id);
          return { ...l, items, chatIds: items.map((m) => m.chatId) };
        });
    },

    async findChatList(listId, userId) {
      const l = chatLists.get(listId);
      if (!l || l.userId !== userId) return null;
      return { ...l, items: [...chatListMembers.values()].filter((m) => m.listId === listId) };
    },

    async createChatList(userId, name) {
      const id = uuidv4();
      const now = new Date().toISOString();
      const list = { id, userId, name, createdAt: now, updatedAt: now };
      chatLists.set(id, list);
      return { ...list, items: [] };
    },

    async updateChatList(listId, data) {
      const l = chatLists.get(listId);
      if (!l) return null;
      Object.assign(l, data, { updatedAt: new Date().toISOString() });
      return { ...l, items: [...chatListMembers.values()].filter((m) => m.listId === listId) };
    },

    async deleteChatList(listId) {
      // Remove list members first
      for (const [key, m] of chatListMembers) {
        if (m.listId === listId) chatListMembers.delete(key);
      }
      return chatLists.delete(listId);
    },

    async addChatToList(listId, chatId) {
      const key = `${listId}:${chatId}`;
      if (!chatListMembers.has(key)) {
        chatListMembers.set(key, { id: uuidv4(), listId, chatId, addedAt: new Date().toISOString() });
      }
      return true;
    },

    async removeChatFromList(listId, chatId) {
      return chatListMembers.delete(`${listId}:${chatId}`);
    },

    _raw: { users, chats, chatMembers, messages, receipts, translations, refreshTokens, passwordResetTokens, pairingTokens, pushSubscriptions, blockedUsers, reports, otpCodes, chatLists, chatListMembers },
  };

  return store;
}

/**
 * Build a fresh Express app that uses the in-memory store.
 * Returns { app, store }.
 */
function buildApp() {
  // Ensure each call gets a clean module cache so store.js is re-evaluated.
  jest.resetModules();

  const store = createMemoryStore();

  // Intercept every require of server/db/store — covering the various
  // relative paths used across modules (../db/store, ../../db/store, ./db/store).
  jest.doMock(path.resolve(__dirname, "../../server/db/store.js"), () => store, { virtual: false });

  // Now require express and assemble the app. We cannot `require("../../server/index.js")`
  // directly because it starts listening on a port; we replay the relevant setup here.
  const express = require("express");
  const cors = require("cors");
  const cookieParser = require("cookie-parser");
  const helmet = require("helmet");
  const config = require(path.resolve(__dirname, "../../server/config"));
  const { errorHandler, notFoundHandler } = require(path.resolve(__dirname, "../../server/middleware/errorHandler"));
  const { apiLimiter, authLimiter, aiLimiter, uploadLimiter, voiceLimiter, mediaReadLimiter } =
    require(path.resolve(__dirname, "../../server/middleware/rateLimit"));
  const authRoutes = require(path.resolve(__dirname, "../../server/modules/auth/auth.routes"));
  const pairingRoutes = require(path.resolve(__dirname, "../../server/modules/auth/pairing.routes"));
  const pushRoutes = require(path.resolve(__dirname, "../../server/modules/push/push.routes"));
  const usersRoutes = require(path.resolve(__dirname, "../../server/modules/users/users.routes"));
  const chatsRoutes = require(path.resolve(__dirname, "../../server/modules/chats/chats.routes"));
  const messagesRoutes = require(path.resolve(__dirname, "../../server/modules/messages/messages.routes"));
  const translationRoutes = require(path.resolve(__dirname, "../../server/modules/translation/translation.routes"));
  const voiceRoutes = require(path.resolve(__dirname, "../../server/modules/voice/voice.routes"));
  const mediaRoutes = require(path.resolve(__dirname, "../../server/modules/media/media.routes"));
  const searchRoutes = require(path.resolve(__dirname, "../../server/modules/search/search.routes"));
  const contactsRoutes = require(path.resolve(__dirname, "../../server/modules/contacts/contacts.routes"));
  const adminRoutes = require(path.resolve(__dirname, "../../server/modules/admin/admin.routes"));
  const aiRoutes = require(path.resolve(__dirname, "../../server/modules/ai/ai.routes"));

  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: config.client.url, credentials: true }));
  app.use(express.json({ limit: "30mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: "test" });
  });

  // Mount with the real rate limiters. In tests we generally stay well below the
  // per-minute limits, and any test that hammers a route can be isolated.
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/auth/pairing", authLimiter, pairingRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api/users", apiLimiter, usersRoutes);
  app.use("/api/chats", apiLimiter, chatsRoutes);
  app.use("/api", apiLimiter, messagesRoutes);
  app.use("/api/translate", aiLimiter, translationRoutes);
  app.use("/api/voice", mediaReadLimiter, voiceRoutes);
  app.use("/api/media", mediaReadLimiter, mediaRoutes);
  app.use("/api/search", apiLimiter, searchRoutes);
  app.use("/api/contacts", apiLimiter, contactsRoutes);
  app.use("/api/admin", apiLimiter, adminRoutes);
  app.use("/api/ai", aiLimiter, aiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, store };
}

module.exports = { buildApp, createMemoryStore };
