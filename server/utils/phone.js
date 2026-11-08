/**
 * Phone number normalization and validation.
 *
 * Storage format: digits only with leading country code, no '+' prefix.
 *   e.g. "905551234567" (Turkey), "12025551234" (US)
 *
 * We store without '+' so lookups are pure numeric string matches.
 * Display can prepend '+' when showing to the user.
 *
 * Normalization strips all non-digit characters (spaces, dashes,
 * parentheses, dots, the leading '+').
 *
 * Validation: must be 7–15 digits after normalization (ITU-T E.164
 * allows up to 15 digits including country code).
 */

/**
 * Normalize a phone number input to digits-only storage format.
 * Returns null if the input is empty/invalid.
 *
 * @param {string} raw  User-entered phone number
 * @returns {string|null}  Normalized digits-only string, or null
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/**
 * Validate that a string is a valid normalized phone number.
 * @param {string} phone  Already-normalized phone string
 * @returns {boolean}
 */
function isValidPhone(phone) {
  if (!phone || typeof phone !== "string") return false;
  return /^\d{7,15}$/.test(phone);
}

/**
 * Format a stored phone number for display (prepend '+').
 * @param {string} phone  Digits-only stored phone
 * @returns {string}  "+905551234567"
 */
function formatPhoneDisplay(phone) {
  if (!phone) return "";
  return `+${phone}`;
}

module.exports = { normalizePhone, isValidPhone, formatPhoneDisplay };
