import { getAccessToken } from "./client";

const SYNC_ANCHOR_KEY = "linguachat_sync_anchor";

class SocketClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isConnecting = false;
    this.intentionalClose = false;

    // D2 — reconnect state-sync anchor. Timestamp of the newest message the
    // client has ever seen (incoming or sent). Persisted to localStorage so
    // a page reload after being offline still replays missed messages.
    this._syncAnchor = this._loadAnchor();

    // Whether the most recent connect() should trigger a sync replay when
    // the WS opens. We skip on the very first connect after a fresh login
    // (no anchor yet) but do it from the second connect onward, or any time
    // we have a stored anchor.
    this._pendingSyncOnOpen = Boolean(this._syncAnchor);
  }

  _loadAnchor() {
    try {
      const v = localStorage.getItem(SYNC_ANCHOR_KEY);
      if (!v) return null;
      const t = Date.parse(v);
      return Number.isFinite(t) ? v : null;
    } catch { return null; }
  }

  _saveAnchor(v) {
    try { localStorage.setItem(SYNC_ANCHOR_KEY, v); } catch {}
  }

  /**
   * Update the sync anchor to max(current, ts). Call this on every message
   * received or sent so the next reconnect replays exactly what was missed.
   */
  setSyncAnchor(ts) {
    if (!ts) return;
    if (!this._syncAnchor || new Date(ts) > new Date(this._syncAnchor)) {
      this._syncAnchor = ts;
      this._saveAnchor(ts);
    }
  }

  get syncAnchor() { return this._syncAnchor; }

  /**
   * Clear the anchor on logout so the next user's session doesn't inherit it.
   */
  clearSyncAnchor() {
    this._syncAnchor = null;
    this._pendingSyncOnOpen = false;
    try { localStorage.removeItem(SYNC_ANCHOR_KEY); } catch {}
  }

  /**
   * Explicitly ask the server to replay missed messages since `since`
   * (default: our stored anchor). Normally called automatically on reconnect.
   */
  requestSync(sinceOverride) {
    const since = sinceOverride || this._syncAnchor;
    if (!since) return;
    this.send("sync:since", { lastSeenAt: since });
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;
    const token = getAccessToken();
    if (!token) return;
    this.isConnecting = true;
    this.intentionalClose = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Capacitor-aware: VITE_WS_URL overrides for native Android builds
    // where window.location.host is "localhost" (capacitor scheme).
    const wsBase = import.meta.env.VITE_WS_URL
      ? import.meta.env.VITE_WS_URL
      : `${protocol}//${window.location.host}`;
    const url = `${wsBase}/ws?token=${token}`;
    try { this.ws = new WebSocket(url); } catch { this.isConnecting = false; this.scheduleReconnect(); return; }

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.emit("_connected", {});
      // D2 — replay missed messages if we have an anchor from a previous session/connection.
      if (this._pendingSyncOnOpen && this._syncAnchor) {
        this.requestSync();
      }
      // From this point on, any disconnect-reconnect cycle should trigger sync.
      this._pendingSyncOnOpen = true;
      // No message seen yet this session: anchor to now, or a drop before the first
      // message would skip sync and miss deletions of already-loaded history.
      if (!this._syncAnchor) this.setSyncAnchor(new Date().toISOString());
    };
    this.ws.onmessage = (ev) => {
      try {
        const { event, payload } = JSON.parse(ev.data);
        // Automatically move the anchor forward when we receive new messages,
        // including replays — so a second disconnect doesn't re-replay the same set.
        if (event === "message:new" && payload?.message?.createdAt) {
          this.setSyncAnchor(payload.message.createdAt);
        } else if (event === "message:sent" && payload?.message?.createdAt) {
          this.setSyncAnchor(payload.message.createdAt);
        }
        this.emit(event, payload);
      } catch {}
    };
    this.ws.onclose = (ev) => {
      this.isConnecting = false;
      this.emit("_disconnected", { code: ev.code });
      if (!this.intentionalClose && ev.code !== 4001) this.scheduleReconnect();
    };
    this.ws.onerror = () => { this.isConnecting = false; };
  }

  disconnect() {
    this.intentionalClose = true;
    this.reconnectAttempts = 0;
    if (this.ws) { this.ws.close(1000); this.ws = null; }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) { this.emit("_reconnectFailed", {}); return; }
    const d = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    setTimeout(() => { if (!this.intentionalClose) this.connect(); }, d);
  }

  send(event, payload = {}) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event, payload })); }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => { this.listeners.get(event)?.delete(cb); };
  }

  emit(event, payload) {
    const h = this.listeners.get(event);
    if (h) for (const cb of h) try { cb(payload); } catch (e) { console.error(`Socket [${event}]:`, e); }
  }

  // ─── Text ───
  sendMessage(chatId, content, type = "text", metadata = {}, replyToId = null) {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.send("message:send", { chatId, content, type, metadata, tempId, replyToId });
    return tempId;
  }

  // ─── Voice message ───
  sendVoiceMessage(chatId, audioBase64, mimeType, duration) {
    const tempId = `vtemp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.send("voice:send", { chatId, audio: audioBase64, mimeType, duration, tempId });
    return tempId;
  }

  // ─── Seen / Chat ───
  markSeen(chatId) { this.send("message:seen", { chatId }); }
  openChat(chatId) { this.send("chat:open", { chatId }); }
  closeChat() { this.send("chat:close", {}); }

  // ─── Typing ───
  startTyping(chatId) { this.send("typing:start", { chatId }); }
  stopTyping(chatId) { this.send("typing:stop", { chatId }); }

  get isConnected() { return this.ws?.readyState === WebSocket.OPEN; }
}

const socket = new SocketClient();
export default socket;
