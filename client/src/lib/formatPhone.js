/**
 * Phone number display formatting.
 *
 * DISPLAY ONLY — never changes canonical storage values.
 *
 * Uses libphonenumber-js to produce country-aware international formatting:
 *   "905551234567"  →  "+90 555 123 45 67"
 *   "12025551234"   →  "+1 202 555 1234"
 *   "4930998877"    →  "+49 30 998877"
 *
 * Falls back to "+{digits}" if parsing fails. Never throws.
 */

import { parsePhoneNumber } from "libphonenumber-js";

/**
 * Format a canonical digits-only phone number for human-readable display.
 *
 * @param {string|null|undefined} phone  Digits-only stored phone (e.g. "905551234567")
 * @returns {string}  Formatted display string (e.g. "+90 555 123 45 67"), or ""
 */
export function formatPhone(phone) {
  if (!phone) return "";

  try {
    // Prepend '+' for E.164 parsing
    const parsed = parsePhoneNumber(`+${phone}`);
    if (parsed && parsed.isValid()) {
      return parsed.formatInternational();
    }
  } catch {
    // Parsing failed — fall through to simple display
  }

  // Fallback: just prepend + (the previous behavior)
  return `+${phone}`;
}
