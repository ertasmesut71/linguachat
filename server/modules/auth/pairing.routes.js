const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const pairingService = require("./pairing.service");

const router = Router();

// ─── Schemas ───

const createSchema = z.object({
  deviceLabel: z.string().min(1).max(120).optional(),
});

const approveSchema = z.object({
  code: z.string().min(8).max(16),
});

const pollSchema = z.object({
  code: z.string().min(8).max(16),
  nonce: z.string().min(16).max(256),
});

// ─── Routes ───

/**
 * POST /api/auth/pairing/create
 * Desktop kicks off a new pairing session. Public — anyone can start one,
 * but completion still requires an authenticated mobile approval.
 *
 * Body: { deviceLabel? }
 * Returns: { code, nonce, expiresAt }
 *
 * The desktop must keep `nonce` private; only it can later poll for tokens.
 * `code` is what gets embedded in the QR.
 */
router.post(
  "/create",
  validate(createSchema),
  async (req, res, next) => {
    try {
      const result = await pairingService.createPairingRequest({ deviceLabel: req.body?.deviceLabel });
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  }
);

/**
 * POST /api/auth/pairing/approve
 * Mobile (authenticated) approves a pairing code from a desktop.
 *
 * Body: { code }
 * Returns: { ok: true }
 */
router.post(
  "/approve",
  authenticate,
  validate(approveSchema),
  async (req, res, next) => {
    try {
      const result = await pairingService.approvePairing(req.body.code, req.userId);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  }
);

/**
 * POST /api/auth/pairing/poll
 * Desktop polls for the outcome.
 *
 * Body: { code, nonce }
 * Returns:
 *   - { status: 'pending' }  while waiting
 *   - { status: 'approved', accessToken, refreshToken, user }  on success
 */
router.post(
  "/poll",
  validate(pollSchema),
  async (req, res, next) => {
    try {
      const result = await pairingService.pollPairing(req.body.code, req.body.nonce);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  }
);

module.exports = router;
