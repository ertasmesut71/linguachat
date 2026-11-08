/**
 * Sanitize user-provided text content before storage.
 * Strips HTML tags and dangerous patterns while preserving
 * unicode, emoji, newlines, and normal punctuation.
 */

// Matches HTML tags including self-closing and attributes
const HTML_TAG_RE = /<\/?[a-z][a-z0-9]*\b[^>]*\/?>/gi;

// Matches javascript: and data: URI schemes
const DANGEROUS_URI_RE = /(?:javascript|data|vbscript)\s*:/gi;

// Matches event handler attributes (even outside tags, for safety)
const EVENT_HANDLER_RE = /\bon\w+\s*=\s*(['"]?).*?\1/gi;

/**
 * Sanitize a text string for safe storage and rendering.
 * @param {string} text - Raw user input
 * @param {object} [opts]
 * @param {number} [opts.maxLength=10000] - Truncate beyond this length
 * @returns {string} Sanitized text
 */
function sanitizeText(text, opts = {}) {
  if (!text || typeof text !== "string") return "";

  const maxLength = opts.maxLength || 10000;

  let clean = text;

  // Strip HTML tags
  clean = clean.replace(HTML_TAG_RE, "");

  // Strip dangerous URI schemes
  clean = clean.replace(DANGEROUS_URI_RE, "");

  // Strip event handlers
  clean = clean.replace(EVENT_HANDLER_RE, "");

  // Normalize unicode control characters (keep newlines, tabs)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Truncate
  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength);
  }

  return clean.trim();
}

/**
 * Sanitize a display name — more restrictive.
 */
function sanitizeName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .replace(HTML_TAG_RE, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 100);
}

module.exports = { sanitizeText, sanitizeName };
