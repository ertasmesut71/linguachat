const pushService = require("../../utils/push");
const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");

const pushController = {
  /**
   * GET /api/push/vapid-public-key
   * Returns the VAPID public key so the browser can build a PushSubscription.
   * Returns 503 if push is not configured on the server.
   */
  async getVapidPublicKey(req, res, next) {
    try {
      if (!pushService.isConfigured()) {
        return res.status(503).json({
          status: "error",
          message: "Push notifications are not configured on this server",
        });
      }
      res.json({
        status: "success",
        data: { publicKey: pushService.getPublicKey() },
      });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/push/subscribe
   * Body: { endpoint, keys: { p256dh, auth } }
   * Persists (or updates) the subscription for req.userId.
   */
  async subscribe(req, res, next) {
    try {
      const { endpoint, keys } = req.body || {};
      if (!endpoint || typeof endpoint !== "string") {
        throw ApiError.badRequest("endpoint required");
      }
      if (!keys || typeof keys !== "object" || !keys.p256dh || !keys.auth) {
        throw ApiError.badRequest("keys.p256dh and keys.auth required");
      }
      if (endpoint.length > 2000) {
        throw ApiError.badRequest("endpoint too long");
      }

      const saved = await store.upsertPushSubscription({
        userId: req.userId,
        endpoint,
        p256dh: String(keys.p256dh).slice(0, 255),
        auth: String(keys.auth).slice(0, 255),
        userAgent: (req.headers["user-agent"] || "").slice(0, 500) || null,
      });

      res.status(201).json({
        status: "success",
        data: { id: saved.id, endpoint: saved.endpoint },
      });
    } catch (err) { next(err); }
  },

  /**
   * DELETE /api/push/subscribe
   * Body: { endpoint }
   * Removes the subscription, but only if it belongs to req.userId.
   */
  async unsubscribe(req, res, next) {
    try {
      const { endpoint } = req.body || {};
      if (!endpoint || typeof endpoint !== "string") {
        throw ApiError.badRequest("endpoint required");
      }

      // Ownership check — only the user who registered the subscription
      // (or who inherited it via re-subscribe) can delete it.
      const subs = await store.getPushSubscriptionsForUser(req.userId);
      const owned = subs.some((s) => s.endpoint === endpoint);
      if (!owned) {
        throw ApiError.notFound("Push subscription");
      }

      await store.removePushSubscription(endpoint);
      res.json({ status: "success", data: { removed: true } });
    } catch (err) { next(err); }
  },
};

module.exports = pushController;
