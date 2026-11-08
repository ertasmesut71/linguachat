const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

class SearchService {
  /**
   * Search messages within a specific chat.
   */
  async searchInChat(chatId, userId, query, { limit = 30 } = {}) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const results = await store.searchMessages(chatId, query, { forUserId: userId });
    const enriched = [];
    for (const msg of results.slice(0, limit)) {
      const sender = await store.findUserById(msg.senderId);
      enriched.push({ ...msg, sender });
    }
    return enriched;
  }

  /**
   * Search messages across ALL chats the user belongs to.
   */
  async searchGlobal(userId, query, { limit = 50 } = {}) {
    const userChats = await store.listUserChats(userId);
    const chatIds = userChats.map((c) => c.id);
    const all = [];
    for (const chatId of chatIds) {
      const msgs = await store.searchMessages(chatId, query, { forUserId: userId });
      for (const msg of msgs) {
        const sender = await store.findUserById(msg.senderId);
        const chat = await store.findChatById(msg.chatId);
        all.push({ ...msg, sender, chat });
      }
    }
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return all.slice(0, limit);
  }

  /**
   * Search users by name/email.
   */
  async searchUsers(userId, query) {
    return store.searchUsers(query, userId);
  }
}

module.exports = new SearchService();
