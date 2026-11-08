const messagesService = require("./messages.service");
const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");
const translationService = require("../translation/translation.service");

const { sendToUser, broadcastToChat } = require("../../ws/socketServer");

const messagesController = {
  async sendMessage(req, res, next) {
    try {
      const { chatId } = req.params;
      // Block enforcement for direct chats
      const chat = await store.findChatById(chatId);
      if (chat && chat.type === "direct") {
        const members = await store.getChatMembers(chatId);
        const other = members.find((m) => m.userId !== req.userId);
        if (other) {
          const blocked = await store.isBlockedEitherWay(req.userId, other.userId);
          if (blocked) throw ApiError.forbidden("Cannot send message — blocked relationship");
        }
      }
      const { content, type, metadata, replyToId } = req.body;
      const message = await messagesService.sendMessage(chatId, req.userId, { content, type, metadata, replyToId });
      res.status(201).json({ status: "success", data: { message } });
    } catch (err) { next(err); }
  },

  async listMessages(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const before = req.query.before || undefined;
      const messages = await messagesService.listMessages(req.params.chatId, req.userId, { limit, before });
      res.json({ status: "success", data: { messages } });
    } catch (err) { next(err); }
  },

  async markSeen(req, res, next) {
    try {
      const result = await messagesService.markMessageSeen(req.params.messageId, req.userId);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async markAllSeen(req, res, next) {
    try {
      const ids = await messagesService.markAllSeen(req.params.chatId, req.userId);
      res.json({ status: "success", data: { markedSeen: ids.length } });
    } catch (err) { next(err); }
  },

  /**
   * DELETE /messages/:messageId
   * Soft-delete a message. Allowed for:
   *   - the sender (own message)
   *   - a chat admin/owner (any message in their chat)
   */
  /**
   * POST /api/messages/:messageId/hide
   * "Delete for me" — hides the message from the caller's view only.
   */
  async hideMessageForMe(req, res, next) {
    try {
      const result = await messagesService.hideMessageForMe(req.params.messageId, req.userId);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async deleteMessage(req, res, next) {
    try {
      const result = await messagesService.deleteMessage(req.params.messageId, req.userId);
      // Notify every member (sender too, for their other devices) once the soft-delete persisted.
      if (result.deletedAt) {
        const { chatId, messageId, deletedAt } = result;
        broadcastToChat(chatId, null, "message:deleted", { chatId, messageId, deletedAt }).catch(() => {});
      }
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  // ─── Feature A: Starred Messages ───

  async starMessage(req, res, next) {
    try {
      const result = await messagesService.starMessage(req.params.messageId, req.userId);
      // Notify only caller's sessions (star is per-user)
      try { sendToUser(req.userId, "message:starred", { messageId: req.params.messageId, starred: true }); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async unstarMessage(req, res, next) {
    try {
      const result = await messagesService.unstarMessage(req.params.messageId, req.userId);
      try { sendToUser(req.userId, "message:starred", { messageId: req.params.messageId, starred: false }); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async getStarredMessages(req, res, next) {
    try {
      const chatId = req.query.chatId || null;
      const messages = await messagesService.getStarredMessages(req.userId, chatId);
      res.json({ status: "success", data: { messages } });
    } catch (err) { next(err); }
  },

  // ─── Feature B: Pinned Messages ───

  async pinMessage(req, res, next) {
    try {
      const { chatId } = req.params;
      const { messageId } = req.body;
      if (!messageId) return res.status(400).json({ status: "error", message: "messageId required" });
      const result = await messagesService.pinMessage(chatId, messageId, req.userId);
      // Broadcast to all chat members
      try { broadcastToChat(chatId, null, "message:pinned", result); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async unpinMessage(req, res, next) {
    try {
      const { chatId, messageId } = req.params;
      const result = await messagesService.unpinMessage(chatId, messageId, req.userId);
      try { broadcastToChat(chatId, null, "message:unpinned", result); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async getPinnedMessages(req, res, next) {
    try {
      const { chatId } = req.params;
      const pins = await messagesService.getPinnedMessages(chatId, req.userId);
      res.json({ status: "success", data: { pins } });
    } catch (err) { next(err); }
  },

  // ─── Feature C: Edit Message ───

  async editMessage(req, res, next) {
    try {
      const { messageId } = req.params;
      const { content } = req.body;
      const updated = await messagesService.editMessage(messageId, req.userId, content);
      const chatId = updated.chatId;
      // Broadcast edit to all chat members — include chatId so client handler can route it
      try { broadcastToChat(chatId, null, "message:edited", { messageId, content: updated.content, editedAt: updated.editedAt, chatId }); } catch (_) {}
      // Regenerate translations for recipients who have autoTranslate=true
      try {
        const sender = await store.findUserById(req.userId);
        const senderLang = sender?.primaryLang || "en";
        const recipientTranslations = await translationService.translateForRecipients(
          messageId, updated.content, senderLang, chatId, req.userId
        );
        // Push per-recipient translation update so stale translation is replaced immediately
        for (const [uid, translation] of Object.entries(recipientTranslations)) {
          sendToUser(uid, "message:translation-updated", { messageId, chatId, translation });
        }
      } catch (_) {}
      res.json({ status: "success", data: { message: updated } });
    } catch (err) { next(err); }
  },

  // ─── Feature E: Bulk Actions ───

  async bulkAction(req, res, next) {
    try {
      const { messageIds, action } = req.body;
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ status: "error", message: "messageIds array required" });
      }
      if (!action) return res.status(400).json({ status: "error", message: "action required" });
      const result = await messagesService.bulkAction(messageIds, req.userId, action);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  // ─── Feature F: Clear Chat ───

  async clearChat(req, res, next) {
    try {
      const { chatId } = req.params;
      const result = await messagesService.clearChat(chatId, req.userId);
      try { sendToUser(req.userId, "chat:cleared", { chatId }); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  // ─── Feature G: Delete Chat ───

  async deleteLocalChat(req, res, next) {
    try {
      const { chatId } = req.params;
      const result = await messagesService.deleteLocalChat(chatId, req.userId);
      try { sendToUser(req.userId, "chat:deleted-local", { chatId }); } catch (_) {}
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },
};

module.exports = messagesController;
