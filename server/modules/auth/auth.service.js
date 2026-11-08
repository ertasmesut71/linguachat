const store = require("../../db/store");
const { hashPassword, comparePassword } = require("../../utils/hash");
const { signAccessToken, signRefreshToken, verifyToken } = require("../../utils/jwt");
const ApiError = require("../../utils/ApiError");
const crypto = require("crypto");
const { normalizePhone } = require("../../utils/phone");

// Password reset tokens expire in 1 hour
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

class AuthService {
  /**
   * Register a new user.
   * Accepts email and/or phoneNumber. At least one identifier is required.
   * @returns {{ user, accessToken, refreshToken }}
   */
  async register({ email, phoneNumber, password, displayName, primaryLang }) {
    if (!email && !phoneNumber) {
      throw ApiError.badRequest("Email or phone number is required");
    }

    // Check email uniqueness
    if (email) {
      const existing = await store.findUserByEmail(email);
      if (existing) throw ApiError.conflict("An account with this email already exists");
    }

    // Normalize + check phone uniqueness
    let normalizedPhone = null;
    if (phoneNumber) {
      normalizedPhone = normalizePhone(phoneNumber);
      if (!normalizedPhone) throw ApiError.badRequest("Invalid phone number format");
      const existing = await store.findUserByPhone(normalizedPhone);
      if (existing) throw ApiError.conflict("An account with this phone number already exists");
    }

    // Password is optional (passwordless phone registration via OTP)
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await store.createUser({
      email: email || null,
      phoneNumber: normalizedPhone,
      passwordHash,
      displayName,
      primaryLang: primaryLang || "en",
    });

    const accessToken = signAccessToken({ id: user.id, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });
    await this._storeRefreshToken(user.id, refreshToken);
    await store.updateUserStatus(user.id, "online");

    return { user, accessToken, refreshToken };
  }

  /**
   * Log in with (email OR phone) + password.
   * The `identifier` field is auto-detected: if it contains '@', treated
   * as email; if it's mostly digits, treated as phone; otherwise email.
   * @returns {{ user, accessToken, refreshToken }}
   */
  async login({ identifier, email, password }) {
    // Support both { identifier } and legacy { email } patterns
    const id = identifier || email;
    if (!id) throw ApiError.badRequest("Email or phone number is required");

    let userWithPassword = null;
    const looksLikePhone = /^\+?\d[\d\s\-().]{5,}$/.test(id.trim());

    if (looksLikePhone) {
      const normalized = normalizePhone(id);
      if (normalized) userWithPassword = await store.findUserByPhoneWithPassword(normalized);
    }
    // If not found by phone, try email
    if (!userWithPassword) {
      userWithPassword = await store.findUserByEmailWithPassword(id);
    }

    if (!userWithPassword) {
      throw ApiError.unauthorized("Invalid credentials");
    }

    // Passwordless accounts cannot use password login
    if (!userWithPassword.passwordHash) {
      throw ApiError.unauthorized("This account uses passwordless login. Please sign in with SMS code.");
    }

    const valid = await comparePassword(password, userWithPassword.passwordHash);
    if (!valid) {
      throw ApiError.unauthorized("Invalid credentials");
    }

    const user = await store.findUserById(userWithPassword.id);
    const accessToken = signAccessToken({ id: user.id, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });
    await this._storeRefreshToken(user.id, refreshToken);
    await store.updateUserStatus(user.id, "online");

    return { user, accessToken, refreshToken };
  }

