const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

class ChatsService {
  async findOrCreateDirectChat(userId, otherUserId) {
    if (userId === otherUserId) throw ApiError.badRequest("Cannot chat with yourself");
    const other = await store.findUserById(otherUserId);
    if (!other) throw ApiError.notFound("User");

    const existing = await store.findDirectChat(userId, otherUserId);
    if (existing) {
      // Reopening from Contacts: bring the chat back for the requester only (clears hidden + archived).
      try { await store.unhideChatForUser(existing.id, userId); } catch (_) {}
      const members = await store.getChatMembers(existing.id); return { ...existing, members, isNew: false }; }

    const chat = await store.createChat({ type: "direct", createdBy: userId });
    const me = await store.findUserById(userId);
    await store.addChatMember({ chatId: chat.id, userId, role: "member", receiveLang: me?.primaryLang || "en", autoTranslate: true });
    await store.addChatMember({ chatId: chat.id, userId: otherUserId, role: "member", receiveLang: other.primaryLang || "en", autoTranslate: true });
    const members = await store.getChatMembers(chat.id);
    return { ...chat, members, isNew: true };
  }

  /**
   * Create a group chat with initial members.
   */
  async createGroupChat(creatorId, { name, description, memberIds }) {
    if (!name?.trim()) throw ApiError.badRequest("Group name is required");
    if (!memberIds || memberIds.length === 0) throw ApiError.badRequest("At least one other member required");

    // Verify all members exist
    for (const id of memberIds) {
      const u = await store.findUserById(id);
      if (!u) throw ApiError.notFound(`User ${id}`);
    }

    const chat = await store.createChat({
      type: "group",
      name: name.trim(),
      description: description?.trim() || null,
      createdBy: creatorId,
    });

    // Add creator as owner
    const creator = await store.findUserById(creatorId);
    await store.addChatMember({
      chatId: chat.id, userId: creatorId, role: "owner",
      receiveLang: creator?.primaryLang || "en", autoTranslate: true,
    });

    // Add other members
    for (const id of memberIds) {
      if (id === creatorId) continue;
      const u = await store.findUserById(id);
      await store.addChatMember({
        chatId: chat.id, userId: id, role: "member",
        receiveLang: u?.primaryLang || "en", autoTranslate: true,
      });
    }

    // Create system message
    await store.createMessage({
      chatId: chat.id, senderId: creatorId, type: "system",
      content: `${creator?.displayName} created the group "${name.trim()}"`,
    });

    const members = await store.getChatMembers(chat.id);
    return { ...chat, members };
  }

  /**
   * Add a member to a group chat.
   */
  async addMember(chatId, adminId, newUserId) {
    const chat = await store.findChatById(chatId);
    if (!chat || chat.type !== "group") throw ApiError.badRequest("Not a group chat");

    const admin = await store.findChatMember(chatId, adminId);
    if (!admin) throw ApiError.forbidden("Not a member");
    if (admin.role !== "owner" && admin.role !== "admin") throw ApiError.forbidden("Admin required");

    const existing = await store.findChatMember(chatId, newUserId);
    if (existing) throw ApiError.conflict("User is already a member");

    const user = await store.findUserById(newUserId);
    if (!user) throw ApiError.notFound("User");

    await store.addChatMember({
      chatId, userId: newUserId, role: "member",
      receiveLang: user.primaryLang || "en", autoTranslate: true,
    });

    const adminUser = await store.findUserById(adminId);
    await store.createMessage({
      chatId, senderId: adminId, type: "system",
      content: `${adminUser?.displayName} added ${user.displayName}`,
    });

    return store.getChatMembers(chatId);
  }

  /**
   * Remove a member from a group chat.
   */
  async removeMember(chatId, adminId, targetUserId) {
    const chat = await store.findChatById(chatId);
    if (!chat || chat.type !== "group") throw ApiError.badRequest("Not a group chat");

    const isSelfLeave = adminId === targetUserId;

    if (isSelfLeave) {
      // Self-removal (leave group) — any member except the owner can leave.
      const self = await store.findChatMember(chatId, adminId);
      if (!self) throw ApiError.notFound("Member");
      if (self.role === "owner") throw ApiError.badRequest("Owner cannot leave. Transfer ownership first or delete the group.");

      await store.removeChatMember(chatId, targetUserId);

      const user = await store.findUserById(adminId);
      await store.createMessage({
        chatId, senderId: adminId, type: "system",
        content: `${user?.displayName || "A member"} left the group`,
      });
    } else {
      // Admin removing another member — requires admin/owner role.
      const admin = await store.findChatMember(chatId, adminId);
      if (!admin || (admin.role !== "owner" && admin.role !== "admin")) throw ApiError.forbidden("Admin required");

      const target = await store.findChatMember(chatId, targetUserId);
      if (!target) throw ApiError.notFound("Member");
      if (target.role === "owner") throw ApiError.badRequest("Cannot remove the owner");

      await store.removeChatMember(chatId, targetUserId);

      const adminUser = await store.findUserById(adminId);
      const targetUser = await store.findUserById(targetUserId);
      await store.createMessage({
        chatId, senderId: adminId, type: "system",
        content: `${adminUser?.displayName} removed ${targetUser?.displayName}`,
      });
    }

    return store.getChatMembers(chatId);
  }

