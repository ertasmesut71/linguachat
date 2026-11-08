const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");
const { sanitizeText } = require("../../utils/sanitize");

const MAX_MESSAGE_LENGTH = 10000;

class MessagesService {
  async sendMessage(chatId, senderId, { content, type = "text", metadata = {}, replyToId }) {
    const membership = await store.findChatMember(chatId, senderId);
    if (!membership) throw ApiError.forbidden("Not a member");

    // Sanitize content before storage
    const cleanContent = type === "text" ? sanitizeText(content, { maxLength: 10000 }) : sanitizeText(content, { maxLength: 50000 });
    if (type === "text" && !cleanContent) throw ApiError.badRequest("Empty message");

    const message = await store.createMessage({
      chatId, senderId, type, content: cleanContent, metadata, replyToId,
    });
    await store.upsertReceipt(message.id, senderId, "sent");
    const members = await store.getChatMembers(chatId);
    for (const m of members) {
      if (m.userId !== senderId) {
        await store.upsertReceipt(message.id, m.userId, "delivered");
        // Feature G: unhide chat for recipient if they had deleted it locally
        if (m.hiddenAt || m.archivedAt) {
          try { await store.unhideChatForUser(chatId, m.userId); } catch (_) {}
        }
      }
    }
    const sender = await store.findUserById(senderId);
    return { ...message, sender };
  }

