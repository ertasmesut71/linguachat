/**
 * OTP Service — phone verification via SMS codes.
 *
 * Flow:
 *   1. Client calls POST /api/auth/otp/request with { phone, purpose }
 *   2. Server generates a 6-digit code, stores it, sends SMS
 *   3. Client calls POST /api/auth/otp/verify with { phone, code, purpose }
 *   4. Server validates code → returns { verified: true }
 *
 * Purposes:
 *   - "verify"   Phone ownership verification (e.g. after registration)
 *   - "login"    Passwordless login via OTP (if the phone is already registered)
 *
 * Security:
 *   - 6-digit numeric codes (1M possibilities)
 *   - 5-minute expiry
 *   - Max 5 wrong attempts per code
 *   - Max 5 OTP requests per phone per 10 minutes (rate limiting)
 *   - Codes are invalidated after successful verification
 *   - Previous unused codes for the same phone+purpose are auto-invalidated
 */

const crypto = require("crypto");
const store = require("../db/store");
const { normalizePhone } = require("./phone");
const { sendSms, getProvider } = require("./sms");
const ApiError = require("./ApiError");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a cryptographically random numeric OTP.
 */
function generateOtp() {
  // Generate 6 random digits using crypto
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % Math.pow(10, OTP_LENGTH);
  return String(num).padStart(OTP_LENGTH, "0");
}

/**
 * Request an OTP for a phone number.
 *
 * @param {string} rawPhone  User-entered phone number
 * @param {string} purpose   "verify" | "login"
 * @returns {{ sent: boolean, phone: string, expiresAt: string, dev?: { code: string } }}
 */
async function requestOtp(rawPhone, purpose = "verify") {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw ApiError.badRequest("Invalid phone number");

  if (!["verify", "login", "signup"].includes(purpose)) {
    throw ApiError.badRequest("Invalid OTP purpose");
  }

  // For login purpose, verify the phone is registered
  if (purpose === "login") {
    const user = await store.findUserByPhone(phone);
    if (!user) throw ApiError.notFound("No account found with this phone number");
  }

  // For signup purpose, reject if phone is already registered
  if (purpose === "signup") {
    const user = await store.findUserByPhone(phone);
    if (user) throw ApiError.conflict("An account with this phone number already exists");
  }

  // Rate limit: max N requests per window
  const recentCount = await store.countRecentOtps(phone, RATE_WINDOW_MS);
  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    throw ApiError.badRequest("Too many OTP requests. Try again in a few minutes.");
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // Do not send an SMS for a code that was never stored (it could never be verified).
  const saved = await store.createOtp(phone, code, purpose, expiresAt);
  if (!saved) throw ApiError.internal("Could not create verification code. Please try again.");

  // Send SMS
  const displayPhone = `+${phone}`;
  await sendSms(displayPhone, `Your LinguaChat verification code is: ${code}. It expires in 5 minutes.`);

  const result = { sent: true, phone, expiresAt, provider: getProvider() };

  // In non-production, include the code in the response for testing
  if (process.env.NODE_ENV !== "production") {
    result.dev = { code };
  }

  return result;
}

/**
 * Verify an OTP code.
 *
 * @param {string} rawPhone
 * @param {string} code
 * @param {string} purpose
 * @returns {{ verified: boolean, reason?: string }}
 */
async function verifyOtp(rawPhone, code, purpose = "verify") {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw ApiError.badRequest("Invalid phone number");

  const result = await store.verifyOtp(phone, code, purpose);

  if (!result.valid) {
    const messages = {
      no_code: "No pending verification code found. Request a new one.",
      expired: "Verification code has expired. Request a new one.",
      wrong_code: "Invalid verification code.",
      too_many_attempts: "Too many failed attempts. Request a new code.",
      error: "Verification failed. Please try again.",
    };
    throw ApiError.badRequest(messages[result.reason] || "Verification failed.");
  }

  return { verified: true };
}

module.exports = { requestOtp, verifyOtp, generateOtp };
