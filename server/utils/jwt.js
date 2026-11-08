const jwt = require("jsonwebtoken");
const config = require("../config");

/**
 * Sign an access token embedding the user id and role.
 * @param {{ id: string, role: string }} payload
 * @returns {string}
 */
function signAccessToken(payload) {
  return jwt.sign(
    { sub: payload.id, role: payload.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Sign a refresh token (longer lived, minimal claims).
 * @param {{ id: string }} payload
 * @returns {string}
 */
function signRefreshToken(payload) {
  return jwt.sign(
    { sub: payload.id, type: "refresh" },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
}

/**
 * Verify and decode a token.
 * @param {string} token
 * @returns {object} decoded payload
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyToken,
};
