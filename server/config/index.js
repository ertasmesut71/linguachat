const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT, 10) || 4000,

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },

  bcrypt: {
    rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
  },

  client: {
    url: process.env.CLIENT_URL || "http://localhost:5173",
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  },

  storage: {
    // S3/R2/MinIO — leave blank to use local filesystem
    endpoint: process.env.STORAGE_ENDPOINT || "",
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || "",
    bucket: process.env.STORAGE_BUCKET || "linguachat",
    region: process.env.STORAGE_REGION || "auto",

    // OPTIONAL: browser-reachable hostname for generating signed-URL redirects.
    // Leave blank to always stream through Node (safe default — works with
    // internal MinIO in Docker). Set to e.g. "https://media.yourdomain.com"
    // when MinIO/S3 is exposed on a public domain.
    publicUrl: process.env.STORAGE_PUBLIC_URL || "",
  },
};

// Validate required config
const required = ["jwt.secret"];
for (const key of required) {
  const parts = key.split(".");
  let val = config;
  for (const p of parts) val = val?.[p];
  if (!val) {
    console.error(`Missing required config: ${key}`);
    process.exit(1);
  }
}

if (!config.anthropic.apiKey) {
  console.warn("⚠  ANTHROPIC_API_KEY not set — translation will use fallback mock mode");
}

module.exports = config;
