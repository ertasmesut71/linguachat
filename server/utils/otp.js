/**
 * OTP Service — phone verification via Twilio Verify API.
 */

const { normalizePhone } = require("./phone");
const ApiError = require("./ApiError");
const store = require("../db/store");

const USE_TWILIO_VERIFY = !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SID
);

async function _twilioRequest(path, params) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url  = `https://verify.twilio.com/v2${path}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params).toString(),
  });
  return { status: res.status, body: await res.json() };
}

async function _sendViaTwilioVerify(phone) {
  const verifySid = process.env.TWILIO_VERIFY_SID;
  const { status, body } = await _twilioRequest(
    `/Services/${verifySid}/Verifications`,
    { To: `+${phone}`, Channel: "sms" }
  );
  if (status !== 201) {
    console.error("[otp:twilio] send failed:", body.message || body.code);
    throw ApiError.internal("Could not send verification code. Please try again.");
  }
  return { sent: true, provider: "twilio-verify" };
}

async function _checkViaTwilioVerify(phone, code) {
  const verifySid = process.env.TWILIO_VERIFY_SID;
  const { status, body } = await _twilioRequest(
    `/Services/${verifySid}/VerificationCheck`,
    { To: `+${phone}`, Code: code }
  );
  if (status !== 200) {
    console.error("[otp:twilio] check failed:", body.message || body.code);
    return { valid: false, reason: "error" };
  }
  if (body.status === "approved") return { valid: true };
  return { valid: false, reason: "wrong_code" };
}

const crypto = require("crypto");
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function generateOtp() {
  const bytes = crypto.randomBytes(4);
  const num   = bytes.readUInt32BE(0) % 1_000_000;
  return String(num).padStart(6, "0");
}

async function _sendViaTest(phone, purpose) {
  const recentCount = await store.countRecentOtps(phone, RATE_WINDOW_MS);
  if (recentCount >= MAX_REQUESTS_PER_WINDOW) {
    throw ApiError.badRequest("Too many OTP requests. Try again in a few minutes.");
  }
  const code      = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const saved     = await store.createOtp(phone, code, purpose, expiresAt);
  if (!saved) throw ApiError.internal("Could not create verification code. Please try again.");
  console.log(`[otp:test] To: +${phone} | Code: ${code}`);
  return { sent: true, provider: "test", dev: { code }, expiresAt };
}

async function _checkViaTest(phone, code, purpose) {
  return store.verifyOtp(phone, code, purpose);
}

async function requestOtp(rawPhone, purpose = "verify") {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw ApiError.badRequest("Invalid phone number");

  if (!["verify", "login", "signup"].includes(purpose)) {
    throw ApiError.badRequest("Invalid OTP purpose");
  }

  if (purpose === "login") {
    const user = await store.findUserByPhone(phone);
    if (!user) throw ApiError.notFound("No account found with this phone number");
  }
  if (purpose === "signup") {
    const user = await store.findUserByPhone(phone);
    if (user) throw ApiError.conflict("An account with this phone number already exists");
  }

  if (USE_TWILIO_VERIFY) {
    const result = await _sendViaTwilioVerify(phone);
    return { ...result, phone, expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString() };
  }

  const result = await _sendViaTest(phone, purpose);
  if (process.env.NODE_ENV !== "production") return { ...result, phone };
  const { dev: _removed, ...safe } = result;
  return { ...safe, phone };
}

async function verifyOtp(rawPhone, code, purpose = "verify") {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw ApiError.badRequest("Invalid phone number");

  const result = USE_TWILIO_VERIFY
    ? await _checkViaTwilioVerify(phone, code)
    : await _checkViaTest(phone, code, purpose);

  if (!result.valid) {
    const messages = {
      no_code:           "No pending verification code found. Request a new one.",
      expired:           "Verification code has expired. Request a new one.",
      wrong_code:        "Invalid verification code.",
      too_many_attempts: "Too many failed attempts. Request a new code.",
      error:             "Verification failed. Please try again.",
    };
    throw ApiError.badRequest(messages[result.reason] || "Verification failed.");
  }

  return { verified: true };
}

module.exports = { requestOtp, verifyOtp, generateOtp };
