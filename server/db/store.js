const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

/**
 * Data store backed by PostgreSQL via Prisma.
 * Every method signature and return shape matches the previous in-memory store
 * so no other files need changes.
 */

const store = {
  // Expose prisma instance for transactions / raw queries if needed
  prisma,

  // ─────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────

  async createUser(data) {
    const user = await prisma.user.create({
      data: {
        email: data.email ? data.email.toLowerCase().trim() : null,
        phoneNumber: data.phoneNumber || null,
        passwordHash: data.passwordHash,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl || null,
        bio: data.bio || "",
        role: data.role || "user",
        status: "offline",
        primaryLang: data.primaryLang || "en",
      },
    });
    return sanitizeUser(user);
  },

  async findUserByEmail(email) {
    if (!email) return null;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    return user ? { ...user } : null;
  },

  async findUserById(id) {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? sanitizeUser(user) : null;
  },

  async findUserByEmailWithPassword(email) {
    if (!email) return null;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    return user ? { ...user } : null;
  },

  async findUserByPhone(phone) {
    if (!phone) return null;
    const user = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    return user ? sanitizeUser(user) : null;
  },

  async findUserByPhoneWithPassword(phone) {
    if (!phone) return null;
    const user = await prisma.user.findUnique({
      where: { phoneNumber: phone },
    });
    return user ? { ...user } : null;
  },

  async updateUser(id, data) {
    try {
      // Remove protected fields
      const { id: _, email: __, passwordHash: ___, ...safe } = data;
      const user = await prisma.user.update({ where: { id }, data: safe });
      return sanitizeUser(user);
    } catch {
      return null;
    }
  },

  /**
   * Dedicated password-update method. Bypasses the safe-field filter in
   * updateUser() because the auth service needs to write a new hash.
   */
  async updateUserPassword(id, passwordHash) {
    try {
      const user = await prisma.user.update({
        where: { id },
        data: { passwordHash },
      });
      return sanitizeUser(user);
    } catch {
      return null;
    }
  },

  async updateUserStatus(id, status) {
    try {
      const user = await prisma.user.update({
        where: { id },
        data: { status, lastSeenAt: new Date() },
      });
      return sanitizeUser(user);
    } catch {
      return null;
    }
  },

  async listUsers({ excludeId, limit = 50, offset = 0 } = {}) {
    const users = await prisma.user.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      orderBy: { displayName: "asc" },
      take: limit,
      skip: offset,
    });
    return users.map(sanitizeUser);
  },

  async searchUsers(query, excludeId) {
    const q = query.toLowerCase().trim();
    // Normalize query for phone matching (strip non-digits)
    const phoneQuery = q.replace(/[^\d]/g, "");
    const orConditions = [
      { displayName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
    // If the query looks like a phone number (≥4 digits), also search by phone
    if (phoneQuery.length >= 4) {
      orConditions.push({ phoneNumber: { contains: phoneQuery } });
    }
    const users = await prisma.user.findMany({
      where: {
        AND: [
          excludeId ? { id: { not: excludeId } } : {},
          { OR: orConditions },
        ],
      },
    });
    return users.map(sanitizeUser);
  },

  // ─────────────────────────────────────────────
  // Chats
  // ─────────────────────────────────────────────

  async createChat(data) {
    const chat = await prisma.chat.create({
      data: {
        type: data.type || "direct",
        name: data.name || null,
        description: data.description || null,
        avatarUrl: data.avatarUrl || null,
        createdBy: data.createdBy || null,
      },
    });
    return { ...chat };
  },

  async findChatById(id) {
    const chat = await prisma.chat.findUnique({ where: { id } });
    return chat ? { ...chat } : null;
  },

  async updateChat(id, data) {
    try {
      const chat = await prisma.chat.update({ where: { id }, data });
      return { ...chat };
    } catch {
      return null;
    }
  },

  async findDirectChat(userIdA, userIdB) {
    // Find a direct chat where both users are members and no one else
    const chats = await prisma.chat.findMany({
      where: {
        type: "direct",
        members: { every: { userId: { in: [userIdA, userIdB] } } },
      },
      include: { members: true },
    });

    for (const chat of chats) {
      const memberIds = chat.members.map((m) => m.userId);
      if (
        memberIds.length === 2 &&
        memberIds.includes(userIdA) &&
        memberIds.includes(userIdB)
      ) {
        const { members, ...rest } = chat;
        return { ...rest };
      }
    }
    return null;
  },

  async listUserChats(userId, { includeArchived = false } = {}) {
    // Per-user "Delete for me": the sidebar preview (lastMessage) must never
    // show a message this user has hidden.
    const hiddenIds = await store.getHiddenMessageIds(userId);
    const now = new Date();
    const membershipWhere = {
      userId,
      hiddenAt: null,  // Feature G: exclude chats user has deleted locally
      // Pack A: exclude archived chats unless explicitly requesting them
      ...(includeArchived ? {} : { archivedAt: null }),
    };
    const memberships = await prisma.chatMember.findMany({
      where: membershipWhere,
      include: {
        chat: {
          include: {
            members: { include: { user: true } },
            messages: {
              where: {
                deletedAt: null,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
              },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { sender: true },
            },
          },
        },
      },
    });

    // Unread = visible messages from others newer than this user's lastReadAt
    // (or clearedAt, whichever is later). A failure here must not hide the chat list.
    const unreadByChat = new Map();
    if (memberships.length) {
      try {
        for (const m of memberships) {
  const cutoff = m.clearedAt && m.clearedAt > (m.lastReadAt ?? new Date(0))
    ? m.clearedAt
    : (m.lastReadAt ?? new Date(0));
  const count = await prisma.message.count({
    where: {
      chatId: m.chatId,
      senderId: { not: userId },
      deletedAt: null,
      createdAt: { gt: cutoff },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
    },
  });
  if (count > 0) unreadByChat.set(m.chatId, count);
}
      } catch (err) {
        console.error("[store] unread count failed:", err.message);
      }
    }

    const results = memberships.map((membership) => {
      const chat = membership.chat;
      const lastMessage = chat.messages[0] || null;
      const unreadCount = unreadByChat.get(chat.id) || 0;

      const members = chat.members.map((m) => ({
        id: m.id,
        chatId: m.chatId,
        userId: m.userId,
        role: m.role,
        receiveLang: m.receiveLang,
        autoTranslate: m.autoTranslate,
        muted: m.muted,
        lastReadAt: m.lastReadAt?.toISOString() || null,
        joinedAt: m.joinedAt?.toISOString() || null,
        // Pack A+B: expose archive/favorite state
        archivedAt: m.archivedAt?.toISOString() || null,
        favoritedAt: m.favoritedAt?.toISOString() || null,
        user: m.user ? sanitizeUser(m.user) : null,
      }));

      return {
        id: chat.id,
        type: chat.type,
        name: chat.name,
        description: chat.description,
        avatarUrl: chat.avatarUrl,
        createdBy: chat.createdBy,
        disappearingTimer: chat.disappearingTimer ?? null,
        createdAt: chat.createdAt?.toISOString(),
        updatedAt: chat.updatedAt?.toISOString(),
        members,
        // Fix C: expose the requesting user's archive state at top level for easy client filtering
        myArchivedAt: membership.archivedAt?.toISOString() || null,
        lastMessage: lastMessage
          ? {
              ...lastMessage,
              createdAt: lastMessage.createdAt?.toISOString(),
              sender: lastMessage.sender ? sanitizeUser(lastMessage.sender) : null,
            }
          : null,
        unreadCount,
      };
    });

    // Sort by latest activity
    results.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt || a.createdAt;
      const bTime = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bTime) - new Date(aTime);
    });

    return results;
  },

  // ─────────────────────────────────────────────
  // Chat Members
  // ─────────────────────────────────────────────

  async addChatMember(data) {
    const member = await prisma.chatMember.create({
      data: {
        chatId: data.chatId,
        userId: data.userId,
        role: data.role || "member",
        receiveLang: data.receiveLang || null,
        autoTranslate: data.autoTranslate !== false,
        muted: false,
      },
    });
    return { ...member };
  },

  async findChatMember(chatId, userId) {
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    return member ? { ...member } : null;
  },

  async getChatMembers(chatId) {
    const members = await prisma.chatMember.findMany({
      where: { chatId },
      include: { user: true },
    });
    return members.map((m) => ({
      ...m,
      user: m.user ? sanitizeUser(m.user) : null,
    }));
  },

  async updateChatMember(chatId, userId, data) {
    try {
      const member = await prisma.chatMember.update({
        where: { chatId_userId: { chatId, userId } },
        data,
      });
      return { ...member };
    } catch {
      return null;
    }
  },

  async removeChatMember(chatId, userId) {
    try {
      await prisma.chatMember.delete({
        where: { chatId_userId: { chatId, userId } },
      });
      return true;
    } catch {
      return false;
    }
  },

  async getEffectiveReceiveLang(chatId, userId) {
    const member = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      include: { user: true },
    });
    if (member?.receiveLang) return member.receiveLang;
    return member?.user?.primaryLang || "en";
  },

  // ─────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────

  async createMessage(data) {
    // Pack E: Disappearing messages — compute expiresAt if chat has a timer
    let expiresAt = data.expiresAt || null;
    if (!expiresAt && data.chatId) {
      try {
        const chat = await prisma.chat.findUnique({ where: { id: data.chatId }, select: { disappearingTimer: true } });
        if (chat?.disappearingTimer) {
          expiresAt = new Date(Date.now() + chat.disappearingTimer * 1000);
        }
      } catch { /* ignore — non-critical */ }
    }

    const message = await prisma.message.create({
      data: {
        chatId: data.chatId,
        senderId: data.senderId,
        type: data.type || "text",
        content: data.content || "",
        metadata: data.metadata || {},
        replyToId: data.replyToId || null,
        expiresAt: expiresAt || null,
      },
    });

    // Update chat's updatedAt
    await prisma.chat.update({
      where: { id: data.chatId },
      data: { updatedAt: new Date() },
    }).catch(() => {});

    return { ...message, metadata: message.metadata || {} };
  },

  async findMessageById(id) {
    const msg = await prisma.message.findUnique({ where: { id } });
    return msg ? { ...msg, metadata: msg.metadata || {} } : null;
  },

  /**
   * Merge fields into a message's JSON metadata column.
   * Used by voice pipeline to update sttStatus / translationStatus after the
   * initial message row has been saved.
   */
  async updateMessageMetadata(messageId, metadataPatch) {
    try {
      const msg = await prisma.message.findUnique({ where: { id: messageId } });
      if (!msg) return null;
      const merged = { ...(msg.metadata || {}), ...metadataPatch };
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { metadata: merged },
      });
      return { ...updated, metadata: updated.metadata || {} };
    } catch (err) {
      console.error("[store] updateMessageMetadata failed:", err.message);
      return null;
    }
  },

  async listMessages(chatId, { limit = 50, before, forUserId } = {}) {
    // Per-user "Delete for me": when forUserId is given, exclude messages that
    // user has hidden. Other users' views are unaffected.
    const hiddenIds = forUserId ? await store.getHiddenMessageIds(forUserId, chatId) : [];

    // Feature F: Clear Chat — messages before clearedAt are hidden for this user
    let clearedAt = null;
    if (forUserId) {
      try {
        const member = await prisma.chatMember.findUnique({
          where: { chatId_userId: { chatId, userId: forUserId } },
          select: { clearedAt: true },
        });
        clearedAt = member?.clearedAt || null;
      } catch { /* ignore */ }
    }

    const now = new Date();
    const messages = await prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        // Pack E: exclude expired messages
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    // Return in chronological order
    return messages.reverse().map((m) => ({ ...m, metadata: m.metadata || {} }));
  },

  async searchMessages(chatId, query, { forUserId } = {}) {
    const q = (query || "").trim();
    if (!q) return [];
    const hiddenIds = forUserId ? await store.getHiddenMessageIds(forUserId, chatId) : [];
    const hiddenSet = new Set(hiddenIds);

    // Feature F: Clear Chat — exclude messages before clearedAt
    // Also resolve the user's effective receive language for translation search
    let clearedAt = null;
    let receiveLang = null;
    if (forUserId) {
      try {
        const member = await prisma.chatMember.findUnique({
          where: { chatId_userId: { chatId, userId: forUserId } },
          select: { clearedAt: true, receiveLang: true, user: { select: { primaryLang: true } } },
        });
        clearedAt = member?.clearedAt || null;
        receiveLang = member?.receiveLang || member?.user?.primaryLang || "en";
      } catch { /* ignore */ }
    }

    // E8 — Try tsvector full-text search first (GIN-indexed, fast).
    // Falls back to ILIKE in two cases:
    //   1. SQL error (search_vector column missing — un-migrated DB)
    //   2. Zero FTS results — search_vector column exists but is NULL/unpopulated
    //      (prisma db push creates the column but does NOT run the trigger/backfill SQL)
    // In both cases the ILIKE fallback applies the same safety filters.
    const nowSearch = new Date();
    const ilikeFallback = () => prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        // Pack E: exclude expired messages from search
        OR: [{ expiresAt: null }, { expiresAt: { gt: nowSearch } }],
        ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
        content: { contains: q, mode: "insensitive" },
        ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }).then((msgs) => msgs.map((m) => ({ ...m, metadata: m.metadata || {} })));

    // Translation-aware search: find messages whose TRANSLATED text (for this user's
    // receiveLang) matches the query. Returns original message records tagged with
    // matchedText (the translated snippet) and matchSource="translation".
    // Scoped to same chatId + same safety filters. receiveLang is per-user private.
    const translationSearch = async () => {
      if (!forUserId || !receiveLang) return [];
      try {
        const translationHits = await prisma.translation.findMany({
          where: {
            targetLang: receiveLang,
            translatedText: { contains: q, mode: "insensitive" },
            message: {
              chatId,
              deletedAt: null,
              ...(hiddenIds.length ? { id: { notIn: hiddenIds } } : {}),
              ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
            },
          },
          select: { messageId: true, translatedText: true },
          take: 100,
        });
        if (translationHits.length === 0) return [];
        // Build messageId → translatedText map for display
        const translatedTextMap = new Map(translationHits.map((t) => [t.messageId, t.translatedText]));
        const msgIds = [...translatedTextMap.keys()];
        const msgs = await prisma.message.findMany({
          where: { id: { in: msgIds } },
          orderBy: { createdAt: "desc" },
        });
        return msgs.map((m) => ({
          ...m,
          metadata: m.metadata || {},
          matchedText: translatedTextMap.get(m.id),
          matchSource: "translation",
        }));
      } catch {
        return [];
      }
    };

    // Merge original-content results with translation results.
    // Deduplication: if a message matches both original AND translation, prefer
    // whichever text variant the user actually searched — we check which one
    // contains the query and set matchedText/matchSource accordingly.
    // Original results get matchSource="original", matchedText=content.
    const mergeResults = (originals, translationMatches) => {
      // Tag original results
      const taggedOriginals = originals.map((m) => ({
        ...m,
        matchedText: m.content,
        matchSource: "original",
      }));
      const seen = new Map(taggedOriginals.map((m) => [m.id, m]));
      for (const m of translationMatches) {
        if (!seen.has(m.id)) {
          // Translation-only hit — show translated text
          seen.set(m.id, m);
        } else {
          // Both match — keep the variant that contains the query; prefer translation
          // if query appears in translated text (user typed in their language)
          const existing = seen.get(m.id);
          const qLower = q.toLowerCase();
          if (m.matchedText?.toLowerCase().includes(qLower)) {
            seen.set(m.id, { ...existing, matchedText: m.matchedText, matchSource: "translation" });
          }
          // else: original text already matched, keep matchSource="original"
        }
      }
      const merged = [...seen.values()];
      merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return merged.slice(0, 100);
    };

    let originalResults;
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT id, chat_id AS "chatId", sender_id AS "senderId", type,
               content, metadata, reply_to_id AS "replyToId",
               edited_at AS "editedAt", deleted_at AS "deletedAt",
               created_at AS "createdAt"
        FROM messages
        WHERE chat_id = $1::uuid
          AND deleted_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          ${clearedAt ? `AND created_at > '${clearedAt.toISOString()}'` : ''}
          AND search_vector @@ plainto_tsquery('simple', $2)
        ORDER BY ts_rank(search_vector, plainto_tsquery('simple', $2)) DESC,
                 created_at DESC
        LIMIT 100
      `, chatId, q);
      const filtered = rows.filter((m) => !hiddenSet.has(m.id)).map((m) => ({ ...m, metadata: m.metadata || {} }));
      // If FTS returned nothing, search_vector may be unpopulated — run ILIKE fallback
      originalResults = filtered.length === 0 ? await ilikeFallback() : filtered;
    } catch {
      // SQL error (column missing or query failed) — run ILIKE fallback
      originalResults = await ilikeFallback();
    }

    // Merge with translation matches
    const translationResults = await translationSearch();
    return mergeResults(originalResults, translationResults);
  },

  // ─────────────────────────────────────────────
  // Per-user "Delete for me"
  // ─────────────────────────────────────────────

  /**
   * Hide one message from ONE user's view. Idempotent. Errors propagate
   * (a failed hide must never look like success).
   */
  async hideMessageForUser(messageId, userId) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO hidden_messages (id, message_id, user_id)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid)
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      messageId, userId
    );
    return true;
  },

  /**
   * IDs of messages the user has hidden (optionally limited to one chat).
   * READ path: on any failure (e.g. table not migrated yet) returns [] so
   * message listing keeps working instead of breaking.
   */
  async getHiddenMessageIds(userId, chatId) {
    try {
      const rows = chatId
        ? await prisma.$queryRawUnsafe(
            `SELECT h.message_id AS "messageId" FROM hidden_messages h
             JOIN messages m ON m.id = h.message_id
             WHERE h.user_id = $1::uuid AND m.chat_id = $2::uuid`,
            userId, chatId)
        : await prisma.$queryRawUnsafe(
            `SELECT message_id AS "messageId" FROM hidden_messages WHERE user_id = $1::uuid`,
            userId);
      return rows.map((r) => r.messageId);
    } catch (err) {
      console.error("[hidden_messages] lookup failed (is the table migrated?):", err.message);
      return [];
    }
  },

  /**
   * Soft-delete a message (used by admin).
   */
  async softDeleteMessage(messageId, replacementContent) {
    try {
      const msg = await prisma.message.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          content: replacementContent || "[Message deleted by admin]",
        },
      });
      return { ...msg };
    } catch {
      return null;
    }
  },

  /**
   * Messages deleted for everyone after `since`, in chats the user belongs to
   * (archived ones included: their messages may be loaded on the client). Newest first.
   */
  async listDeletedMessagesSince(userId, since, { chatIds, limit = 500 } = {}) {
    try {
      return await prisma.message.findMany({
        where: {
          deletedAt: { gt: since },
          chat: { members: { some: { userId } } },
          ...(chatIds?.length ? { chatId: { in: chatIds } } : {}),
        },
        select: { id: true, chatId: true, deletedAt: true },
        orderBy: { deletedAt: "desc" },
        take: limit,
      });
    } catch (err) {
      console.error("[store] listDeletedMessagesSince failed:", err.message);
      return [];
    }
  },

  // ─────────────────────────────────────────────
  // Message Receipts
  // ─────────────────────────────────────────────

  async upsertReceipt(messageId, userId, status) {
    const receipt = await prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: { status },
      create: { messageId, userId, status },
    });
    return { ...receipt };
  },

  async getMessageReceipts(messageId) {
    return prisma.messageReceipt.findMany({ where: { messageId } });
  },

  // ─────────────────────────────────────────────
  // Translations
  // ─────────────────────────────────────────────

  async createTranslation(data) {
    const translation = await prisma.translation.create({
      data: {
        messageId: data.messageId,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        translatedText: data.translatedText,
      },
    });
    return { ...translation };
  },

  /**
   * Upsert a translation row. Used by retranslate / source-lang override so
   * the stored value is always the most recent result.
   */
  async upsertTranslation(data) {
    const translation = await prisma.translation.upsert({
      where: { messageId_targetLang: { messageId: data.messageId, targetLang: data.targetLang } },
      update: { translatedText: data.translatedText, sourceLang: data.sourceLang },
      create: {
        messageId: data.messageId,
        sourceLang: data.sourceLang,
        targetLang: data.targetLang,
        translatedText: data.translatedText,
      },
    });
    return { ...translation };
  },

  async findTranslation(messageId, targetLang) {
    const t = await prisma.translation.findUnique({
      where: { messageId_targetLang: { messageId, targetLang } },
    });
    return t ? { ...t } : null;
  },

  async getMessageTranslations(messageId) {
    return prisma.translation.findMany({ where: { messageId } });
  },

  // ─────────────────────────────────────────────
  // Refresh Tokens
  // ─────────────────────────────────────────────

  async storeRefreshToken(data) {
    const token = await prisma.refreshToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: new Date(data.expiresAt),
        revoked: false,
      },
    });
    return { ...token };
  },

  async findRefreshToken(tokenHash) {
    const t = await prisma.refreshToken.findFirst({
      where: { tokenHash, revoked: false },
    });
    return t ? { ...t } : null;
  },

  async revokeRefreshToken(tokenHash) {
    try {
      await prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { revoked: true },
      });
      return true;
    } catch {
      return false;
    }
  },

  async revokeAllUserRefreshTokens(userId) {
    await prisma.refreshToken.updateMany({
      where: { userId },
      data: { revoked: true },
    });
  },

  // ─────────────────────────────────────────────
  // Password Reset Tokens
  // ─────────────────────────────────────────────

  async createPasswordResetToken(data) {
    const t = await prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: new Date(data.expiresAt),
      },
    });
    return { ...t };
  },

  async findPasswordResetTokenByHash(tokenHash) {
    const t = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    return t ? { ...t } : null;
  },

  async consumePasswordResetToken(tokenHash) {
    try {
      const t = await prisma.passwordResetToken.update({
        where: { tokenHash },
        data: { consumedAt: new Date() },
      });
      return { ...t };
    } catch {
      return null;
    }
  },

  async revokeUserPasswordResetTokens(userId) {
    // Mark all outstanding (unconsumed) reset tokens for the user as consumed
    // so that only the single most recent reset link can be used.
    await prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  },

  // ─────────────────────────────────────────────
  // Pairing Tokens (D8 — QR-based desktop login)
  // ─────────────────────────────────────────────

  async createPairingToken(data) {
    const t = await prisma.pairingToken.create({
      data: {
        code: data.code,
        nonceHash: data.nonceHash,
        deviceLabel: data.deviceLabel || null,
        expiresAt: new Date(data.expiresAt),
      },
    });
    return { ...t };
  },

  async findPairingTokenByCode(code) {
    const t = await prisma.pairingToken.findUnique({ where: { code } });
    return t ? { ...t } : null;
  },

  async approvePairingToken(code, userId) {
    try {
      const t = await prisma.pairingToken.update({
        where: { code },
        data: { status: "approved", approvedUserId: userId },
      });
      return { ...t };
    } catch {
      return null;
    }
  },

  async consumePairingToken(code) {
    try {
      const t = await prisma.pairingToken.update({
        where: { code },
        data: { status: "consumed", consumedAt: new Date() },
      });
      return { ...t };
    } catch {
      return null;
    }
  },

  // ─────────────────────────────────────────────
  // Push Subscriptions (E2 — Web Push notifications)
  // ─────────────────────────────────────────────

  async upsertPushSubscription({ userId, endpoint, p256dh, auth, userAgent }) {
    // Endpoint is the natural unique key — if the same device re-subscribes
    // (e.g. after reinstall), update the keys in place rather than fail.
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (existing) {
      const updated = await prisma.pushSubscription.update({
        where: { endpoint },
        data: { userId, p256dh, auth, userAgent: userAgent || null, lastSeenAt: new Date() },
      });
      return { ...updated };
    }
    const created = await prisma.pushSubscription.create({
      data: { userId, endpoint, p256dh, auth, userAgent: userAgent || null },
    });
    return { ...created };
  },

  async removePushSubscription(endpoint) {
    try {
      await prisma.pushSubscription.delete({ where: { endpoint } });
      return true;
    } catch {
      return false;
    }
  },

  async getPushSubscriptionsForUser(userId) {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    return subs.map((s) => ({ ...s }));
  },

  async touchPushSubscription(endpoint) {
    try {
      await prisma.pushSubscription.update({
        where: { endpoint },
        data: { lastSeenAt: new Date() },
      });
      return true;
    } catch {
      return false;
    }
  },

  // ─────────────────────────────────────────────
  // Block / Report (H)
  // Uses raw SQL because the Prisma client may not have these models
  // generated yet. Safe to call on any Postgres that has the schema.sql applied.
  // ─────────────────────────────────────────────

  async blockUser(blockerId, blockedId) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO blocked_users (id, blocker_id, blocked_id) VALUES (gen_random_uuid(), $1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
        blockerId, blockedId
      );
      return true;
    } catch { return false; }
  },

  async unblockUser(blockerId, blockedId) {
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM blocked_users WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`,
        blockerId, blockedId
      );
      return true;
    } catch { return false; }
  },

  async isBlocked(blockerId, blockedId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM blocked_users WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid LIMIT 1`,
        blockerId, blockedId
      );
      return rows.length > 0;
    } catch { return false; }
  },

  async isBlockedEitherWay(userA, userB) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM blocked_users WHERE (blocker_id = $1::uuid AND blocked_id = $2::uuid) OR (blocker_id = $2::uuid AND blocked_id = $1::uuid) LIMIT 1`,
        userA, userB
      );
      return rows.length > 0;
    } catch { return false; }
  },

  async getBlockedUserIds(userId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT blocked_id AS "blockedId" FROM blocked_users WHERE blocker_id = $1::uuid`,
        userId
      );
      return rows.map((r) => r.blockedId);
    } catch { return []; }
  },

  async createReport(reporterId, reportedId, reason) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO reports (id, reporter_id, reported_id, reason) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3)`,
        reporterId, reportedId, reason
      );
      return true;
    } catch { return false; }
  },

  // ─────────────────────────────────────────────
  // OTP Codes (SMS verification)
  // ─────────────────────────────────────────────

  async createOtp(phone, code, purpose, expiresAt) {
    try {
      // Invalidate any previous unused codes for same phone+purpose
      await prisma.$executeRawUnsafe(
        `UPDATE otp_codes SET consumed = TRUE WHERE phone = $1 AND purpose = $2 AND consumed = FALSE`,
        phone, purpose
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO otp_codes (id, phone, code, purpose, expires_at) VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        phone, code, purpose, new Date(expiresAt)
      );
      return true;
    } catch { return false; }
  },

  async verifyOtp(phone, code, purpose) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, code, attempts, max_attempts, consumed, expires_at AS "expiresAt"
         FROM otp_codes
         WHERE phone = $1 AND purpose = $2 AND consumed = FALSE
         ORDER BY created_at DESC LIMIT 1`,
        phone, purpose
      );
      if (!rows || rows.length === 0) return { valid: false, reason: "no_code" };
      const otp = rows[0];

      if (new Date(otp.expiresAt) < new Date()) return { valid: false, reason: "expired" };
      if (otp.attempts >= otp.max_attempts) return { valid: false, reason: "too_many_attempts" };

      if (otp.code !== code) {
        await prisma.$executeRawUnsafe(
          `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1::uuid`, otp.id
        );
        return { valid: false, reason: "wrong_code" };
      }

      // Mark consumed
      await prisma.$executeRawUnsafe(
        `UPDATE otp_codes SET consumed = TRUE WHERE id = $1::uuid`, otp.id
      );
      return { valid: true };
    } catch { return { valid: false, reason: "error" }; }
  },

  async countRecentOtps(phone, windowMs = 600000) {
    try {
      const since = new Date(Date.now() - windowMs);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS count FROM otp_codes WHERE phone = $1 AND created_at > $2`,
        phone, since
      );
      return rows?.[0]?.count || 0;
    } catch { return 0; }
  },

  // ─────────────────────────────────────────────
  // Contacts — bulk phone matching
  // ─────────────────────────────────────────────

  async findUsersByPhones(phones) {
    if (!phones || phones.length === 0) return [];
    try {
      // Use ANY($1::text[]) for efficient batch lookup
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, display_name AS "displayName", phone_number AS "phoneNumber",
                email, avatar_url AS "avatarUrl", bio, primary_lang AS "primaryLang",
                status, created_at AS "createdAt"
         FROM users
         WHERE phone_number = ANY($1::text[])`,
        phones
      );
      return rows || [];
    } catch { return []; }
  },

  // ─────────────────────────────────────────────
  // Starred Messages (Feature A)
  // ─────────────────────────────────────────────

  async starMessage(messageId, userId) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO starred_messages (id, message_id, user_id)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        messageId, userId
      );
      return true;
    } catch (err) {
      console.error("[starred_messages] starMessage failed:", err.message);
      throw err;
    }
  },

  async unstarMessage(messageId, userId) {
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM starred_messages WHERE message_id = $1::uuid AND user_id = $2::uuid`,
        messageId, userId
      );
      return true;
    } catch (err) {
      console.error("[starred_messages] unstarMessage failed:", err.message);
      throw err;
    }
  },

  async isStarred(messageId, userId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM starred_messages WHERE message_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        messageId, userId
      );
      return rows.length > 0;
    } catch { return false; }
  },

  async getStarredMessages(userId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT m.id, m.chat_id AS "chatId", m.sender_id AS "senderId", m.type,
                m.content, m.metadata, m.reply_to_id AS "replyToId",
                m.edited_at AS "editedAt", m.deleted_at AS "deletedAt",
                m.created_at AS "createdAt",
                sm.created_at AS "starredAt"
         FROM starred_messages sm
         JOIN messages m ON m.id = sm.message_id
         WHERE sm.user_id = $1::uuid
           AND m.deleted_at IS NULL
           AND (m.expires_at IS NULL OR m.expires_at > NOW())
         ORDER BY sm.created_at DESC`,
        userId
      );
      return rows.map((m) => ({ ...m, metadata: m.metadata || {} }));
    } catch (err) {
      console.error("[starred_messages] getStarredMessages failed:", err.message);
      return [];
    }
  },

  // ─────────────────────────────────────────────
  // Pinned Messages (Feature B)
  // ─────────────────────────────────────────────

  async pinMessage(chatId, messageId, pinnedBy) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO pinned_messages (id, chat_id, message_id, pinned_by)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid)
         ON CONFLICT (chat_id, message_id) DO NOTHING`,
        chatId, messageId, pinnedBy
      );
      return true;
    } catch (err) {
      console.error("[pinned_messages] pinMessage failed:", err.message);
      throw err;
    }
  },

  async unpinMessage(chatId, messageId) {
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM pinned_messages WHERE chat_id = $1::uuid AND message_id = $2::uuid`,
        chatId, messageId
      );
      return true;
    } catch (err) {
      console.error("[pinned_messages] unpinMessage failed:", err.message);
      throw err;
    }
  },

  async getPinnedMessages(chatId) {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT pm.id, pm.chat_id AS "chatId", pm.message_id AS "messageId",
                pm.pinned_by AS "pinnedBy", pm.pinned_at AS "pinnedAt",
                m.type AS "messageType", m.content AS "messageContent",
                m.sender_id AS "senderId", m.deleted_at AS "deletedAt",
                m.expires_at AS "expiresAt",
                m.metadata AS "messageMetadata"
         FROM pinned_messages pm
         JOIN messages m ON m.id = pm.message_id
         WHERE pm.chat_id = $1::uuid
           AND (m.expires_at IS NULL OR m.expires_at > NOW())
         ORDER BY pm.pinned_at DESC`,
        chatId
      );
      return rows || [];
    } catch (err) {
      console.error("[pinned_messages] getPinnedMessages failed:", err.message);
      return [];
    }
  },

  // ─────────────────────────────────────────────
  // Edit Message (Feature C)
  // ─────────────────────────────────────────────

  async editMessage(messageId, newContent) {
    const now = new Date();
    const msg = await prisma.message.update({
      where: { id: messageId },
      data: { content: newContent, editedAt: now },
    });
    return { ...msg, metadata: msg.metadata || {} };
  },

  async deleteTranslationsForMessage(messageId) {
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM translations WHERE message_id = $1::uuid`,
        messageId
      );
      return true;
    } catch (err) {
      console.error("[translations] deleteTranslationsForMessage failed:", err.message);
      return false;
    }
  },

  // ─────────────────────────────────────────────
  // Clear Chat (Feature F)
  // ─────────────────────────────────────────────

  /**
   * Records that the user cleared chat history as of now.
   * Uses chat_members.cleared_at timestamp. Messages sent before this time
   * are treated as hidden for this user. This avoids looping through all history.
   */
  async clearChatForUser(chatId, userId) {
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `UPDATE chat_members SET cleared_at = $1 WHERE chat_id = $2::uuid AND user_id = $3::uuid`,
      now, chatId, userId
    );
    return { clearedAt: now.toISOString() };
  },

  // ─────────────────────────────────────────────
  // Delete Chat / Hide Chat (Feature G)
  // ─────────────────────────────────────────────

  /**
   * Marks chat as hidden for this user by setting hidden_at.
   * The chat row and all memberships remain intact.
   * A new incoming message will clear hidden_at so the chat reappears.
   */
  async hideChatForUser(chatId, userId) {
    const now = new Date();
    await prisma.$executeRawUnsafe(
      `UPDATE chat_members SET hidden_at = $1 WHERE chat_id = $2::uuid AND user_id = $3::uuid`,
      now, chatId, userId
    );
    return { hiddenAt: now.toISOString() };
  },

  /**
   * Reveal a hidden chat for user (called when a new message arrives for them).
   */
  async unhideChatForUser(chatId, userId) {
    await prisma.$executeRawUnsafe(
      `UPDATE chat_members SET hidden_at = NULL, archived_at = NULL WHERE chat_id = $1::uuid AND user_id = $2::uuid`,
      chatId, userId
    );
    return true;
  },

  // ─────────────────────────────────────────────
  // Pack H: Self-chat (Saved Messages)
  // ─────────────────────────────────────────────

  /**
   * Find a self-chat for a user: a direct chat where the user is the only member
   * (type=direct, name="Saved Messages", created_by=userId).
   */
  async findSelfChat(userId) {
    try {
      const chats = await prisma.chat.findMany({
        where: { type: "direct", name: "Saved Messages", createdBy: userId },
        include: { members: true },
      });
      for (const chat of chats) {
        // Self-chat has exactly 1 member (the user themselves)
        if (chat.members.length === 1 && chat.members[0].userId === userId) {
          const { members, ...rest } = chat;
          return { ...rest };
        }
      }
      return null;
    } catch {
      return null;
    }
  },

  // ─────────────────────────────────────────────
  // Pack C: Custom Lists (ChatList / ChatListMember)
  // ─────────────────────────────────────────────

  async listChatLists(userId) {
    try {
      const lists = await prisma.chatList.findMany({
        where: { userId },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      });
      return lists.map((l) => ({ ...l, chatIds: l.items.map((i) => i.chatId) }));
    } catch {
      return [];
    }
  },

  async findChatList(listId, userId) {
    try {
      const list = await prisma.chatList.findFirst({ where: { id: listId, userId } });
      return list ? { ...list } : null;
    } catch {
      return null;
    }
  },

  async createChatList(userId, name) {
    const list = await prisma.chatList.create({ data: { userId, name } });
    return { ...list, chatIds: [] };
  },

  async updateChatList(listId, data) {
    try {
      const list = await prisma.chatList.update({ where: { id: listId }, data });
      return { ...list };
    } catch {
      return null;
    }
  },

  async deleteChatList(listId) {
    try {
      await prisma.chatList.delete({ where: { id: listId } });
      return true;
    } catch {
      return false;
    }
  },

  async addChatToList(listId, chatId) {
    try {
      await prisma.chatListMember.upsert({
        where: { listId_chatId: { listId, chatId } },
        update: {},
        create: { listId, chatId },
      });
      return true;
    } catch {
      return false;
    }
  },

  async removeChatFromList(listId, chatId) {
    try {
      await prisma.chatListMember.delete({ where: { listId_chatId: { listId, chatId } } });
      return true;
    } catch {
      return false;
    }
  },

  // ─────────────────────────────────────────────
  // Pack E: Disappearing Messages helpers
  // ─────────────────────────────────────────────

  /**
   * Get a chat's disappearing timer in seconds (null = off).
   */
  async getChatDisappearingTimer(chatId) {
    try {
      const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { disappearingTimer: true } });
      return chat?.disappearingTimer || null;
    } catch {
      return null;
    }
  },
};

// ─── Helpers ───

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  // Normalize dates to ISO strings for consistency with previous API
  if (safe.createdAt instanceof Date) safe.createdAt = safe.createdAt.toISOString();
  if (safe.updatedAt instanceof Date) safe.updatedAt = safe.updatedAt.toISOString();
  if (safe.lastSeenAt instanceof Date) safe.lastSeenAt = safe.lastSeenAt.toISOString();
  return safe;
}

module.exports = store;
