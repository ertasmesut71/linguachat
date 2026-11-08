/**
 * Web Push utility — VAPID-based notifications via the web-push library.
 *
 * Configuration (env, all three required for real delivery):
 *   VAPID_PUBLIC_KEY    Base64url-encoded VAPID public key (shown to the client)
 *   VAPID_PRIVATE_KEY   Base64url-encoded VAPID private key (server-side only)
 *   VAPID_SUBJECT       mailto: or https: URL identifying the app operator
 *                       (default: "mailto:admin@linguachat.local")
 *
 * Generate a new keypair with:
 *   npx web-push generate-vapid-keys
 * or programmatically via `generateVapidKeys()` exported here.
 *
 * Behavior:
 *   - If VAPID is not fully configured, `isConfigured()` returns false and
 *     `sendPush`/`sendPushToUser` no-op with a clear return value; the HTTP
 *     endpoint returns 503 so the client can disable the feature in the UI.
 *   - When a push endpoint returns 404/410/403, the subscription is stale
 *     and will be auto-deleted from the store by `sendPushToUser`.
 *   - All other transport errors are logged but not re-thrown, because push
 *     delivery is best-effort and must not block real-time message fan-out.
 */

const webpush = require("web-push");
const store = require("../db/store");

class DeadSubscriptionError extends Error {
  constructor(statusCode, endpoint) {
    super(`Push subscription is dead (status ${statusCode}) — endpoint: ${endpoint.slice(0, 80)}…`);
    this.name = "DeadSubscriptionError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.isOperational = true;
  }
}

let _configuredOnce = false;

function _readConfig() {
  return {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:admin@linguachat.local",
  };
}

/**
 * @returns {boolean} true if all required VAPID config is present.
 */
function isConfigured() {
  const c = _readConfig();
  return Boolean(c.publicKey && c.privateKey);
}

/**
 * @returns {string|null} the public key if configured, otherwise null.
 */
function getPublicKey() {
  const c = _readConfig();
  return c.publicKey || null;
}

/**
 * Configure the web-push library with the current env values. Safe to call
 * multiple times — will re-read env on each call (important for tests that
 * toggle env between cases).
 */
function _applyConfig() {
  const c = _readConfig();
  if (!c.publicKey || !c.privateKey) return false;
  webpush.setVapidDetails(c.subject, c.publicKey, c.privateKey);
  _configuredOnce = true;
  return true;
}

/**
 * Generate a new VAPID keypair. Dev convenience — the canonical path is
 * `npx web-push generate-vapid-keys`.
 *
 * @returns {{ publicKey: string, privateKey: string }}
 */
function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}

/**
 * Send a push notification to a single subscription.
 *
 * @param {object} subscription   { endpoint, keys: { p256dh, auth } } OR
 *                                { endpoint, p256dh, auth } (store shape)
 * @param {object} payloadObj     JSON-serializable payload. Will be
 *                                JSON.stringify'd before sending.
 * @throws {DeadSubscriptionError} if the push service returns 404/410/403.
 * @throws {Error}                 for any other transport error.
 */
async function sendPush(subscription, payloadObj) {
  if (!isConfigured()) {
    return { sent: false, reason: "vapid-not-configured" };
  }
  if (!_configuredOnce) _applyConfig();

  // Normalize both shapes — store rows have flat p256dh/auth, browser
  // subscription objects nest them under `.keys`.
  const sub = subscription.keys
    ? subscription
    : { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };

  const payload = JSON.stringify(payloadObj || {});

  try {
    await webpush.sendNotification(sub, payload);
    return { sent: true };
  } catch (err) {
    const status = err?.statusCode;
    if (status === 404 || status === 410 || status === 403) {
      throw new DeadSubscriptionError(status, sub.endpoint);
    }
    throw err;
  }
}

/**
 * Fan out a notification to every push subscription the user has registered.
 * Dead subscriptions are auto-deleted; other errors are logged and swallowed.
 *
 * @returns {Promise<{ sent: number, dead: number, failed: number, skipped: boolean }>}
 */
async function sendPushToUser(userId, payloadObj) {
  if (!isConfigured()) {
    return { sent: 0, dead: 0, failed: 0, skipped: true };
  }

  const subs = await store.getPushSubscriptionsForUser(userId);
  if (!subs || subs.length === 0) {
    return { sent: 0, dead: 0, failed: 0, skipped: false };
  }

  let sent = 0, dead = 0, failed = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      const result = await sendPush(s, payloadObj);
      if (result && result.sent) sent += 1;
    } catch (err) {
      if (err instanceof DeadSubscriptionError) {
        dead += 1;
        try { await store.removePushSubscription(err.endpoint); } catch {}
      } else {
        failed += 1;
        console.error("[push] send failed:", err?.message || err);
      }
    }
  }));

  return { sent, dead, failed, skipped: false };
}

/**
 * Reset internal state. Tests call this between cases so env changes take
 * effect even though we only call setVapidDetails once normally.
 */
function _resetForTests() {
  _configuredOnce = false;
}

module.exports = {
  isConfigured,
  getPublicKey,
  generateVapidKeys,
  sendPush,
  sendPushToUser,
  DeadSubscriptionError,
  _resetForTests,
};
