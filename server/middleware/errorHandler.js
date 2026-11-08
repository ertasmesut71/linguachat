const config = require("../config");
const ApiError = require("../utils/ApiError");
const sentry = require("../utils/sentry");

/**
 * Global error handling middleware.
 * Must be registered LAST in the Express middleware chain.
 */
function errorHandler(err, req, res, _next) {
  // Default to 500
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal server error";
  let details = err.details || null;

  // If it's not our own ApiError, wrap it
  if (!err.isOperational) {
    console.error("Unhandled error:", err);
    // E11 — report unexpected errors to Sentry (operational ApiErrors are
    // expected and don't need external tracking).
    sentry.captureException(err, {
      tags: { route: req.originalUrl, method: req.method },
      extra: { statusCode, userId: req.userId || null },
    });
    statusCode = 500;
    message =
      config.env === "development"
        ? err.message
        : "An unexpected error occurred";
  }

  const response = {
    status: "error",
    statusCode,
    message,
  };

  if (details) {
    response.details = details;
  }

  // Include stack trace in development
  if (config.env === "development" && !err.isOperational) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 handler for undefined routes. Register before errorHandler.
 */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl}`));
}

module.exports = { errorHandler, notFoundHandler };