  /**
   * Refresh the access token using a valid refresh token.
   * Implements refresh token rotation.
   */
  async refreshTokens(oldRefreshToken) {
    let decoded;
    try {
      decoded = verifyToken(oldRefreshToken);
    } catch {
      throw ApiError.unauthorized("Invalid refresh token");
    }

    if (decoded.type !== "refresh") {
      throw ApiError.unauthorized("Invalid token type");
    }

    const tokenHash = this._hashToken(oldRefreshToken);
    const storedToken = await store.findRefreshToken(tokenHash);
    if (!storedToken) {
      await store.revokeAllUserRefreshTokens(decoded.sub);
      throw ApiError.unauthorized("Refresh token has been revoked");
    }

    await store.revokeRefreshToken(tokenHash);

    const user = await store.findUserById(decoded.sub);
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    const accessToken = signAccessToken({ id: user.id, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });
    await this._storeRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  /**
   * Log out — revoke refresh token and set user offline.
   */
  async logout(userId, refreshToken) {
    if (refreshToken) {
      const tokenHash = this._hashToken(refreshToken);
      await store.revokeRefreshToken(tokenHash);
    }
    await store.updateUserStatus(userId, "offline");
  }

  /**
   * Get the current authenticated user's profile.
   */
  async me(userId) {
    const user = await store.findUserById(userId);
    if (!user) {
      throw ApiError.notFound("User");
    }
    return user;
  }

  // ═══════════════════════════════════════════════
  // D3 — Password reset
  // ═══════════════════════════════════════════════

  /**
   * Start a password reset flow.
   *
   * Security model:
   *  - ALWAYS returns the same shape regardless of whether the email exists
   *    (prevents account enumeration).
   *  - Revokes any outstanding (unconsumed) reset tokens for that user so
   *    only the newest link is valid.
   *  - Generates a 32-byte URL-safe token, hashes it with sha256, stores
   *    only the hash. The plain token is the return value.
   *  - Token expires in 1 hour.
   *
   * In production, the caller (controller) should email the plain token as
   * a link and NOT return it in the HTTP response. For now — since no SMTP
   * service is wired — the controller returns the token in the response
   * ONLY in non-production env, marked clearly as a dev convenience.
   *
   * @returns {{ token: string|null, expiresAt: string|null, userExists: boolean }}
   *   When the user exists: plain token + expiry.
   *   When the user does not exist: { token: null, expiresAt: null }.
   *   The caller must NOT leak userExists to untrusted clients.
   */
  async requestPasswordReset(email) {
    if (!email || typeof email !== "string") {
      throw ApiError.badRequest("Email is required");
    }
    const normalized = email.toLowerCase().trim();
    const user = await store.findUserByEmail(normalized);
    if (!user) {
      return { token: null, expiresAt: null, userExists: false };
    }

    // Invalidate any outstanding tokens — only the newest link works.
    await store.revokeUserPasswordResetTokens(user.id);

    const plainToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = this._hashToken(plainToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await store.createPasswordResetToken({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      token: plainToken,
      expiresAt: expiresAt.toISOString(),
      userExists: true,
    };
  }

  /**
   * Complete a password reset: verify the token, check expiry and reuse,
   * hash + store the new password, mark the token consumed, revoke ALL
   * refresh tokens for the user so any existing sessions are force-logged
   * out (standard security practice).
   */
  async resetPassword(plainToken, newPassword) {
    if (!plainToken || typeof plainToken !== "string") {
      throw ApiError.badRequest("Reset token is required");
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      throw ApiError.badRequest("New password must be at least 8 characters");
    }

    const tokenHash = this._hashToken(plainToken);
    const stored = await store.findPasswordResetTokenByHash(tokenHash);
    if (!stored) {
      throw ApiError.badRequest("Invalid or expired reset token");
    }
    if (stored.consumedAt) {
      throw ApiError.badRequest("Reset token has already been used");
    }
    if (new Date(stored.expiresAt) < new Date()) {
      throw ApiError.badRequest("Reset token has expired");
    }

    const user = await store.findUserById(stored.userId);
    if (!user) {
      throw ApiError.badRequest("User no longer exists");
    }

    // Update password
    const passwordHash = await hashPassword(newPassword);
    await store.updateUserPassword(user.id, passwordHash);

    // Mark the token consumed so it can't be reused
    await store.consumePasswordResetToken(tokenHash);

    // Force-logout all existing sessions for security
    await store.revokeAllUserRefreshTokens(user.id);

    return { userId: user.id, email: user.email };
  }

  // ─── Internal helpers ───

  _hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async _storeRefreshToken(userId, token) {
    const tokenHash = this._hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await store.storeRefreshToken({ userId, tokenHash, expiresAt });
  }
}

module.exports = new AuthService();
