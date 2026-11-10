// E11 — Sentry must be initialized before any other module loads so it
// can instrument require hooks. Safe no-op if SENTRY_DSN is not set.
const sentry = require("./utils/sentry");
sentry.init();

const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const config = require("./config");
const store = require("./db/store");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { apiLimiter, authLimiter, aiLimiter, uploadLimiter, voiceLimiter, mediaReadLimiter } = require("./middleware/rateLimit");
const authRoutes = require("./modules/auth/auth.routes");
const pairingRoutes = require("./modules/auth/pairing.routes");
const pushRoutes = require("./modules/push/push.routes");
const usersRoutes = require("./modules/users/users.routes");
const chatsRoutes = require("./modules/chats/chats.routes");
const messagesRoutes = require("./modules/messages/messages.routes");
const translationRoutes = require("./modules/translation/translation.routes");
const voiceRoutes = require("./modules/voice/voice.routes");
const mediaRoutes = require("./modules/media/media.routes");
const searchRoutes = require("./modules/search/search.routes");
const contactsRoutes = require("./modules/contacts/contacts.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const aiRoutes = require("./modules/ai/ai.routes");
const billingRoutes = require("./modules/billing/billing.routes");
const { createSocketServer } = require("./ws/socketServer");
const { seed } = require("./db/seed");

const app = express();

// ─── Trust nginx reverse proxy ───
// CRITICAL: behind nginx, req.ip must reflect the real client IP, not the nginx
// container IP. Without this, rate limiters bucket all users together.
app.set("trust proxy", 1);

// ─── Security ───
app.use(helmet({
  contentSecurityPolicy: config.env === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: config.client.url,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Stripe webhook needs the raw body for signature checks; must run before express.json.
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Logger (dev) ───
if (config.env === "development") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const c = res.statusCode >= 400 ? "\x1b[31m" : res.statusCode >= 300 ? "\x1b[33m" : "\x1b[32m";
      console.log(`${c}${req.method}\x1b[0m ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
    });
    next();
  });
}

// ─── Health ───
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok", version: "1.0.0", timestamp: new Date().toISOString(),
    uptime: process.uptime(), env: config.env,
    database: "postgresql",
    translation: config.anthropic.apiKey ? "claude" : "mock",
    ai: config.anthropic.apiKey ? "enabled" : "mock",
  });
});

// ─── Routes with rate limiters ───
// mediaReadLimiter is separate from uploadLimiter because reading media (image
// previews, file downloads) happens far more often than uploads. A single chat
// with 10 images triggers 10 GETs per viewer per load.
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/auth/pairing", authLimiter, pairingRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/users", apiLimiter, usersRoutes);
app.use("/api/chats", apiLimiter, chatsRoutes);
app.use("/api", apiLimiter, messagesRoutes);
app.use("/api/translate", aiLimiter, translationRoutes);
app.use("/api/voice", mediaReadLimiter, voiceRoutes);
app.use("/api/media", mediaReadLimiter, mediaRoutes);
app.use("/api/search", apiLimiter, searchRoutes);
app.use("/api/contacts", apiLimiter, contactsRoutes);
app.use("/api/admin", apiLimiter, adminRoutes);
app.use("/api/ai", aiLimiter, aiRoutes);
app.use("/api/billing", billingRoutes);

// ─── Serve React SPA (production only) ───
if (config.env === "production") {
  const path = require("path");
  const clientDist = path.join(__dirname, "../client/dist");
  app.use(express.static(clientDist, { maxAge: "7d", immutable: true }));
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start ───
async function start() {
  // Verify database connection
  try {
    await store.prisma.$connect();
    console.log("  ✓ PostgreSQL connected");
  } catch (err) {
    console.error("  ✗ Database connection failed:", err.message);
    console.error("    Ensure DATABASE_URL is set and PostgreSQL is running.");
    console.error("    Run: npm run db:push  (to create tables)");
    process.exit(1);
  }

  // Validate critical tables exist
  try {
    const tables = await store.prisma.$queryRawUnsafe(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('users','chats','messages','pairing_tokens','push_subscriptions')
    `);
    const found = new Set(tables.map((t) => t.table_name));
    const required = ["users", "chats", "messages"];
    const missing = required.filter((t) => !found.has(t));
    if (missing.length > 0) {
      console.error(`  ✗ Missing required tables: ${missing.join(", ")}`);
      console.error("    Run: npx prisma migrate deploy --schema=server/db/prisma/schema.prisma");
      console.error("    Or:  npx prisma db push --schema=server/db/prisma/schema.prisma");
      process.exit(1);
    }
    if (!found.has("pairing_tokens")) console.warn("  ⚠ pairing_tokens table missing — QR login will be disabled until migration runs");
    if (!found.has("push_subscriptions")) console.warn("  ⚠ push_subscriptions table missing — push notifications will be disabled until migration runs");
    console.log("  ✓ Database schema validated");
  } catch (err) {
    console.warn("  ⚠ Table validation skipped:", err.message);
  }

  // Seed in development
  if (config.env === "development") {
    try {
      await seed();
    } catch (e) {
      console.warn("  ⚠ Seed skipped:", e.message);
    }
  }

  const server = http.createServer(app);
  createSocketServer(server);

  server.listen(config.port, () => {
    const t = config.anthropic.apiKey ? "Claude API" : "Mock";
    console.log(`
  ┌──────────────────────────────────────────┐
  │  🌐 LinguaChat v1.0                     │
  │                                          │
  │  HTTP:   http://localhost:${String(config.port).padEnd(15)}│
  │  WS:     ws://localhost:${String(config.port + "/ws").padEnd(16)}│
  │  DB:     PostgreSQL ✓                    │
  │  AI/TL:  ${t.padEnd(31)}│
  │  Proxy:  trust=1  Helmet: ✓  RL: ✓      │
  └──────────────────────────────────────────┘
`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n  ${signal} received. Shutting down...`);
    server.close();
    await store.prisma.$disconnect();
    console.log("  ✓ Database disconnected");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((e) => { console.error("Start failed:", e); process.exit(1); });
module.exports = app;
