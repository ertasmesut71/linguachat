const crypto = require("crypto");
const store = require("../../db/store");
const ApiError = require("../../utils/ApiError");
const { signAccessToken, signRefreshToken } = require("../../utils/jwt");

// 5-minute TTL — long enough for the user to scan and approve, short enough to
// limit the window for stolen-code abuse.
const PAIRING_TTL_MS = 5 * 60 * 1000;

// Code alphabet — readable base32 (Crockford-style minus easily confused chars).
// Excludes I, L, O, U and 0/1 to prevent visual ambiguity when the user reads
// the code off a screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function generateNonce() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashNonce(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

class PairingService {
  /**
   * Desktop calls this to start a pairing session.
   * Returns the public code (for the QR), the secret nonce (the desktop keeps
   * this — only the desktop that created the request can later poll for the
   * approval), and the expiry timestamp.
   */
  async createPairingRequest({ deviceLabel } = {}) {
    // Try a few times to avoid the astronomically rare collision on `code`.
    let code, attempt = 0;
    // 30^8 ≈ 6.5e11, so collision is vanishingly unlikely; the loop is paranoia.
    try {
      while (attempt < 5) {
        const candidate = generateCode();
        const existing = await store.findPairingTokenByCode(candidate);
        if (!existing) { code = candidate; break; }
        attempt++;
      }
    } catch (err) {
      // Prisma throws P2021 when the table doesn't exist
      if (err?.code === "P2021" || err?.message?.includes("does not exist")) {
        throw ApiError.unavailable("QR login is not available — the pairing_tokens table has not been created. Run database migrations first.");
      }
      throw err;
    }
    if (!code) throw ApiError.internal("Could not allocate pairing code");

    const nonce = generateNonce();
    const nonceHash = hashNonce(nonce);
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    await store.createPairingToken({
      code,
      nonceHash,
      deviceLabel: typeof deviceLabel === "string" ? deviceLabel.slice(0, 120) : null,
      expiresAt,
    });

    return { code, nonce, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Mobile calls this (authenticated) after scanning the QR. The user has
   * verified visually that they're approving their own desktop login.
   *
   * Approval just flips the token's status — actual JWT minting happens in
   * pollPairing so the desktop's nonce check still gates the credentials.
   */
  async approvePairing(code, userId) {
    if (!code || typeof code !== "string") throw ApiError.badRequest("Pairing code required");
    if (!userId) throw ApiError.unauthorized("Authentication required to approve pairing");

    const token = await store.findPairingTokenByCode(code);
    if (!token) throw ApiError.badRequest("Invalid pairing code");

    if (token.status === "consumed") throw ApiError.badRequest("Pairing already completed");
    if (token.status === "approved") throw ApiError.badRequest("Pairing already approved");
    if (token.status !== "pending") throw ApiError.badRequest("Pairing is not pending");
    if (new Date(token.expiresAt) < new Date()) throw ApiError.badRequest("Pairing code has expired");

    await store.approvePairingToken(code, userId);
    return { ok: true };
  }

  /**
   * Desktop polls this with its (code, nonce) pair.
   *
   * Behavior:
   *   - Wrong nonce → 401 (NEVER reveal whether the code exists).
   *   - status='pending' & not expired → { status: 'pending' }
   *   - status='approved' → mint accessToken + refreshToken, mark consumed,
   *                         return { status: 'approved', accessToken, refreshToken, user }
   *   - status='consumed' → 400 "already completed"
   *   - expired → 400 "expired"
   */
  async pollPairing(code, nonce) {
    if (!code || typeof code !== "string") throw ApiError.badRequest("Pairing code required");
    if (!nonce || typeof nonce !== "string") throw ApiError.unauthorized("Invalid pairing credentials");

    const token = await store.findPairingTokenByCode(code);
    if (!token) {
      // Constant-time-ish error: pretend the nonce was wrong so attackers
      // cannot distinguish "code does not exist" from "nonce is wrong".
      throw ApiError.unauthorized("Invalid pairing credentials");
    }

    const expectedHash = hashNonce(nonce);
    if (expectedHash !== token.nonceHash) {
      throw ApiError.unauthorized("Invalid pairing credentials");
    }

    // Expiry / state checks come AFTER nonce validation so we don't leak
    // metadata about codes whose nonce we don't know.
    if (new Date(token.expiresAt) < new Date()) {
      throw ApiError.badRequest("Pairing code has expired");
    }
    if (token.status === "consumed") {
      throw ApiError.badRequest("Pairing already completed");
    }
    if (token.status === "expired") {
      throw ApiError.badRequest("Pairing code has expired");
    }

    if (token.status === "pending") {
      return { status: "pending" };
    }

    if (token.status === "approved") {
      const user = await store.findUserById(token.approvedUserId);
      if (!user) {
        throw ApiError.badRequest("Approving user no longer exists");
      }

      // Mint a fresh access + refresh token pair for the desktop session.
      const accessToken = signAccessToken({ id: user.id, role: user.role });
      const refreshToken = signRefreshToken({ id: user.id });

      // Persist refresh token hash so /api/auth/refresh works for the desktop
      // session, just like a normal login flow.
      const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await store.storeRefreshToken({ userId: user.id, tokenHash, expiresAt: refreshExpiresAt });

      // Mark the pairing token consumed so it can't be used again (replay
      // protection against a leaked nonce).
      await store.consumePairingToken(code);

      return {
        status: "approved",
        accessToken,
        refreshToken,
        user,
      };
    }

    throw ApiError.badRequest("Pairing in unexpected state");
  }
}

module.exports = new PairingService();
