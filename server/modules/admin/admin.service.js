const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

class AdminService {
  async _requireAdmin(chatId, userId) {
    const m = await store.findChatMember(chatId, userId);
    if (!m) throw ApiError.forbidden("Not a member");
    if (m.role !== "owner" && m.role !== "admin") throw ApiError.forbidden("Admin privileges required");
    return m;
  }

  async promoteMember(chatId, adminId, targetUserId) {
    await this._requireAdmin(chatId, adminId);
    const target = await store.findChatMember(chatId, targetUserId);
    if (!target) throw ApiError.notFound("Member");
    if (target.role === "owner") throw ApiError.badRequest("Cannot change owner role");
    return store.updateChatMember(chatId, targetUserId, { role: "admin" });
  }

  async demoteMember(chatId, adminId, targetUserId) {
    await this._requireAdmin(chatId, adminId);
    const target = await store.findChatMember(chatId, targetUserId);
    if (!target) throw ApiError.notFound("Member");
    if (target.role === "owner") throw ApiError.badRequest("Cannot demote owner");
    return store.updateChatMember(chatId, targetUserId, { role: "member" });
  }

  async muteMember(chatId, adminId, targetUserId) {
    await this._requireAdmin(chatId, adminId);
    const target = await store.findChatMember(chatId, targetUserId);
    if (!target) throw ApiError.notFound("Member");
    return store.updateChatMember(chatId, targetUserId, { muted: true });
  }

  async unmuteMember(chatId, adminId, targetUserId) {
    await this._requireAdmin(chatId, adminId);
    return store.updateChatMember(chatId, targetUserId, { muted: false });
  }

  async kickMember(chatId, adminId, targetUserId) {
    await this._requireAdmin(chatId, adminId);
    const target = await store.findChatMember(chatId, targetUserId);
    if (!target) throw ApiError.notFound("Member");
    if (target.role === "owner") throw ApiError.badRequest("Cannot kick the owner");
    if (targetUserId === adminId) throw ApiError.badRequest("Cannot kick yourself");
    return store.removeChatMember(chatId, targetUserId);
  }

  async deleteMessage(chatId, adminId, messageId) {
    await this._requireAdmin(chatId, adminId);
    const msg = await store.findMessageById(messageId);
    if (!msg || msg.chatId !== chatId) throw ApiError.notFound("Message");
    await store.softDeleteMessage(messageId, "[Message deleted by admin]");
    return { messageId, deleted: true };
  }
}

module.exports = new AdminService();
