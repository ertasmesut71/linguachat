/**
 * Web Push subscription helpers.
 *
 * Wraps the browser PushManager API and calls the server's /api/push
 * endpoints to persist the subscription. Gracefully no-ops when push is
 * unsupported or VAPID is not configured on the server.
 */

import api from "../api/client";

/**
 * Convert a base64url-encoded string (the VAPID public key the server
 * returns) to the Uint8Array the PushManager.subscribe API requires.
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * @returns {boolean} true if this browser supports the Push API.
 */
export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Check if the user already has an active push subscription on this device.
 * @returns {Promise<PushSubscription|null>}
 */
export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Fetch the server's VAPID public key. Returns null if the server responds
 * with 503 (push not configured) or any error.
 */
export async function fetchVapidPublicKey() {
  try {
    const res = await api.get("/push/vapid-public-key");
    return res?.data?.publicKey || null;
  } catch {
    return null;
  }
}

/**
 * Full subscribe flow:
 *  1. Request notification permission from the browser
 *  2. Fetch the server's VAPID public key
 *  3. Subscribe via PushManager (creates a push endpoint at the browser vendor)
 *  4. Send the subscription to our server so it knows where to deliver
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function subscribeToPush() {
  if (!isPushSupported()) {
    return { ok: false, reason: "Push not supported in this browser" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission denied" };
  }

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    return { ok: false, reason: "Push not configured on this server" };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    await api.post("/push/subscribe", {
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
    });

    return { ok: true };
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return { ok: false, reason: err?.message || "Subscribe failed" };
  }
}

/**
 * Full unsubscribe flow:
 *  1. Get the existing browser subscription
 *  2. Unsubscribe from the browser's push service
 *  3. Tell our server to remove the subscription
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export async function unsubscribeFromPush() {
  try {
    const sub = await getExistingSubscription();
    if (!sub) {
      return { ok: true }; // nothing to unsubscribe
    }

    const endpoint = sub.endpoint;
    await sub.unsubscribe();

    try {
      await api.delete("/push/subscribe", { body: { endpoint } });
    } catch {
      // Server-side removal failed (maybe already gone) — not fatal;
      // the browser side is already unsubscribed.
    }

    return { ok: true };
  } catch (err) {
    console.error("[push] unsubscribe failed:", err);
    return { ok: false, reason: err?.message || "Unsubscribe failed" };
  }
}
