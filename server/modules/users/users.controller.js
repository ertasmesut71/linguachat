const usersService = require("./users.service");
const mediaService = require("../media/media.service");
const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");
const pubsub = require("../../utils/pubsub");

const AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const usersController = {
  /**
   * GET /api/users/me/profile
   */
  async getMyProfile(req, res, next) {
    try {
      const user = await usersService.getProfile(req.userId);
      res.json({ status: "success", data: { user } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/users/me/profile
   */
  async updateMyProfile(req, res, next) {
    try {
      const user = await usersService.updateProfile(req.userId, req.body);
      // Broadcast profile change to all connected users
      pubsub.publish("ws:profile-updated", {
        userId: user.id, displayName: user.displayName,
        bio: user.bio, avatarUrl: user.avatarUrl,
        primaryLang: user.primaryLang, status: user.status,
      });
      res.json({ status: "success", data: { user } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/users/me/status
   */
  async updateMyStatus(req, res, next) {
    try {
      const { status } = req.body;
      const user = await usersService.updateStatus(req.userId, status);
      res.json({ status: "success", data: { user } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/users/me/language
   */
  async updateMyLanguage(req, res, next) {
    try {
      const { primaryLang } = req.body;
      const user = await usersService.updateLanguage(req.userId, primaryLang);
      res.json({ status: "success", data: { user } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/users
   */
  async listUsers(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;
      const users = await usersService.listUsers(req.userId, { limit, offset });
      res.json({ status: "success", data: { users, limit, offset } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/users/search?q=...
   */
  async searchUsers(req, res, next) {
    try {
      const { q } = req.query;
      const users = await usersService.searchUsers(req.userId, q);
      res.json({ status: "success", data: { users } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/users/:id
   */
  async getUserById(req, res, next) {
    try {
      const user = await usersService.getProfile(req.params.id);
      res.json({ status: "success", data: { user } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/users/me/avatar
   * Accepts { data: base64, mimeType: "image/jpeg" }
   * Uploads via media service, updates user.avatarUrl.
   */
  async uploadAvatar(req, res, next) {
    try {
      const { data, mimeType } = req.body;
      if (!data || !mimeType) throw ApiError.badRequest("data and mimeType required");
      // Explicit allowlist: browser-renderable raster formats only. (Anything else used
      // to pass the old "image/*" check and then crash inside the media layer as a 500.)
      if (!AVATAR_MIME.has(mimeType)) {
        throw ApiError.badRequest("Avatar must be a JPEG, PNG, WebP or GIF image");
      }

      const buffer = Buffer.from(data, "base64");
      if (buffer.length === 0) throw ApiError.badRequest("Avatar image is empty");
      if (buffer.length > 5 * 1024 * 1024) throw ApiError.badRequest("Avatar must be under 5 MB");

      let result;
      try {
        result = await mediaService.upload(buffer, "avatar.jpg", mimeType, req.userId);
      } catch (err) {
        // The media layer throws plain Errors. Log the REAL cause (visible in the app
        // container logs) and answer the client with a controlled, truthful error.
        console.error(
          `[avatar] upload failed: ${err?.name || "Error"}: ${err?.message || err}` +
          (err?.$metadata?.httpStatusCode ? ` (storage HTTP ${err.$metadata.httpStatusCode})` : "") +
          (err?.Code || err?.code ? ` [${err.Code || err.code}]` : "")
        );
        if (/^(Unsupported file type|File exceeds|File rejected)/.test(err?.message || "")) {
          throw ApiError.badRequest(err.message);
        }
        throw ApiError.unavailable("Avatar storage is temporarily unavailable. Please try again later.");
      }

      const user = await store.updateUser(req.userId, { avatarUrl: result.url });
      if (!user) {
        // store.updateUser swallows DB errors and returns null — never report success then.
        console.error(`[avatar] file stored (${result.url}) but saving avatarUrl to the user record failed`);
        throw ApiError.internal("Could not save your avatar. Please try again.");
      }

      // Real-time: same event the profile editor uses, so connected users see it without refresh.
      pubsub.publish("ws:profile-updated", {
        userId: user.id, displayName: user.displayName,
        bio: user.bio, avatarUrl: user.avatarUrl,
        primaryLang: user.primaryLang, status: user.status,
      });

      res.json({ status: "success", data: { user, avatarUrl: result.url } });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/users/:id/block
   */
  async getBlockStatus(req, res, next) {
    try {
      const blockedByMe = await store.isBlocked(req.userId, req.params.id);
      res.json({ status: "success", data: { blockedByMe } });
    } catch (err) { next(err); }
  },

  async blockUser(req, res, next) {
    try {
      if (req.params.id === req.userId) throw ApiError.badRequest("Cannot block yourself");
      const target = await store.findUserById(req.params.id);
      if (!target) throw ApiError.notFound("User");
      await store.blockUser(req.userId, req.params.id);
      // Real-time block sync to both users
      const directChat = await store.findDirectChat(req.userId, req.params.id);
      pubsub.publish("ws:block-state", { blockerId: req.userId, blockedId: req.params.id, chatId: directChat?.id || null, blocked: true });
      res.json({ status: "success", data: { blocked: true } });
    } catch (err) { next(err); }
  },

  /**
   * DELETE /api/users/:id/block
   */
  async unblockUser(req, res, next) {
    try {
      await store.unblockUser(req.userId, req.params.id);
      // Real-time unblock sync to both users
      const directChat = await store.findDirectChat(req.userId, req.params.id);
      pubsub.publish("ws:block-state", { blockerId: req.userId, blockedId: req.params.id, chatId: directChat?.id || null, blocked: false });
      res.json({ status: "success", data: { blocked: false } });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/users/:id/report
   */
  async reportUser(req, res, next) {
    try {
      if (req.params.id === req.userId) throw ApiError.badRequest("Cannot report yourself");
      const target = await store.findUserById(req.params.id);
      if (!target) throw ApiError.notFound("User");
      await store.createReport(req.userId, req.params.id, req.body.reason);
      res.json({ status: "success", data: { reported: true } });
    } catch (err) { next(err); }
  },
};

module.exports = usersController;