  async listUserChats(userId, { includeArchived = false } = {}) { return store.listUserChats(userId, { includeArchived }); }

  async getChatById(chatId, userId) {
    const chat = await store.findChatById(chatId);
    if (!chat) throw ApiError.notFound("Chat");
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const members = await store.getChatMembers(chatId);
    return { ...chat, members };
  }

  async updateChat(chatId, userId, data) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const allowed = {};
    if (data.name !== undefined) allowed.name = data.name;
    if (data.description !== undefined) allowed.description = data.description;
    // Pack E: in groups only owner/admin may set the timer. Direct chats have no
    // owner (both sides are plain members), so either side may set it there.
    if (data.disappearingTimer !== undefined) {
      const current = await store.findChatById(chatId);
      const isManager = membership.role === "owner" || membership.role === "admin";
      if (current?.type === "group" && !isManager) {
        throw ApiError.forbidden("Only the group owner or an admin can change disappearing messages");
      }
      allowed.disappearingTimer = data.disappearingTimer;
    }
    const chat = await store.updateChat(chatId, allowed);
    if (!chat) throw ApiError.notFound("Chat");
    const members = await store.getChatMembers(chatId);
    return { ...chat, members };
  }

  async updateMemberSettings(chatId, userId, settings) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const updates = {};
    if (settings.receiveLang !== undefined) updates.receiveLang = settings.receiveLang;
    if (settings.autoTranslate !== undefined) updates.autoTranslate = settings.autoTranslate;
    if (settings.muted !== undefined) updates.muted = !!settings.muted;
    // Pack A: archive/unarchive
    if (settings.archived !== undefined) {
      updates.archivedAt = settings.archived ? new Date().toISOString() : null;
    }
    // Pack B: favorite/unfavorite
    if (settings.favorited !== undefined) {
      updates.favoritedAt = settings.favorited ? new Date().toISOString() : null;
    }
    return store.updateChatMember(chatId, userId, updates);
  }

  async getMemberSettings(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    const effectiveLang = await store.getEffectiveReceiveLang(chatId, userId);
    return {
      receiveLang: membership.receiveLang,
      effectiveReceiveLang: effectiveLang,
      autoTranslate: membership.autoTranslate,
      muted: membership.muted || false,
      // Pack A+B
      archived: !!membership.archivedAt,
      archivedAt: membership.archivedAt || null,
      favorited: !!membership.favoritedAt,
      favoritedAt: membership.favoritedAt || null,
    };
  }

  async markChatRead(chatId, userId) {
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member");
    await store.updateChatMember(chatId, userId, { lastReadAt: new Date().toISOString() });
    return { chatId, readAt: new Date().toISOString() };
  }

  // Pack G: Mark all chats as read for a user
  async markAllChatsRead(userId) {
    const chats = await store.listUserChats(userId);
    const now = new Date().toISOString();
    const results = [];
    for (const chat of chats) {
      try {
        await store.updateChatMember(chat.id, userId, { lastReadAt: now });
        results.push(chat.id);
      } catch { /* skip if membership not found */ }
    }
    return { markedCount: results.length, readAt: now };
  }

  // Pack H: Self-chat (Saved Messages)
  async findOrCreateSelfChat(userId) {
    // A self-chat is a direct chat where both members are the same user.
    // We store it as a direct chat with a special name "Saved Messages" and createdBy=userId.
    const existing = await store.findSelfChat(userId);
    if (existing) {
      const members = await store.getChatMembers(existing.id);
      return { ...existing, members, isNew: false };
    }
    const chat = await store.createChat({
      type: "direct",
      name: "Saved Messages",
      createdBy: userId,
    });
    const me = await store.findUserById(userId);
    // Add the user as the only member (self-chat: single member)
    await store.addChatMember({
      chatId: chat.id,
      userId,
      role: "owner",
      receiveLang: me?.primaryLang || "en",
      autoTranslate: false, // No translation for self-messages
    });
    const members = await store.getChatMembers(chat.id);
    return { ...chat, members, isNew: true };
  }

  // Pack C: Custom Lists
  async listCustomLists(userId) {
    return store.listChatLists(userId);
  }

  async createCustomList(userId, name) {
    return store.createChatList(userId, name.trim());
  }

  async renameCustomList(userId, listId, name) {
    const list = await store.findChatList(listId, userId);
    if (!list) throw ApiError.notFound("List");
    return store.updateChatList(listId, { name: name.trim() });
  }

  async deleteCustomList(userId, listId) {
    const list = await store.findChatList(listId, userId);
    if (!list) throw ApiError.notFound("List");
    return store.deleteChatList(listId);
  }

  async addChatToList(userId, listId, chatId) {
    const list = await store.findChatList(listId, userId);
    if (!list) throw ApiError.notFound("List");
    // Verify user is a member of the chat
    const membership = await store.findChatMember(chatId, userId);
    if (!membership) throw ApiError.forbidden("Not a member of that chat");
    return store.addChatToList(listId, chatId);
  }

  async removeChatFromList(userId, listId, chatId) {
    const list = await store.findChatList(listId, userId);
    if (!list) throw ApiError.notFound("List");
    return store.removeChatFromList(listId, chatId);
  }
}

module.exports = new ChatsService();
