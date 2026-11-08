import { create } from "zustand";
import api, { setAccessToken, clearTokens, getAccessToken } from "../api/client";

export const useAuthStore = create((set, get) => ({
  user: null,
  isLoading: true,
  error: null,

  /**
   * Initialize auth state on app mount.
   * Checks if an existing access token is valid by calling /auth/me.
   */
  initialize: async () => {
    const token = getAccessToken();
    if (!token) {
      set({ isLoading: false, user: null });
      return;
    }

    try {
      const data = await api.get("/auth/me");
      set({ user: data.data.user, isLoading: false, error: null });
    } catch (err) {
      // Token invalid or expired (refresh will be attempted by api client)
      clearTokens();
      set({ user: null, isLoading: false, error: null });
    }
  },

  /**
   * Register a new account.
   */
  register: async ({ email, phoneNumber, password, displayName, primaryLang }) => {
    set({ error: null });
    try {
      const data = await api.post("/auth/register", {
        email: email || undefined,
        phoneNumber: phoneNumber || undefined,
        password,
        displayName,
        primaryLang,
      });
      setAccessToken(data.data.accessToken);
      set({ user: data.data.user, error: null });
      return data.data.user;
    } catch (err) {
      const message = err?.details
        ? err.details.map((d) => d.message).join(", ")
        : err.message || "Registration failed";
      set({ error: message });
      throw err;
    }
  },

  /**
   * Log in with email + password.
   */
  login: async ({ identifier, email, password }) => {
    set({ error: null });
    try {
      const data = await api.post("/auth/login", { identifier: identifier || email, password });
      setAccessToken(data.data.accessToken);
      set({ user: data.data.user, error: null });
      return data.data.user;
    } catch (err) {
      const message = err.message || "Login failed";
      set({ error: message });
      throw err;
    }
  },

  /**
   * Log out — clear tokens and reset state.
   */
  logout: async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // Continue logout even if API call fails
    }
    clearTokens();
    set({ user: null, error: null });
  },

  /**
   * Update the locally cached user object after profile edits.
   * Does NOT call the API — call userStore.updateProfile() first.
   */
  setUser: (userData) => {
    set((state) => ({
      user: state.user ? { ...state.user, ...userData } : null,
    }));
  },

  /**
   * Clear error state.
   */
  clearError: () => set({ error: null }),
}));
