const bcrypt = require("bcryptjs");
const config = require("../config");

/**
 * Hash a plain-text password.
 * @param {string} plainText
 * @returns {Promise<string>}
 */
async function hashPassword(plainText) {
  const salt = await bcrypt.genSalt(config.bcrypt.rounds);
  return bcrypt.hash(plainText, salt);
}

/**
 * Compare a plain-text password against a stored hash.
 * @param {string} plainText
 * @param {string} hashed
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainText, hashed) {
  return bcrypt.compare(plainText, hashed);
}

module.exports = {
  hashPassword,
  comparePassword,
};
