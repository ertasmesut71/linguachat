/**
 * Cross-instance pub/sub adapter for WebSocket event fan-out.
 *
 * When REDIS_URL is set:
 *   Uses two ioredis connections (one for pub, one for sub — Redis requires
 *   separate connections for subscribe mode). Events published on one Node
 *   instance are received by all others, enabling horizontal scaling.
 *
 * When REDIS_URL is NOT set:
 *   Uses a local EventEmitter. Publish and subscribe happen in-process,
 *   which is the same behavior as the v1.0 direct-call approach. Zero
 *   overhead, zero config needed for single-instance deployments.
 *
 * Usage:
 *   const pubsub = require("./utils/pubsub");
 *   pubsub.subscribe("ws:sendToUser", ({ userId, event, payload }) => { ... });
 *   pubsub.publish("ws:sendToUser", { userId, event, payload });
 */

const { EventEmitter } = require("events");

const CHANNEL_PREFIX = "linguachat:";

let _pub = null;  // Redis client for publishing
let _sub = null;  // Redis client for subscribing (separate connection)
let _emitter = null; // Local EventEmitter fallback
let _mode = null; // "redis" | "local"

/**
 * Initialize the pub/sub adapter. Safe to call multiple times (idempotent).
 * Returns the mode string for logging.
 */
function init() {
  if (_mode) return _mode;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const Redis = require("ioredis");
      _pub = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
      _sub = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });

      _pub.on("error", (err) => console.error("[pubsub] Redis pub error:", err.message));
      _sub.on("error", (err) => console.error("[pubsub] Redis sub error:", err.message));

      // Connect both — they'll retry automatically on failure.
      _pub.connect().catch(() => {});
      _sub.connect().catch(() => {});

      _mode = "redis";
      console.log("[pubsub] Using Redis at", redisUrl.replace(/\/\/.*@/, "//<redacted>@"));
    } catch (err) {
      console.error("[pubsub] Redis init failed, falling back to local:", err.message);
      _initLocal();
    }
  } else {
    _initLocal();
  }

  return _mode;
}

function _initLocal() {
  _emitter = new EventEmitter();
  _emitter.setMaxListeners(100);
  _mode = "local";
}

/**
 * Publish a message on a channel.
 *
 * @param {string} channel  Channel name (e.g. "ws:sendToUser")
 * @param {object} data     JSON-serializable payload
 */
function publish(channel, data) {
  if (!_mode) init();

  if (_mode === "redis" && _pub) {
    const key = CHANNEL_PREFIX + channel;
    _pub.publish(key, JSON.stringify(data)).catch((err) => {
      console.error("[pubsub] publish error:", err.message);
    });
  } else if (_emitter) {
    // Local mode: emit synchronously so listeners fire immediately.
    _emitter.emit(channel, data);
  }
}

/**
 * Subscribe to a channel. The callback receives the parsed data object.
 *
 * @param {string} channel
 * @param {function} callback  (data: object) => void
 */
function subscribe(channel, callback) {
  if (!_mode) init();

  if (_mode === "redis" && _sub) {
    const key = CHANNEL_PREFIX + channel;
    // ioredis requires using the message event after subscribing to a channel.
    _sub.subscribe(key).catch((err) => {
      console.error("[pubsub] subscribe error:", err.message);
    });
    _sub.on("message", (ch, raw) => {
      if (ch !== key) return;
      try {
        callback(JSON.parse(raw));
      } catch (err) {
        console.error("[pubsub] message parse error on", channel, ":", err.message);
      }
    });
  } else if (_emitter) {
    _emitter.on(channel, callback);
  }
}

/**
 * @returns {"redis"|"local"|null} the current mode
 */
function getMode() {
  return _mode;
}

/**
 * Gracefully shut down connections. Called on process exit.
 */
async function shutdown() {
  if (_pub) { try { await _pub.quit(); } catch {} _pub = null; }
  if (_sub) { try { await _sub.quit(); } catch {} _sub = null; }
  if (_emitter) { _emitter.removeAllListeners(); _emitter = null; }
  _mode = null;
}

/**
 * Reset for tests — resets to uninitialized state so next call to
 * init/publish/subscribe re-reads env.
 */
function _resetForTests() {
  if (_pub) { try { _pub.disconnect(); } catch {} _pub = null; }
  if (_sub) { try { _sub.disconnect(); } catch {} _sub = null; }
  if (_emitter) { _emitter.removeAllListeners(); _emitter = null; }
  _mode = null;
}

module.exports = {
  init,
  publish,
  subscribe,
  getMode,
  shutdown,
  _resetForTests,
};
