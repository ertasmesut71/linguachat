/**
 * SMS Provider Abstraction (OTP delivery).
 *
 * Providers:
 *   - "test"   (default): Logs the OTP to console. Used in dev/CI.
 *                          The OTP is also returned in the API response
 *                          when NODE_ENV !== "production".
 *   - "twilio": Sends real SMS via Twilio REST API.
 *                Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *
 * Set SMS_PROVIDER env var to choose. Default: "test".
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || "test";

/**
 * Send an SMS message.
 *
 * @param {string} to      E.164-formatted phone number (e.g. "+905551234567")
 * @param {string} body    Message body
 * @returns {Promise<{ sent: boolean, provider: string, sid?: string }>}
 */
async function sendSms(to, body) {
  if (SMS_PROVIDER === "twilio") {
    return _sendViaTwilio(to, body);
  }
  return _sendViaTest(to, body);
}

// ─── Test provider ───
async function _sendViaTest(to, body) {
  // In dev/test mode, log the message instead of sending a real SMS.
  // This is intentional — no real SMS is sent.
  if (process.env.NODE_ENV !== "test") {
    console.log(`[sms:test] To: ${to} | Body: ${body}`);
  }
  return { sent: true, provider: "test" };
}

// ─── Twilio provider ───
async function _sendViaTwilio(to, body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.error("[sms:twilio] Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER");
    return { sent: false, provider: "twilio" };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const params = new URLSearchParams({ To: to.startsWith("+") ? to : `+${to}`, From: from, Body: body });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const json = await res.json();
    if (res.ok && json.sid) {
      return { sent: true, provider: "twilio", sid: json.sid };
    }
    console.error("[sms:twilio] Send failed:", json.message || json.code);
    return { sent: false, provider: "twilio" };
  } catch (err) {
    console.error("[sms:twilio] Error:", err.message);
    return { sent: false, provider: "twilio" };
  }
}

/**
 * @returns {string} Current provider name.
 */
function getProvider() {
  return SMS_PROVIDER;
}

module.exports = { sendSms, getProvider };
