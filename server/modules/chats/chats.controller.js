const chatsService = require("./chats.service");

const chatsController = {
  async createDirectChat(req, res, next) {
    try {
      const chat = await chatsService.findOrCreateDirectChat(req.userId, req.body.otherUserId);
      res.status(chat.isNew ? 201 : 200).json({ status: "success", data: { chat } });
    } catch (err) { next(err); }
  },

  async createGroupChat(req, res, next) {
    try {
      const { name, description, memberIds } = req.body;
      const chat = await chatsService.createGroupChat(req.userId, { name, description, memberIds });
      res.status(201).json({ status: "success", data: { chat } });
    } catch (err) { next(err); }
  },

  async addMember(req, res, next) {
    try {
      const members = await chatsService.addMember(req.params.id, req.userId, req.body.userId);
      res.json({ status: "success", data: { members } });
    } catch (err) { next(err); }
  },

  async removeMember(req, res, next) {
    try {
      const members = await chatsService.removeMember(req.params.id, req.userId, req.params.userId);
      res.json({ status: "success", data: { members } });
    } catch (err) { next(err); }
  },

  async listChats(req, res, next) {
    try {
      // Fix C: allow ?includeArchived=true to fetch archived chats
      const includeArchived = req.query.includeArchived === "true";
      res.json({ status: "success", data: { chats: await chatsService.listUserChats(req.userId, { includeArchived }) } });
    } catch (err) { next(err); }
  },

  async getChat(req, res, next) {
    try { res.json({ status: "success", data: { chat: await chatsService.getChatById(req.params.id, req.userId) } }); }
    catch (err) { next(err); }
  },

  async updateChat(req, res, next) {
    try { res.json({ status: "success", data: { chat: await chatsService.updateChat(req.params.id, req.userId, req.body) } }); }
    catch (err) { next(err); }
  },

  async updateMySettings(req, res, next) {
    try { res.json({ status: "success", data: { settings: await chatsService.updateMemberSettings(req.params.id, req.userId, req.body) } }); }
    catch (err) { next(err); }
  },

  async getMySettings(req, res, next) {
    try { res.json({ status: "success", data: { settings: await chatsService.getMemberSettings(req.params.id, req.userId) } }); }
    catch (err) { next(err); }
  },

  async markRead(req, res, next) {
    try { res.json({ status: "success", data: await chatsService.markChatRead(req.params.id, req.userId) }); }
    catch (err) { next(err); }
  },

  // Pack G: Mark all chats as read
  async markAllRead(req, res, next) {
    try { res.json({ status: "success", data: await chatsService.markAllChatsRead(req.userId) }); }
    catch (err) { next(err); }
  },

  // Pack H: Create or get self-chat (Saved Messages)
  async createSelfChat(req, res, next) {
    try {
      const chat = await chatsService.findOrCreateSelfChat(req.userId);
      res.status(chat.isNew ? 201 : 200).json({ status: "success", data: { chat } });
    } catch (err) { next(err); }
  },

  // Pack C: Custom Lists
  async listCustomLists(req, res, next) {
    try { res.json({ status: "success", data: { lists: await chatsService.listCustomLists(req.userId) } }); }
    catch (err) { next(err); }
  },

  async createCustomList(req, res, next) {
    try {
      const list = await chatsService.createCustomList(req.userId, req.body.name);
      res.status(201).json({ status: "success", data: { list } });
    } catch (err) { next(err); }
  },

  async renameCustomList(req, res, next) {
    try {
      const list = await chatsService.renameCustomList(req.userId, req.params.listId, req.body.name);
      res.json({ status: "success", data: { list } });
    } catch (err) { next(err); }
  },

  async deleteCustomList(req, res, next) {
    try {
      await chatsService.deleteCustomList(req.userId, req.params.listId);
      res.json({ status: "success", data: {} });
    } catch (err) { next(err); }
  },

  async addChatToList(req, res, next) {
    try {
      await chatsService.addChatToList(req.userId, req.params.listId, req.body.chatId);
      res.json({ status: "success", data: {} });
    } catch (err) { next(err); }
  },

  async removeChatFromList(req, res, next) {
    try {
      await chatsService.removeChatFromList(req.userId, req.params.listId, req.params.chatId);
      res.json({ status: "success", data: {} });
    } catch (err) { next(err); }
  },
};

module.exports = chatsController;
