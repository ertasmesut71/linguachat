// Runs before each test file (jest.config.js setupFiles).
// Establishes env vars the server modules require at import time.

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_EXPIRES_IN = "1h";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.BCRYPT_ROUNDS = "4";        // speed up bcrypt in tests
process.env.CLIENT_URL = "http://localhost:5173";
process.env.ANTHROPIC_API_KEY = "";      // mock mode in tests

// Storage: force local filesystem fallback for all tests
process.env.STORAGE_ENDPOINT = "";
process.env.STORAGE_ACCESS_KEY_ID = "";
process.env.STORAGE_SECRET_ACCESS_KEY = "";
process.env.STORAGE_BUCKET = "linguachat-test";

// Silence dotenv warnings
process.env.DOTENV_CONFIG_SILENT = "true";
