const { Router } = require("express");
const { z } = require("zod");
const { validate } = require("../../middleware/validate");
const { authenticate } = require("../../middleware/authenticate");
const authController = require("./auth.controller");

const router = Router();

// ─── Validation Schemas ───

const SUPPORTED_LANGUAGES = [
  "en", "tr", "es", "fr", "de", "ja", "zh", "ar", "ko", "pt", "ru", "hi",
  "it", "nl", "pl", "sv", "da", "fi", "no", "el", "cs", "ro", "hu", "th",
  "vi", "id", "ms", "uk", "bg", "hr", "sk", "sl",
];

const registerSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .max(255, "Email too long")
    .optional()
    .nullable(),
  phoneNumber: z
    .string()
    .min(7, "Phone number too short")
    .max(20, "Phone number too long")
    .optional()
    .nullable(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name too long")
    .trim(),
  primaryLang: z
    .enum(SUPPORTED_LANGUAGES, {
      errorMap: () => ({ message: "Unsupported language" }),
    })
    .default("en"),
}).refine((data) => data.email || data.phoneNumber, {
  message: "Email or phone number is required",
});

const loginSchema = z.object({
  // 'identifier' is the preferred field — can be email or phone.
  // 'email' is kept for backward compatibility with existing clients.
  identifier: z.string().min(1).optional(),
  email: z.string().optional(),
  password: z.string().min(1, "Password is required"),
}).refine((data) => data.identifier || data.email, {
  message: "Email or phone number is required",
});

const requestPasswordResetSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16, "Invalid reset token").max(256),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
});

// ─── Routes ───

// Public routes
router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.post("/refresh", authController.refresh);

// D3 — Password reset (public)
router.post("/request-password-reset", validate(requestPasswordResetSchema), authController.requestPasswordReset);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

// OTP — phone verification and OTP-based login
const otpRequestSchema = z.object({
  phone: z.string().min(7).max(20),
  purpose: z.enum(["verify", "login", "signup"]).default("verify"),
});

const otpVerifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().length(6, "Code must be 6 digits"),
  purpose: z.enum(["verify", "login", "signup"]).default("verify"),
  displayName: z.string().min(1).max(100).optional(),
  primaryLang: z.string().max(10).optional(),
});

router.post("/otp/request", validate(otpRequestSchema), authController.requestOtp);
router.post("/otp/verify", validate(otpVerifySchema), authController.verifyOtp);

// Protected routes
router.post("/logout", authenticate, authController.logout);
router.get("/me", authenticate, authController.me);

module.exports = router;
