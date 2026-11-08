/**
 * API client for LinguaChat backend.
 *
 * Features:
 * - Automatic Bearer token injection from localStorage
 * - Automatic token refresh on 401
 * - Structured error responses
 * - Request/response logging in development
 * - mediaUrl() helper that appends token for <img src> / <a href>
 * - Capacitor-aware: set VITE_API_URL for native Android builds
 */

// When running inside a Capacitor WebView, the origin is capacitor://localhost
// and relative /api calls won't reach the real server. Use VITE_API_URL to
// point at the production API. For the web app (Vite dev or nginx), "/api"
// is proxied correctly and no env var is needed.
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

let isRefreshing = false;
let refreshQueue = [];

function getAccessToken() {
  return localStorage.getItem("linguachat_access_token");
}

function setAccessToken(token) {
  if (token) {
    localStorage.setItem("linguachat_access_token", token);
  } else {
    localStorage.removeItem("linguachat_access_token");
  }
}

function clearTokens() {
  localStorage.removeItem("linguachat_access_token");
}

/**
 * Build a URL for media/audio resources loaded via browser-native tags
 * (<img src>, <a href>, <audio src>). Appends the access token as a query
 * parameter because those tags cannot send Authorization headers.
 *
 * Accepts:
 *   - Absolute paths:  "/api/media/abc-123"        → "/api/media/abc-123?token=..."
 *   - Relative paths:  "media/abc-123"             → "/api/media/abc-123?token=..."
 *   - Full URLs (external): returned unchanged
 *
 * Returns null for null/empty input.
 */
function mediaUrl(pathOrUrl) {
  if (!pathOrUrl) return null;

  // External URL — return as-is
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const token = getAccessToken();

  // Normalize: ensure leading slash; ensure /api prefix
  let path = pathOrUrl;
  if (!path.startsWith("/")) path = "/" + path;
  if (!path.startsWith("/api/")) path = "/api" + (path.startsWith("/") ? path : "/" + path);

  if (!token) return path;

  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Core fetch wrapper.
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
    credentials: "include",
  };

  if (options.body && typeof options.body === "object") {
    config.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    throw {
      status: 0,
      message: "Network error. Please check your connection.",
      isNetworkError: true,
    };
  }

  if (response.status === 401 && !options._isRetry && !endpoint.includes("/auth/")) {
    return handleTokenRefresh(endpoint, options);
  }

  let data;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const error = {
      status: response.status,
      message: data?.message || `Request failed with status ${response.status}`,
      details: data?.details || null,
    };

    if (response.status !== 400 && window.__linguachat_toast) {
      window.__linguachat_toast(error.message, "error");
    }

    throw error;
  }

  return data;
}

async function handleTokenRefresh(originalEndpoint, originalOptions) {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      refreshQueue.push({ resolve, reject, endpoint: originalEndpoint, options: originalOptions });
    });
  }

  isRefreshing = true;

  try {
    const refreshResponse = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    if (!refreshResponse.ok) {
      clearTokens();
      window.location.href = "/login";
      throw { status: 401, message: "Session expired. Please log in again." };
    }

    const refreshData = await refreshResponse.json();
    const newToken = refreshData.data.accessToken;
    setAccessToken(newToken);

    const result = await request(originalEndpoint, {
      ...originalOptions,
      _isRetry: true,
    });

    for (const queued of refreshQueue) {
      try {
        const queuedResult = await request(queued.endpoint, {
          ...queued.options,
          _isRetry: true,
        });
        queued.resolve(queuedResult);
      } catch (err) {
        queued.reject(err);
      }
    }

    return result;
  } catch (err) {
    for (const queued of refreshQueue) {
      queued.reject(err);
    }
    throw err;
  } finally {
    isRefreshing = false;
    refreshQueue = [];
  }
}

// ─── Convenience Methods ───

const api = {
  get(endpoint, options) {
    return request(endpoint, { ...options, method: "GET" });
  },

  post(endpoint, body, options) {
    return request(endpoint, { ...options, method: "POST", body });
  },

  put(endpoint, body, options) {
    return request(endpoint, { ...options, method: "PUT", body });
  },

  patch(endpoint, body, options) {
    return request(endpoint, { ...options, method: "PATCH", body });
  },

  delete(endpoint, options) {
    return request(endpoint, { ...options, method: "DELETE" });
  },
};

export { api, setAccessToken, clearTokens, getAccessToken, mediaUrl };
export default api;
