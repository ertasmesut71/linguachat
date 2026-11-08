/**
 * Email utility — SMTP-backed transactional email.
 *
 * Configuration (env):
 *   SMTP_HOST          Required to actually send mail. Without it, emails are
 *                      logged to stdout (dev-friendly behavior).
 *   SMTP_PORT          Default 587 (STARTTLS). Use 465 for implicit TLS.
 *   SMTP_SECURE        "true" to force implicit TLS (port 465 style).
 *   SMTP_USER          Optional; many providers require it.
 *   SMTP_PASS          Optional.
 *   SMTP_FROM          Default "LinguaChat <no-reply@linguachat.local>".
 *
 * Behavior:
 *   - If SMTP_HOST is set: a transport is created once, lazily, and reused.
 *   - If SMTP_HOST is NOT set: sendMail() resolves with { sent: false,
 *     logged: true, messageId: null } after printing the email to stdout.
 *     This keeps dev flows and tests working without a real SMTP server.
 *   - Any transport error is caught and surfaced as a rejected promise so
 *     the caller (controller) can decide whether to fail the request or
 *     continue silently. The caller currently continues silently so the
 *     public API keeps its "no-enumeration" guarantee.
 */

const nodemailer = require("nodemailer");

let _cachedTransport = null;
let _cachedTransportKey = null;

function _buildTransportKey() {
  return [
    process.env.SMTP_HOST || "",
    process.env.SMTP_PORT || "",
    process.env.SMTP_SECURE || "",
    process.env.SMTP_USER || "",
    process.env.SMTP_PASS || "",
  ].join("|");
}

/**
 * Get or build the SMTP transport. Returns null in log-only mode.
 */
function getTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  // Re-build if any transport-relevant env var changed (important in tests).
  const key = _buildTransportKey();
  if (_cachedTransport && _cachedTransportKey === key) return _cachedTransport;

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const auth = (process.env.SMTP_USER && process.env.SMTP_PASS)
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined;

  _cachedTransport = nodemailer.createTransport({ host, port, secure, auth });
  _cachedTransportKey = key;
  return _cachedTransport;
}

function getDefaultFrom() {
  return process.env.SMTP_FROM || "LinguaChat <no-reply@linguachat.local>";
}

/**
 * Send a raw email.
 *
 * @param {object} opts
 * @param {string} opts.to         Recipient address.
 * @param {string} opts.subject    Subject line.
 * @param {string} opts.text       Plain-text body.
 * @param {string} [opts.html]     Optional HTML body.
 * @param {string} [opts.from]     Override sender.
 * @returns {Promise<{ sent: boolean, logged: boolean, messageId: string|null }>}
 */
async function sendMail({ to, subject, text, html, from } = {}) {
  if (!to || !subject || !text) {
    throw new Error("sendMail requires { to, subject, text }");
  }

  const sender = from || getDefaultFrom();
  const transport = getTransport();

  if (!transport) {
    // Log-only mode — dev and tests run through this path when SMTP_HOST is unset.
    if (process.env.NODE_ENV !== "test") {
      console.log("───────── EMAIL (log-only, SMTP_HOST not set) ─────────");
      console.log("From:    ", sender);
      console.log("To:      ", to);
      console.log("Subject: ", subject);
      console.log("─── text ───");
      console.log(text);
      if (html) {
        console.log("─── html ───");
        console.log(html);
      }
      console.log("───────────────────────────────────────────────────────");
    }
    return { sent: false, logged: true, messageId: null };
  }

  const info = await transport.sendMail({ from: sender, to, subject, text, html });
  return { sent: true, logged: false, messageId: info.messageId || null };
}

/**
 * Send a password-reset email with a branded template.
 *
 * @param {object} opts
 * @param {string} opts.to         User's email.
 * @param {string} opts.token      Raw reset token (the caller has already
 *                                 hashed and stored it; this goes in the link).
 * @param {string} opts.expiresAt  ISO expiry timestamp (for the body copy).
 * @param {string} [opts.appUrl]   Base URL of the client; defaults to
 *                                 CLIENT_URL env or http://localhost:5173.
 */
async function sendPasswordResetEmail({ to, token, expiresAt, appUrl } = {}) {
  if (!to || !token) throw new Error("sendPasswordResetEmail requires { to, token }");
  const base = appUrl || process.env.CLIENT_URL || "http://localhost:5173";
  const link = `${base.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  const expiryReadable = expiryDate ? expiryDate.toUTCString() : "1 hour from now";

  const text = [
    "Hello,",
    "",
    "A password reset was requested for your LinguaChat account.",
    "If you did not request this, you can safely ignore this email — no action is needed.",
    "",
    "To set a new password, open the link below before it expires:",
    link,
    "",
    `This link expires: ${expiryReadable}`,
    "",
    "For your security the link can be used only once and will be invalidated",
    "if a newer reset is requested.",
    "",
    "— LinguaChat",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, Segoe UI, sans-serif; color: #222; line-height: 1.55; max-width: 540px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #6c5ce7; margin: 0 0 16px;">Reset your LinguaChat password</h2>
    <p>A password reset was requested for your account. If this wasn't you, you can ignore this email — no action is needed.</p>
    <p>
      <a href="${link}" style="display: inline-block; background: #6c5ce7; color: #fff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">
        Set a new password
      </a>
    </p>
    <p style="color: #555; font-size: 13px;">Or copy this link into your browser:<br><span style="word-break: break-all;">${link}</span></p>
    <p style="color: #555; font-size: 13px;">This link expires <strong>${expiryReadable}</strong>. It can be used only once and is invalidated if a newer reset is requested.</p>
    <p style="color: #888; font-size: 12px; margin-top: 24px;">— LinguaChat</p>
  </body>
</html>`.trim();

  return sendMail({
    to,
    subject: "Reset your LinguaChat password",
    text,
    html,
  });
}

/**
 * Force a fresh transport on the next call. Used by tests to pick up
 * env-var changes between test cases.
 */
function _resetTransportCacheForTests() {
  _cachedTransport = null;
  _cachedTransportKey = null;
}

module.exports = {
  sendMail,
  sendPasswordResetEmail,
  getTransport,
  _resetTransportCacheForTests,
};
