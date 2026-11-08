/**
 * Operational error that gets caught by the global error handler
 * and returned as a structured JSON response.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }

  static forbidden(message = "Insufficient permissions") {
    return new ApiError(403, message);
  }

  static notFound(resource = "Resource") {
    return new ApiError(404, `${resource} not found`);
  }

  static conflict(message) {
    return new ApiError(409, message);
  }

  static internal(message = "Internal server error") {
    return new ApiError(500, message);
  }

  static unavailable(message = "Service temporarily unavailable") {
    return new ApiError(503, message);
  }
}

module.exports = ApiError;
