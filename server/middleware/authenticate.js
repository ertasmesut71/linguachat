const { verifyToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const store = require("../db/store");

/**
 * Extracts JWT from (in order):
 *   1. Authorization: Bearer <token>
 *   2. Cookie: accessToken=<token>
 *   3. Query string: ?token=<token>   (required for media <img src> / <a href>)
 *
 * The query-string fallback exists so that resources loaded via browser-native
 * mechanisms (which CANNOT attach an Authorization header) can still be served
 * behind auth. We accept this small tradeoff for UX + WhatsApp-parity, but we
 * mitigate the logging risk by never logging query strings in our request
 * logger and by using short-lived access tokens.
 *
 * Attaches decoded user to req.user / req.userId.
 */
async function authenticate(req, res, next) {
  try {
    let token = null;

    // 1) Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // 2) Cookie
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    // 3) Query-string token (for <img src> / <a href> style media loads)
    if (!token && req.query?.token && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      throw ApiError.unauthorized("No authentication token provided");
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        throw ApiError.unauthorized("Token has expired");
      }
      throw ApiError.unauthorized("Invalid token");
    }

    // Load user from store
    const user = await store.findUserById(decoded.sub);
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    // Attach to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — attaches user if token present, but doesn't block.
 */
async function optionalAuth(req, res, next) {
  try {
    await authenticate(req, res, () => {});
  } catch {
    // Silently continue without user
  }
  next();
}

/**
 * Role-based authorization. Use after authenticate().
 * @param  {...string} roles - Allowed roles
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of: ${roles.join(", ")}`));
    }
    next();
  };
}

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
};
