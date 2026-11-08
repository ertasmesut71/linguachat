/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  rootDir: __dirname,
  testMatch: [
    "<rootDir>/tests/**/*.test.js",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/client/",
    "/server/data/",
  ],
  // Don't transform — we're plain CommonJS on the server
  transform: {},
  setupFiles: ["<rootDir>/tests/helpers/env.js"],
  // Each test file gets a clean module registry so that the fake-prisma
  // injected by buildApp doesn't leak across files.
  resetModules: true,
  clearMocks: true,
  verbose: true,
  testTimeout: 15000,
};
