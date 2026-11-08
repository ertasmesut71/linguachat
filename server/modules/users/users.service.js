const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

class UsersService {
  /**
   * Get a user's public profile.
   */
  async getProfile(userId) {
    const user = await store.findUserById(userId);
    if (!user) {
      throw ApiError.notFound("User");
    }
    return user;
  }

  /**
   * Update the authenticated user's profile.
   * Only allows updating safe fields.
   */
  async updateProfile(userId, data) {
    const allowedFields = [
      "displayName",
      "bio",
      "avatarUrl",
      "primaryLang",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates[field] = data[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest("No valid fields to update");
    }

    const user = await store.updateUser(userId, updates);
    if (!user) {
      throw ApiError.notFound("User");
    }

    return user;
  }

  /**
   * Update the user's online status.
   */
  async updateStatus(userId, status) {
    const validStatuses = ["online", "away", "offline", "do_not_disturb"];
    if (!validStatuses.includes(status)) {
      throw ApiError.badRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    const user = await store.updateUserStatus(userId, status);
    if (!user) {
      throw ApiError.notFound("User");
    }
    return user;
  }

  /**
   * List all users (for contact discovery).
   * Excludes the requesting user.
   */
  async listUsers(requesterId, { limit = 50, offset = 0 } = {}) {
    return store.listUsers({ excludeId: requesterId, limit, offset });
  }

  /**
   * Search users by name or email.
   */
  async searchUsers(requesterId, query) {
    if (!query || query.trim().length < 2) {
      throw ApiError.badRequest("Search query must be at least 2 characters");
    }
    return store.searchUsers(query, requesterId);
  }

  /**
   * Update language preference for the current user.
   */
  async updateLanguage(userId, primaryLang) {
    const user = await store.updateUser(userId, { primaryLang });
    if (!user) {
      throw ApiError.notFound("User");
    }
    return user;
  }
}

module.exports = new UsersService();
