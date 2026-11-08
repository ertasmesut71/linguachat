const authService = require("./auth.service");
const config = require("../../config");
const { sendPasswordResetEmail } = require("../../utils/email");
const otpService = require("../../utils/otp");
const store = require("../../db/store");
const { normalizePhone } = require("../../utils/phone");
const { signAccessToken, signRefreshToken } = require("../../utils/jwt");
const crypto = require("crypto");

// Cookie options for refresh token (httpOnly, secure in production)
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.env === "production",
  sameSite: config.env === "production" ? "strict" : "lax",
  path: "/api/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

const authController = {
  /**
   * POST /api/auth/register
   */
  async register(req, res, next) {
    try {
      const { email, phoneNumber, password, displayName, primaryLang } = req.body;
      const { user, accessToken, refreshToken } = await authService.register({
        email,
        phoneNumber,
        password,
        displayName,
        primaryLang,
      });

      // Set refresh token as httpOnly cookie
      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.status(201).json({
        status: "success",
        data: {
          user,
          accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/auth/login
   * Accepts { identifier, password } or legacy { email, password }.
   * identifier can be an email address or a phone number.
   */
  async login(req, res, next) {
    try {
      const { identifier, email, password } = req.body;
      const { user, accessToken, refreshToken } = await authService.login({
        identifier,
        email,
        password,
      });

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.json({
        status: "success",
        data: {
          user,
          accessToken,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/auth/refresh
   */
  async refresh(req, res, next) {
    try {
      const oldToken = req.cookies?.refreshToken || req.body?.refreshToken;
      if (!oldToken) {
        return res.status(401).json({
          status: "error",
          message: "No refresh token provided",
        });
      }

      const { accessToken, refreshToken } = await authService.refreshTokens(oldToken);

      res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

      res.json({
        status: "success",
        data: { accessToken },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      const refreshToken = req.cookies?.refreshToken;
      await authService.logout(req.userId, refreshToken);

      // Clear cookie
      res.clearCookie("refreshToken", { path: "/api/auth" });

      res.json({
        status: "success",
        message: "Logged out successfully",
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/auth/me
   */
  async me(req, res, next) {
    try {
      const user = await authService.me(req.userId);
      res.json({
        status: "success",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/auth/request-password-reset
   * Body: { email }
   *
   * Always returns the same success message (prevents account enumeration).
   * In non-production env we also return the raw token so it can be used in
   * local testing and in the client dev flow. In production, the token would
   * be emailed, never returned.
   */
  async requestPasswordReset(req, res, next) {
    try {
      const { email } = req.body || {};
      const result = await authService.requestPasswordReset(email);

      const isProd = config.env === "production";

      // If a real token was issued, attempt to send it via SMTP.
      // When SMTP is not configured the email util logs the message and
      // resolves with { sent: false, logged: true } — we treat that as
      // success for the API response so we never leak whether the account
      // exists (no enumeration).
      //
      // Any genuine SMTP failure is caught and swallowed at this layer
      // for the same reason, but logged so operators can investigate.
      if (result.token && email) {
        try {
          await sendPasswordResetEmail({
            to: email,
            token: result.token,
            expiresAt: result.expiresAt,
          });
        } catch (emailErr) {
          console.error("[auth] password-reset email send failed:", emailErr.message);
        }
      }

      const response = {
        status: "success",
        message: "If an account with that email exists, a password reset link has been sent.",
      };

      // Dev convenience: expose the raw token when not in production.
      // Tests depend on this path; do NOT remove the non-prod branch.
      if (!isProd && result.token) {
        response.dev = { token: result.token, expiresAt: result.expiresAt };
      }

      res.json(response);
    } catch (err) { next(err); }
  },

  /**
   * POST /api/auth/reset-password
   * Body: { token, newPassword }
   */
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body || {};
      const result = await authService.resetPassword(token, newPassword);
      res.json({
        status: "success",
        message: "Password reset successfully. Please log in with your new password.",
        data: { userId: result.userId },
      });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/auth/otp/request
   * Request an OTP code for phone verification or OTP-based login.
   */
  async requestOtp(req, res, next) {
    try {
      const { phone, purpose } = req.body;
      const result = await otpService.requestOtp(phone, purpose);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/auth/otp/verify
   * Verify an OTP code. For "login" purpose, returns auth tokens.
   */
  async verifyOtp(req, res, next) {
    try {
      const { phone, code, purpose, displayName, primaryLang } = req.body;
      await otpService.verifyOtp(phone, code, purpose);

      if (purpose === "login") {
        // OTP-verified login — issue tokens
        const normalized = normalizePhone(phone);
        const user = await store.findUserByPhone(normalized);
        if (!user) {
          return res.status(404).json({ status: "error", message: "No account with this phone number" });
        }
        const accessToken = signAccessToken({ id: user.id, role: user.role });
        const refreshToken = signRefreshToken({ id: user.id });
        const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
        const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await store.storeRefreshToken({ userId: user.id, tokenHash, expiresAt: refreshExpiresAt });
        await store.updateUserStatus(user.id, "online");

        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
        return res.json({
          status: "success",
          data: { user, accessToken, verified: true, loginCompleted: true },
        });
      }

      if (purpose === "signup") {
        // OTP-verified passwordless registration — create user + issue tokens
        const normalized = normalizePhone(phone);

        // Final guard: reject if phone was registered between OTP request and verify
        const existing = await store.findUserByPhone(normalized);
        if (existing) {
          return res.status(409).json({ status: "error", message: "An account with this phone number already exists" });
        }

        const authService = require("./auth.service");
        const { user, accessToken, refreshToken } = await authService.register({
          phoneNumber: phone,
          password: null, // passwordless
          displayName: displayName || `+${normalized}`,
          primaryLang: primaryLang || "en",
        });

        res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);
        return res.status(201).json({
          status: "success",
          data: { user, accessToken, verified: true, signupCompleted: true },
        });
      }

      // For "verify" purpose, just confirm verification
      res.json({ status: "success", data: { verified: true } });
    } catch (err) { next(err); }
  },
};

module.exports = authController;