  async listMessages(chatId, userId, { limit = 50, before } = {}) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const receiveLang = await store.getEffectiveReceiveLang(chatId, userId);
    // forUserId: hide messages this user removed with "Delete for me"
    const messages = await store.listMessages(chatId, { limit, before, forUserId: userId });
    const enriched = [];
    for (const msg of messages) {
      const sender = await store.findUserById(msg.senderId);
      let translation = null;
      if (msg.senderId !== userId) {
        translation = await store.findTranslation(msg.id, receiveLang);
      }
      enriched.push({
        ...msg, sender,
        translation: translation ? { translatedText: translation.translatedText, sourceLang: translation.sourceLang, targetLang: translation.targetLang } : null,
      });
    }
    return enriched;
  }

  /**
   * "Delete for me": hide a message from THIS user's view only.
   * Never touches the message itself, the sender's copy, or other members.
   * Allowed for any message in a chat the user belongs to (idempotent).
   */
  async hideMessageForMe(messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");
    const membership = await store.findChatMember(message.chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    try {
      await store.hideMessageForUser(messageId, userId);
    } catch (err) {
      if (/does not exist/i.test(err?.message || "")) {
        console.error("[hidden_messages] table missing — run `npx prisma db push`:", err.message);
        throw ApiError.unavailable("Delete-for-me is unavailable until the database migration is applied.");
      }
      throw err;
    }
    return { messageId, chatId: message.chatId, hidden: true };
  }

  async markMessageSeen(messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");
    const membership = await store.findChatMember(message.chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    await store.upsertReceipt(messageId, userId, "seen");
    await store.updateChatMember(message.chatId, userId, { lastReadAt: new Date().toISOString() });
    return { messageId, userId, status: "seen" };
  }

  async markAllSeen(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const messages = await store.listMessages(chatId, { limit: 200 });
    const ids = [];
    for (const msg of messages) {
      if (msg.senderId !== userId) { await store.upsertReceipt(msg.id, userId, "seen"); ids.push(msg.id); }
    }
    await store.updateChatMember(chatId, userId, { lastReadAt: new Date().toISOString() });
    return ids;
  }

  /**
   * Soft-delete a message. Allowed for:
   *   - the sender (own message)
   *   - a chat admin/owner (any message in their chat)
   * Does NOT physically destroy data — sets deletedAt + replaces content.
   */
  async deleteMessage(messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");

    const isSender = message.senderId === userId;

    if (!isSender) {
      // Check if the user is an admin/owner of the chat
      const membership = await store.findChatMember(message.chatId, userId);
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        throw ApiError.forbidden("You can only delete your own messages");
      }
    }

    const deleted = await store.softDeleteMessage(messageId, "This message was deleted");
    return { messageId, chatId: message.chatId, deleted: true, deletedAt: deleted?.deletedAt ?? null };
  }

  // ─── Feature A: Starred Messages ───

  async starMessage(messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");
    const membership = await store.findChatMember(message.chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    if (message.deletedAt) throw ApiError.badRequest("Cannot star a deleted message");
    await store.starMessage(messageId, userId);
    return { messageId, userId, starred: true };
  }

  async unstarMessage(messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");
    const membership = await store.findChatMember(message.chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    await store.unstarMessage(messageId, userId);
    return { messageId, userId, starred: false };
  }

  async getStarredMessages(userId, chatId) {
    let messages = await store.getStarredMessages(userId);
    // Filter to chatId if given
    if (chatId) messages = messages.filter((m) => m.chatId === chatId);
    // Enrich with sender
    const enriched = [];
    for (const msg of messages) {
      const sender = await store.findUserById(msg.senderId);
      enriched.push({ ...msg, sender });
    }
    return enriched;
  }

  // ─── Feature B: Pinned Messages ───

  async pinMessage(chatId, messageId, userId) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");
    if (message.chatId !== chatId) throw ApiError.badRequest("Message does not belong to this chat");

    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");

    const chat = await store.findChatById(chatId);
    if (chat && chat.type === "group") {
      if (membership.role !== "owner" && membership.role !== "admin") {
        throw ApiError.forbidden("Only admins and owners can pin messages in groups");
      }
    }

    await store.pinMessage(chatId, messageId, userId);
    return { chatId, messageId, pinnedBy: userId, pinned: true };
  }

  async unpinMessage(chatId, messageId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");

    const chat = await store.findChatById(chatId);
    if (chat && chat.type === "group") {
      if (membership.role !== "owner" && membership.role !== "admin") {
        throw ApiError.forbidden("Only admins and owners can unpin messages in groups");
      }
    }

    await store.unpinMessage(chatId, messageId);
    return { chatId, messageId, pinned: false };
  }

  async getPinnedMessages(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");

    const pins = await store.getPinnedMessages(chatId);

    // Filter out messages deleted or hidden for this user
    const hiddenIds = new Set(await store.getHiddenMessageIds(userId, chatId));
    return pins.filter((p) => {
      // Exclude if message was hard-deleted (deletedAt set)
      if (p.deletedAt) return false;
      // Exclude if message is hidden for this user (Delete-for-me safety)
      if (hiddenIds.has(p.messageId)) return false;
      return true;
    });
  }

  // ─── Feature C: Edit Message ───

  async editMessage(messageId, userId, newContent) {
    const message = await store.findMessageById(messageId);
    if (!message) throw ApiError.notFound("Message");

    if (message.senderId !== userId) throw ApiError.forbidden("You can only edit your own messages");
    if (message.type !== "text") throw ApiError.badRequest("Only text messages can be edited");
    if (message.deletedAt) throw ApiError.badRequest("Cannot edit a deleted message");

    const cleanContent = sanitizeText(newContent, { maxLength: MAX_MESSAGE_LENGTH });
    if (!cleanContent) throw ApiError.badRequest("Edited message cannot be empty");

    const updated = await store.editMessage(messageId, cleanContent);

    // Invalidate stale translations — edited content must not show old translation
    await store.deleteTranslationsForMessage(messageId);

    return updated;
  }

  // ─── Feature E: Bulk Actions ───

  async bulkAction(messageIds, userId, action) {
    const results = [];
    for (const messageId of messageIds) {
      try {
        if (action === "star") {
          await this.starMessage(messageId, userId);
          results.push({ messageId, success: true });
        } else if (action === "unstar") {
          await this.unstarMessage(messageId, userId);
          results.push({ messageId, success: true });
        } else if (action === "delete_for_me") {
          await this.hideMessageForMe(messageId, userId);
          results.push({ messageId, success: true });
        } else {
          results.push({ messageId, success: false, error: "Unknown action" });
        }
      } catch (err) {
        results.push({ messageId, success: false, error: err.message || "Failed" });
      }
    }

    const allSucceeded = results.every((r) => r.success);
    const anySucceeded = results.some((r) => r.success);
    return { results, allSucceeded, anySucceeded };
  }

  // ─── Feature F: Clear Chat ───

  async clearChat(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    return await store.clearChatForUser(chatId, userId);
  }

  // ─── Feature G: Delete Chat (user-local) ───

  async deleteLocalChat(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    // Mark chat as hidden for this user only — does not remove membership or chat
    await store.hideChatForUser(chatId, userId);
    return { chatId, hidden: true };
  }
}

module.exports = new MessagesService();
