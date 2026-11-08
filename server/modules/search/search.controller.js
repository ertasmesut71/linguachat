const searchService = require("./search.service");
const ApiError = require("../../utils/ApiError");

const searchController = {
  async search(req, res, next) {
    try {
      const { q, chatId, type } = req.query;
      if (!q || q.trim().length < 2) throw ApiError.badRequest("Query must be at least 2 characters");

      if (type === "users") {
        const users = await searchService.searchUsers(req.userId, q);
        return res.json({ status: "success", data: { results: users, type: "users" } });
      }

      if (chatId) {
        const messages = await searchService.searchInChat(chatId, req.userId, q);
        return res.json({ status: "success", data: { results: messages, type: "messages", chatId } });
      }

      const messages = await searchService.searchGlobal(req.userId, q);
      res.json({ status: "success", data: { results: messages, type: "messages" } });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = searchController;
