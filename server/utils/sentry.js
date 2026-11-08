/**
 * Sentry error-tracking integration (E11).
 *
 * Configuration (env):
 *   SENTRY_DSN           Sentry project DSN. Without it, all functions
 *                        are no-ops (zero overhead, no errors).
 *   SENTRY_ENVIRONMENT   Override environment tag (default: NODE_ENV).
 *   SENTRY_TRACES_SAMPLE_RATE   Performance tracing rate 0.0–1.0 (default: 0).
 *
 * Usage:
 *   const sentry = require("./utils/sentry");
 *   sentry.init();                        // call once at app startup
 *   sentry.captureException(err);         // in error handlers
 *   sentry.captureMessage("something");   // ad-hoc
 */

let _initialized = false;
let _Sentry = null;

/**
 * Initialize Sentry. Safe to call multiple times (idempotent).
 * No-ops silently if SENTRY_DSN is not set.
 */
function init() {
  if (_initialized) return;
  _initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    _Sentry = require("@sentry/node");
    _Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
      // Don't send breadcrumbs for console.log in dev — too noisy
      integrations: [],
    });
    console.log("[sentry] Initialized —", dsn.replace(/\/\/.*@/, "//<redacted>@"));
  } catch (err) {
    console.error("[sentry] Init failed:", err.message);
    _Sentry = null;
  }
}

/**
 * @returns {boolean} true if Sentry was successfully initialized.
 */
function isActive() {
  return _initialized && _Sentry !== null;
}

/**
 * Report an exception to Sentry. No-op if unconfigured.
 *
 * @param {Error} err
 * @param {object} [context]  Extra context tags/data.
 */
function captureException(err, context) {
  if (!_Sentry) return;
  try {
    if (context) {
      _Sentry.withScope((scope) => {
        if (context.tags) scope.setTags(context.tags);
        if (context.extra) scope.setExtras(context.extra);
        if (context.user) scope.setUser(context.user);
        _Sentry.captureException(err);
      });
    } else {
      _Sentry.captureException(err);
    }
  } catch {}
}

/**
 * Report a message to Sentry. No-op if unconfigured.
 */
function captureMessage(msg, level = "info") {
  if (!_Sentry) return;
  try {
    _Sentry.captureMessage(msg, level);
  } catch {}
}

/**
 * Flush pending events (for graceful shutdown).
 */
async function flush(timeoutMs = 2000) {
  if (!_Sentry) return;
  try {
    await _Sentry.flush(timeoutMs);
  } catch {}
}

/**
 * Reset for tests.
 */
function _resetForTests() {
  _initialized = false;
  _Sentry = null;
}

module.exports = {
  init,
  isActive,
  captureException,
  captureMessage,
  flush,
  _resetForTests,
};
