import { create } from "zustand";
import api from "../api/client";

export const useUserStore = create((set, get) => ({
  users: {},          // Cached user map: { [id]: user }
  userList: [],       // All users for contact discovery
  isLoadingUsers: false,

  /**
   * Fetch all users (for contact list / new chat).
   */
  fetchUsers: async () => {
    set({ isLoadingUsers: true });
    try {
      const data = await api.get("/users?limit=100");
      const users = data.data.users;
      const usersMap = {};
      for (const u of users) {
        usersMap[u.id] = u;
      }
      set((state) => ({
        userList: users,
        users: { ...state.users, ...usersMap },
        isLoadingUsers: false,
      }));
      return users;
    } catch (err) {
      set({ isLoadingUsers: false });
      throw err;
    }
  },

  /**
   * Fetch a single user by ID and cache it.
   */
  fetchUser: async (userId) => {
    // Return from cache if available
    const cached = get().users[userId];
    if (cached) return cached;

    try {
      const data = await api.get(`/users/${userId}`);
      const user = data.data.user;
      set((state) => ({
        users: { ...state.users, [user.id]: user },
      }));
      return user;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Search users by name or email.
   */
  searchUsers: async (query) => {
    try {
      const data = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
      return data.data.users;
    } catch {
      return [];
    }
  },

  /**
   * Update the authenticated user's profile.
   */
  updateProfile: async (updates) => {
    try {
      const data = await api.patch("/users/me/profile", updates);
      const user = data.data.user;
      set((state) => ({
        users: { ...state.users, [user.id]: user },
      }));
      return user;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Update online status.
   */
  updateStatus: async (status) => {
    try {
      const data = await api.patch("/users/me/status", { status });
      return data.data.user;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Update primary language.
   */
  updateLanguage: async (primaryLang) => {
    try {
      const data = await api.patch("/users/me/language", { primaryLang });
      const user = data.data.user;
      set((state) => ({
        users: { ...state.users, [user.id]: user },
      }));
      return user;
    } catch (err) {
      throw err;
    }
  },

  /**
   * Get a user from cache or return null.
   */
  getUser: (userId) => {
    return get().users[userId] || null;
  },
}));
