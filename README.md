# LinguaChat

> **Real-time multilingual chat for everyone.**
> Text, voice, video, and document conversations across 30+ languages, translated by Claude on the fly. WhatsApp-style on desktop, tablet, and phone — installable as a PWA, with QR-based desktop login.

LinguaChat lets two or more people chat naturally in their own languages. You write in Turkish, your friend reads in Japanese; she replies in Japanese, you read in Turkish — preserving tone, idioms, and intent. Voice messages are stored and played inline; with an STT provider configured (`STT_PROVIDER=whisper` or `deepgram`) they're also transcribed and translated, otherwise recipients see a clearly-labeled placeholder alongside the playable audio. Live voice calls stream translated subtitles in real time. PDFs, DOCX, XLSX, and images can be summarized, OCR'd, or asked questions of in any language. All without ever leaving the chat.

---

## Table of Contents

1. [Highlights](#highlights)
2. [Feature Tour](#feature-tour)
3. [Architecture](#architecture)
4. [Quick Start — Docker](#quick-start--docker)
5. [Quick Start — Local Development](#quick-start--local-development)
6. [Environment Variables](#environment-variables)
7. [Database](#database)
8. [Storage](#storage)
9. [Test Suite](#test-suite)
10. [REST API Reference](#rest-api-reference)
11. [WebSocket Protocol](#websocket-protocol)
12. [Security Notes](#security-notes)
13. [Mobile & PWA Installation](#mobile--pwa-installation)
14. [QR-Based Desktop Login](#qr-based-desktop-login)
15. [Troubleshooting](#troubleshooting)
16. [Project Layout](#project-layout)
17. [License & Credits](#license--credits)

---

## Highlights

- **Real-time messaging** with sent / delivered / seen receipts, typing indicators, and presence
- **Persistent per-conversation language settings** — your "I want to read in French" preference survives reload, logout, and re-login
- **Group chat** with per-member receive languages — one Turkish speaker and three French speakers all see the conversation in their own language
- **Voice messages** — audio stored and played inline; transcription via OpenAI Whisper or Deepgram when configured (`STT_PROVIDER` env), otherwise a clearly-labeled placeholder
- **Live voice translation** — speak normally, recipients see translated subtitles in real time
- **Document intelligence** — drop in a PDF/DOCX/XLSX/TXT/MD; ask questions in any language; get summaries; extract action items
- **OCR + translation** for images via Claude Vision
- **AI smart replies, tone rewrite (8 tones), grammar fix**
- **Video messages** with native HTML5 controls and range request streaming
- **WhatsApp-style responsive layout** — desktop, tablet, phone
- **Installable as a PWA** on iOS, Android, and desktop Chrome/Edge
- **QR-based desktop login** — scan with your phone, you're signed in
- **Password reset** by email-token (dev mode shows the token inline so you can test without an SMTP server)
- **Web Push notifications** — offline recipients receive native push notifications via VAPID; opt-in via Profile settings; dead subscriptions auto-cleaned
- **Multi-instance ready** — optional Redis pub/sub adapter for horizontal scaling; set `REDIS_URL` and run multiple app instances behind a load balancer; single-instance mode works with zero config
- **Media processing** — image uploads auto-strip EXIF/GPS metadata, auto-rotate, and generate thumbnails via sharp; video uploads probe duration/dimensions and extract poster frames via ffmpeg; both are optional — if the tools are unavailable, originals are served as-is with no errors
- **Full-text search** — message search powered by Postgres `tsvector` + GIN index with ranked results; falls back to `ILIKE` on unmigrated databases or in test environments
- **Error tracking** — opt-in Sentry integration via `SENTRY_DSN`; captures unhandled server errors with route/user context; zero overhead when unconfigured
- **HTTPS-ready nginx** — bundled `nginx.conf` includes a commented TLS server block with Let's Encrypt cert paths; uncomment + mount certs to enable production HTTPS with HTTP→HTTPS redirect; HTTP-only mode works out of the box for local dev
- **Safari-hardened live voice** — honest capability detection for Safari/iOS; auto-restart on Safari's frequent session drops (capped at 50/session); clear user warnings about browser limitations; receiving subtitles works on all browsers
- **Android-ready** — Capacitor wrapper with `com.linguachat.app` package ID, adaptive icons, and a documented path from `npm run android:build` to signed AAB for Play Store upload; see [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md)
- **Phone-number identity + SMS OTP** — three auth paths: email+password, phone+password, and **passwordless phone registration via SMS OTP** (no password required); OTP login for existing accounts; 6-digit codes with 5-min expiry, rate limiting, single-use; test mode + Twilio adapter; email auth fully preserved
- **Contacts sync + invite** — sync device phonebook, paste phone numbers, or sync Google Contacts; matched contacts get "Start Chat", unmatched contacts get "Invite to LinguaChat" via native share sheet (Web Share API), SMS-app link, or clipboard fallback; no automatic paid SMS sent
- **International phone formatting** — country-aware display formatting via `libphonenumber-js` (e.g. `905551234567` → `+90 555 123 45 67`); canonical digits-only storage unchanged; formatting is purely presentational
- **Reconnect state-sync** — close your laptop, reopen 10 minutes later; missed messages replay automatically
- **120+ automated tests** across 9 suites, full request-cycle coverage
- **Production-ready Docker stack** (Postgres + MinIO + Nginx + app)

---

## Feature Tour

### Phase 1 — Foundation
- Email + password registration with bcrypt
- JWT access tokens (7 days by default, configurable via `JWT_EXPIRES_IN`) + refresh tokens (30 days, rotated, stored as sha256 hashes)
- HttpOnly refresh-token cookie
- 32 supported language codes for `primaryLang`
- User profile + avatar upload
- Online/offline/away presence

### Phase 2 — Real-time Messaging
- WebSocket transport with token auth via `?token=` query string
- Send / deliver / seen receipts
- Typing indicators (auto-clear after 3s)
- Direct chats and group chats
- Soft delete with admin replacement text
- Reply-to + message metadata

### Phase 3 — Multilingual Translation
- Per-message translation via Claude API
- Per-recipient routing — each member gets the message in their `receiveLang`
- Sender is **explicitly excluded** from translation (hardening fix for an early enumeration bug)
- Translation cache — once translated, the same `(messageId, targetLang)` pair is reused
- Per-member `autoTranslate` toggle and per-conversation `receiveLang` override
- Mock mode: with no `ANTHROPIC_API_KEY`, the system returns `[LANG] text` placeholders so dev/test work end-to-end

### Phase 4 — Voice Messages
- Browser MediaRecorder → upload → (optional STT) → translate per recipient → store
- Inline waveform UI with play/pause; audio is always playable regardless of STT
- Transcription is pluggable via `STT_PROVIDER` env: `whisper` (OpenAI) or `deepgram`
- Without an STT provider configured, the stored text is a clearly-labeled placeholder (`[Voice message in <lang> — transcription unavailable]`) — recipients still hear the audio
- Whichever text the pipeline produces is then translated per recipient using the normal persistent-conversation-language rule

### Phase 5 — Live Voice Translation
- Browser SpeechRecognition streams partial transcripts via WS
- Server fan-outs translated subtitles to each recipient in their language
- Final + partial subtitle types so recipients see updates in real time

### Phase 6 — AI Tools
- Smart replies (3 contextual suggestions)
- Chat-level summary
- Grammar / spelling fix
- Tone rewrite — 8 tones: `formal`, `casual`, `professional`, `enthusiastic`, `concise`, `polite`, `friendly`, `warm`
- Document intelligence (Part 3 below)

### Hardening (between Phases 6 and Part 1)
- 5 rate limiters: `api`, `auth`, `ai`, `upload`, `voice`, plus the new `mediaRead`
- Helmet headers (CSP off in dev)
- `sanitizeText` / `sanitizeName` — strips HTML/JS/event-handlers, preserves Unicode + emoji
- WebSocket per-event payload size limits
- React `ErrorBoundary` wrapping the whole app
- Mobile-responsive `SidePanel` (340px desktop, full-screen mobile)

### Part 1 — Media Auth Bug Fix
- Root cause: `<img src>` and `<a href>` cannot send `Authorization: Bearer` headers; signed URLs pointed to internal `minio:9000` unreachable from browsers; missing `app.set("trust proxy", 1)` shared rate-limit buckets across users behind nginx
- Fix:
  - `app.set("trust proxy", 1)`
  - `authenticate` middleware accepts `?token=` query string for media routes
  - `mediaReadLimiter` (300 req/min)
  - Controllers always stream via Node by default; only redirect to a signed URL if `STORAGE_PUBLIC_URL` is set
  - Client `mediaUrl(path)` helper appends `?token=` automatically

### Part 2 — Media Enhancements
- Per-MIME size tiers: image 15 MB, video 100 MB, audio/document 25 MB
- New `POST /api/media/upload-stream` (multer disk storage, 100 MB hard cap)
- `GET /api/media/limits` returns the tiers
- Range-request support for video via `getStream()` — `<video controls preload="metadata">` works including seek
- New `MessageType.video` in Prisma + SQL schema + Zod validators
- ClamAV-ready virus-scan stub at `server/utils/virusScan.js`
- Client `MediaUpload.jsx` rewritten with XHR + real progress bar + video preview
- `MessageBubble.jsx` adds inline `<video>` rendering

### Part 3 — Document Intelligence
- `documents.service.js` extracts text from PDF (pdf-parse v2), DOCX (mammoth), XLSX (xlsx → CSV), TXT/MD/JSON/CSV/RTF
- `summarizeFile(fileId, lang)` — cross-lingual structured summary (1-sentence headline + 4-7 bullets + action items)
- `askFile(fileId, question, lang)` — cross-lingual Q&A with hallucination guardrails
- `ocrImage(fileId, lang)` — Claude Vision extracts text + translates
- `extractTasksFromText(text, lang)` returns `[{task, owner, dueDate, priority}]`
- 200 KB extraction cap; long docs are head+tail truncated with a clear marker
- Wired UI: Summarize/Ask buttons on file bubbles, OCR button on image bubbles, three-tab `DocChatPanel` (Summary / OCR / Ask)

### D1 — Test Suite
- Jest + Supertest, 137 tests across 9 suites:
  - `sanitize.test.js` — 12 tests
  - `auth.test.js` — 15 tests
  - `media.test.js` — 20 tests
  - `messages.test.js` — 18 tests
  - `documents.test.js` — 27 tests
  - `translation.test.js` — 9 tests
  - `ws-sync.test.js` — 6 tests (D2)
  - `password-reset.test.js` — 13 tests (D3)
  - `pairing.test.js` — 17 tests (D8)
- Full Express app is built per-test with `tests/helpers/buildApp.js` using an in-memory store (no Postgres needed in CI)

### D2 — WebSocket Reconnect State-Sync
- New WS event `sync:since` with payload `{ lastSeenAt, chatIds? }`
- Replays missed messages as standard `message:new` events (so client logic is unified)
- Cap of 200 messages per chat; emits `sync:truncated` if exceeded
- 14-day lookback floor (anything older requires REST pagination)
- Cached translations only — no surprise API calls on reconnect
- Client persists `lastSeenAt` in `localStorage` and auto-syncs on reconnect

### D3 — Password Reset
- `POST /api/auth/request-password-reset { email }` — same response regardless of whether the email exists (no enumeration)
- `POST /api/auth/reset-password { token, newPassword }` — single-use, 1-hour TTL, sha256 token hash
- Successful reset revokes ALL refresh tokens for the user (force-logout other sessions)
- Requesting a new token invalidates any prior outstanding tokens
- Dev mode: returns the token in the response so you can test without SMTP
- Client `ForgotPasswordPage.jsx` + `ResetPasswordPage.jsx` + Login page link

### D6 — Responsive Layout
- Mobile-first breakpoints: `--bp-sm 480px`, `--bp-md 768px`, `--bp-lg 1024px`, `--bp-xl 1280px`
- `--touch-target: 44px` for WCAG-compliant tap regions on mobile
- `<768px`: sidebar and main pane are mutually exclusive (WhatsApp-style)
- Back button in chat header on mobile, hidden on desktop
- Tablet (`768–1024px`): narrower sidebar (300px) keeps both panes visible

### D7 — Installable PWA
- `manifest.webmanifest` with theme color `#6c5ce7`, standalone display, three icon sizes (192, 512, maskable 512)
- `service-worker.js` caches the app shell, never caches `/api/*` or `/ws`, stale-while-revalidate for static assets
- Production-only registration (no SW in dev to avoid Vite HMR conflicts)
- iOS-specific apple-touch-icon + apple-mobile-web-app-capable meta tags

### D8 — QR-Based Desktop Login
- `POST /api/auth/pairing/create` (public) returns `{ code, nonce, expiresAt }` (5-min TTL)
- `POST /api/auth/pairing/approve { code }` — authenticated mobile flips the token to "approved"
- `POST /api/auth/pairing/poll { code, nonce }` — desktop polls; on approval gets `{ accessToken, refreshToken, user }`
- 8-character base32 codes (no I/L/O/0/1 to avoid visual confusion)
- Sha256-hashed nonce protects against the desktop's QR being read by anyone else
- Single-use: the pairing token transitions `pending → approved → consumed` and can never be reused
- Constant error message for "wrong nonce" and "unknown code" (no enumeration)
- Client `QRLoginPage.jsx` (desktop, qrcode.react QR + 2s polling) and `ScanQRPage.jsx` (mobile)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                       Client (Vite + React)             │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  AppLayout   │  │  Pages      │  │  Stores         │ │
│  │   sidebar    │  │  Login      │  │   authStore     │ │
│  │   ChatList   │  │  Register   │  │   chatStore     │ │
│  │   ChatView   │  │  ForgotPwd  │  │   userStore     │ │
│  │   DocChat    │  │  ResetPwd   │  └─────────────────┘ │
│  │   SidePanel  │  │  QRLogin    │                      │
│  │              │  │  ScanQR     │                      │
│  └──────────────┘  │  Profile    │                      │
│                    └─────────────┘                      │
└────────────┬────────────────────────────┬───────────────┘
             │ HTTPS (REST)               │ WSS (real-time)
             ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│              Server (Express 4 + ws 8)                  │
│                                                         │
│  Middleware: helmet · cors · cookie-parser · ratelim    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  /api/auth          /api/users      /api/chats   │   │
│  │  /api/auth/pairing  /api/messages   /api/voice   │   │
│  │  /api/translate     /api/media      /api/search  │   │
│  │  /api/admin         /api/ai (incl. /files/...)   │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ /ws — single-port WS, 30s heartbeat, 25 MB cap   │   │
│  │ events: message:* · voice:* · typing:* · seen    │   │
│  │         presence:* · sync:since/complete/trunc   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────┬───────────────────────────┬───────────────────┘
          │                           │
          ▼                           ▼
┌──────────────────────┐    ┌─────────────────────────────┐
│   Postgres 16        │    │   Storage abstraction       │
│   via Prisma         │    │   ┌─────────────────────┐   │
│                      │    │   │ Local FS (default)  │   │
│   users · chats      │    │   │  server/data/       │   │
│   chat_members       │    │   ├─────────────────────┤   │
│   messages           │    │   │ S3 / R2 / MinIO     │   │
│   message_receipts   │    │   │  (env-driven)       │   │
│   translations       │    │   └─────────────────────┘   │
│   refresh_tokens     │    └─────────────────────────────┘
│   password_reset_*   │
│   pairing_tokens     │    ┌─────────────────────────────┐
└──────────────────────┘    │   Anthropic Claude API      │
                            │   (translation, OCR,        │
                            │    summarize, smart replies,│
                            │    grammar, tone, tasks)    │
                            │   — optional; falls back    │
                            │     to mock mode without    │
                            └─────────────────────────────┘
```

---

## Quick Start — Docker

The recommended way to run LinguaChat. Brings up app + postgres + minio + nginx in one command.

```bash
# 1. Clone and enter the repo
git clone <repo-url> linguachat
cd linguachat

# 2. Create .env from the template
cp .env.production .env
# Edit .env: set JWT_SECRET to a random 64+ char string,
# set ANTHROPIC_API_KEY to enable real AI features (optional)

# 3. Build and start
docker compose build
docker compose up -d

# 4. Watch logs
docker compose logs -f app

# 5. Open the app
open http://localhost            # nginx serves the client + proxies /api + /ws

# 6. (Optional) Seed demo accounts
docker compose exec app npm run seed

# 7. Stop
docker compose down

# 8. Stop and wipe data (fresh start)
docker compose down -v
```

The docker-entrypoint script auto-runs `prisma migrate deploy` on container start, so the database is always up to date.

For dev with just the databases (run app/client outside Docker):

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + minio only
npm install
cd client && npm install && cd ..
npm run dev
```

---

## Quick Start — Local Development

Without Docker, you'll need Node 18+, Postgres 14+, and (optionally) MinIO or S3 credentials.

```bash
# 1. Install
npm install
cd client && npm install && cd ..

# 2. Configure
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, etc.

# 3. Initialize the database
npm run db:push           # for fresh dev — pushes schema directly
# or:
npm run db:migrate        # for proper migrations

# 4. Seed demo accounts
npm run seed

# 5. Run server + client together
npm run dev

# Server:    http://localhost:4000
# Client:    http://localhost:5173 (Vite dev)
# Combined:  use docker compose for the prod-like nginx-fronted setup
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables strict cookies, disables dev features |
| `PORT` | `4000` | HTTP server port (inside the container under docker-compose; nginx fronts this on :80) |
| `CLIENT_URL` | `http://localhost:5173` | CORS origin allowed for the client |
| `DATABASE_URL` | (required) | Postgres connection string, e.g. `postgresql://user:pass@localhost:5432/linguachat` |
| `JWT_SECRET` | (required) | 64+ char random string for signing access + refresh tokens |
| `JWT_EXPIRES_IN` | `7d` | Access-token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh-token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing rounds (4 in tests for speed) |
| `ANTHROPIC_API_KEY` | (empty) | Enables real Claude translation/OCR/summary. Empty = mock mode |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Claude model identifier |
| `STORAGE_ENDPOINT` | (empty) | Set to MinIO/R2/S3 URL to use cloud storage; empty = local FS |
| `STORAGE_ACCESS_KEY_ID` | (empty) | Cloud storage access key |
| `STORAGE_SECRET_ACCESS_KEY` | (empty) | Cloud storage secret |
| `STORAGE_BUCKET` | `linguachat` | Bucket / container name |
| `STORAGE_REGION` | `auto` | S3-style region (use `auto` for Cloudflare R2; real region for AWS S3) |
| `STORAGE_PUBLIC_URL` | (empty) | Public-facing URL of the bucket. If set, server can redirect to signed URLs instead of streaming through Node |
| `RATE_LIMIT_API` | `100` per min | General API limit |
| `RATE_LIMIT_AUTH` | `10` per min | Stricter auth-route limit |
| `RATE_LIMIT_AI` | `30` per min | AI-route limit (translate, summarize, etc.) |
| `RATE_LIMIT_UPLOAD` | `20` per min | Upload limit |
| `RATE_LIMIT_VOICE` | `30` per min | Voice-message limit |
| `RATE_LIMIT_MEDIA_READ` | `300` per min | Media read limit (Part 1 — high to allow inline `<img src>`) |
| `SMTP_HOST` | (empty) | SMTP server for password-reset emails. Without this, emails are logged to stdout in log-only mode (safe for dev/CI). |
| `SMTP_PORT` | `587` | SMTP port. Use 465 with `SMTP_SECURE=true` for implicit TLS. |
| `SMTP_SECURE` | `false` | Set to `true` to force implicit TLS (port-465 style). STARTTLS on 587 works with the default. |
| `SMTP_USER` | (empty) | SMTP auth username. Required by most providers. |
| `SMTP_PASS` | (empty) | SMTP auth password / API key. |
| `SMTP_FROM` | `LinguaChat <no-reply@linguachat.local>` | Default `From:` header on outgoing mail. Set to your verified sender address in production. |
| `VAPID_PUBLIC_KEY` | (empty) | Base64url-encoded VAPID public key for Web Push. Generate with `npx web-push generate-vapid-keys`. Empty = push disabled. |
| `VAPID_PRIVATE_KEY` | (empty) | Base64url-encoded VAPID private key (server-side only; never expose to clients). |
| `VAPID_SUBJECT` | `mailto:admin@linguachat.local` | Contact URL or mailto for the VAPID key owner. Required by push services. |
| `REDIS_URL` | (empty) | Redis connection URL for multi-instance WS scaling. Empty = in-process EventEmitter (single-instance, zero overhead). Example: `redis://localhost:6379` |
| `SENTRY_DSN` | (empty) | Sentry project DSN for error tracking. Empty = disabled (no-op, zero overhead). Only unhandled (non-operational) errors are captured. |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` | Sentry environment tag override. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | Performance tracing sample rate (0.0–1.0). Set to `0.1` for 10% sampling in production. |
| `SMS_PROVIDER` | `test` | SMS delivery provider for OTP codes. `test` = log to console (dev), `twilio` = real SMS via Twilio API. |
| `TWILIO_ACCOUNT_SID` | (empty) | Twilio Account SID. Required when `SMS_PROVIDER=twilio`. |
| `TWILIO_AUTH_TOKEN` | (empty) | Twilio Auth Token. Required when `SMS_PROVIDER=twilio`. |
| `TWILIO_FROM_NUMBER` | (empty) | Twilio sender phone number (E.164 format). Required when `SMS_PROVIDER=twilio`. |
| `VITE_GOOGLE_CLIENT_ID` | (empty) | Google OAuth 2.0 Client ID for Google Contacts sync. Without it, the Google tab is hidden. Enable "People API" in your Google Cloud project. |

For Docker deployment, see `.env.production` for the full set with sensible defaults.

---

## Database

Prisma is the source of truth. Schema lives at `server/db/prisma/schema.prisma`. The same schema is mirrored in `server/db/schema.sql` for human reference.

```bash
# Dev — direct push (no migration history)
npm run db:push

# Prod — proper migrations
npm run db:migrate            # creates a new migration locally
npm run db:migrate:prod       # applies pending migrations (run by docker-entrypoint)

# Reset (wipes all data!)
npm run db:reset

# Visual inspector
npm run db:studio
```

Tables:

| Table | Purpose |
|---|---|
| `users` | Email + bcrypt hash + display info + primary language |
| `chats` | Direct or group chat metadata |
| `chat_members` | User ↔ chat membership with `receive_lang`, `auto_translate`, `muted` |
| `messages` | Text / voice / image / video / file / system messages |
| `message_receipts` | Per-user read state (sent / delivered / seen) |
| `translations` | Cached `(message_id, target_lang) → translated_text` |
| `refresh_tokens` | sha256-hashed refresh tokens, rotation + revocation |
| `password_reset_tokens` | sha256-hashed reset tokens (D3) |
| `pairing_tokens` | QR pairing codes + nonce hashes (D8) |

---

## Storage

LinguaChat abstracts storage behind `server/utils/storage.js`. Set the env vars and the right backend takes over:

| Backend | How to enable | Notes |
|---|---|---|
| **Local filesystem** (default) | Leave `STORAGE_ENDPOINT` empty | Files go to `server/data/uploads/`. Convenient for dev. Not for prod beyond a single instance. |
| **MinIO** | `STORAGE_ENDPOINT=http://minio:9000` plus access keys | Used in `docker-compose.yml`. Self-hosted, S3-compatible. |
| **AWS S3** | `STORAGE_ENDPOINT=https://s3.amazonaws.com` plus AWS keys + region | Standard AWS S3. |
| **Cloudflare R2** | `STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com` | S3-compatible, zero egress fees. |

For all backends, the server streams files through Node by default and gates with `?token=` (Part 1 fix). Set `STORAGE_PUBLIC_URL=https://media.example.com` to opt into 302-redirecting to signed URLs instead.

---

## Test Suite

```bash
npm test                                  # all 137 tests
npm test -- tests/server/auth.test.js     # one suite
npm test -- --watch                       # TDD mode
```

Coverage by suite:

| Suite | Tests | What it locks in |
|---|---|---|
| `sanitize.test.js` | 12 | XSS strip, unicode preservation, length truncation |
| `auth.test.js` | 15 | Register, login, refresh-token rotation, /me with Bearer |
| `media.test.js` | 20 | Part 1 auth (Bearer + ?token=), Part 2 size tiers, MIME whitelist, Content-Disposition |
| `messages.test.js` | 18 | Send (text/image/video), list, mark-seen, sanitization on save, membership 403s |
| `documents.test.js` | 27 | Part 3 extractors (TXT/JSON/MD/XLSX), summarize, ask, OCR, all 8 tones |
| `translation.test.js` | 9 | Sender-skip (hardening fix), `autoTranslate=false`, per-recipient lang, cache |
| `ws-sync.test.js` | 6 | D2 reconnect: chronological replay, own-msg exclusion, expiry floor, 200-cap, chatIds filter, probe rejection |
| `password-reset.test.js` | 13 | D3: no enumeration, dev-token, single-use, expiry, weak-password rejection, refresh revoke |
| `pairing.test.js` | 17 | D8: create / approve / poll, wrong nonce 401, expired 400, double-consume, end-to-end flow |
| **Total** | **137** | |

Tests use an in-memory store (`tests/helpers/buildApp.js`) so no Postgres is needed. `ANTHROPIC_API_KEY` is set to empty in `tests/helpers/env.js` so AI calls fall back to deterministic mocks.

---

## REST API Reference

All endpoints prefixed with `/api`. JSON in/out unless noted.

### Auth

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| `POST` | `/auth/register` | — | `{ email, password, displayName, primaryLang? }` |
| `POST` | `/auth/login` | — | `{ email, password }` |
| `POST` | `/auth/refresh` | cookie | Reads HttpOnly `refreshToken` cookie |
| `POST` | `/auth/logout` | Bearer | Revokes the current refresh token |
| `GET`  | `/auth/me` | Bearer | Returns current user |
| `POST` | `/auth/request-password-reset` | — | `{ email }` — same response regardless of existence |
| `POST` | `/auth/reset-password` | — | `{ token, newPassword }` — single-use, 1h TTL |
| `POST` | `/auth/pairing/create` | — | `{ deviceLabel? }` → `{ code, nonce, expiresAt }` (D8) |
| `POST` | `/auth/pairing/approve` | Bearer | `{ code }` — mobile approves desktop QR |
| `POST` | `/auth/pairing/poll` | — | `{ code, nonce }` → `{ status: 'pending' }` or `{ status:'approved', accessToken, refreshToken, user }` |

### Users

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users` | List (excluding self), supports `?search=` |
| `GET` | `/users/:id` | Single user |
| `PATCH` | `/users/me` | Update displayName, bio, primaryLang, avatarUrl |

### Chats

| Method | Path | Notes |
|---|---|---|
| `GET` | `/chats` | List user's chats |
| `POST` | `/chats/direct` | `{ otherUserId }` — find or create |
| `POST` | `/chats/group` | `{ name, description?, memberIds[] }` |
| `GET` | `/chats/:id` | Get chat with members |
| `PATCH` | `/chats/:id` | Update name/description |
| `POST` | `/chats/:id/members` | Admin: add member |
| `DELETE` | `/chats/:id/members/:userId` | Admin: remove member |
| `PATCH` | `/chats/:id/members/me` | Update own `receiveLang`, `autoTranslate`, `muted` |

### Messages

| Method | Path | Notes |
|---|---|---|
| `POST` | `/chats/:chatId/messages` | `{ content, type, metadata?, replyToId? }` |
| `GET` | `/chats/:chatId/messages` | `?limit=N&before=ISODate` |
| `POST` | `/chats/:chatId/seen` | Mark all messages seen |
| `POST` | `/messages/:messageId/seen` | Mark one |

### Media

| Method | Path | Notes |
|---|---|---|
| `POST` | `/media/upload` | base64 JSON: `{ data, originalName, mimeType }` |
| `POST` | `/media/upload-stream` | multipart/form-data; for files > ~22 MB |
| `GET` | `/media/:fileId` | Inline view; **accepts `?token=`** (Part 1) |
| `GET` | `/media/:fileId/download` | Force-attachment; **accepts `?token=`** |
| `GET` | `/media/limits` | Returns `{ image, video, document }` size limits |

### AI

| Method | Path | Notes |
|---|---|---|
| `GET` | `/ai/chats/:chatId/smart-replies` | 3 contextual replies in user's lang |
| `GET` | `/ai/chats/:chatId/summary` | 3-5 bullet summary |
| `GET` | `/ai/chats/:chatId/tasks` | Extracted action items array |
| `POST` | `/ai/rewrite` | `{ text, tone, lang? }` — tone ∈ formal/casual/professional/enthusiastic/concise/polite/friendly/warm |
| `POST` | `/ai/grammar` | `{ text, lang? }` |
| `POST` | `/ai/files/:fileId/summarize` | `{ lang?, chatId? }` |
| `POST` | `/ai/files/:fileId/ask` | `{ question, lang?, chatId? }` |
| `POST` | `/ai/files/:fileId/ocr` | `{ lang?, chatId? }` (image only) |

### Translation

| Method | Path | Notes |
|---|---|---|
| `POST` | `/translate` | `{ text, sourceLang, targetLang }` |

### Search & Admin

| Method | Path | Notes |
|---|---|---|
| `GET` | `/search/messages?chatId=...&q=...` | Full-text search within a chat |
| `POST` | `/contacts/match` | Bulk phone match — find registered users from a list of phone numbers |
| `POST` | `/admin/messages/:id/delete` | Admin soft-delete |
| `POST` | `/admin/users/:id/ban` | (Stub) admin moderation |

---

## WebSocket Protocol

Connect: `wss://host/ws?token=<JWT>` — token MUST be a valid access token.

All frames are JSON: `{ event: string, payload: object }`.

### Client → Server events

| Event | Payload | Effect |
|---|---|---|
| `message:send` | `{ chatId, content, type, metadata?, tempId }` | Send text/image/video/file. Server saves, translates per recipient, broadcasts `message:new` to others, replies to sender with `message:sent` |
| `voice:send` | `{ chatId, audio, mimeType, duration, tempId }` | Voice. Same fan-out as text |
| `voice:live:start` | `{ chatId }` | Begin live voice session |
| `voice:live:chunk` | `{ transcript, isFinal }` | Streamed transcript chunk |
| `voice:live:stop` | `{ chatId }` | End session |
| `chat:open` | `{ chatId }` | Mark chat active for this connection (auto-mark-seen) |
| `chat:close` | `{}` | Clear active chat |
| `typing:start` | `{ chatId }` | Auto-clears after 3s |
| `typing:stop` | `{ chatId }` | Explicit stop |
| `message:seen` | `{ chatId }` or `{ messageId }` | Bulk or single mark-seen |
| `settings:update` | `{ chatId, receiveLang?, autoTranslate? }` | Update per-chat membership |
| `sync:since` | `{ lastSeenAt, chatIds? }` | **D2** Replay missed messages since `lastSeenAt` |

### Server → Client events

| Event | Payload | Notes |
|---|---|---|
| `presence:init` | `{ onlineUsers: { [userId]: status } }` | On connect |
| `presence:update` | `{ userId, status }` | When someone goes on/offline |
| `message:new` | `{ message, _replayed? }` | Message destined for this user (real-time or D2 replay) |
| `message:sent` | `{ message, tempId, translations }` | Echo to sender with per-recipient translations |
| `message:status` | `{ messageId?, chatId, status, userId, bulk? }` | Receipt update (sent/delivered/seen) |
| `message:error` | `{ tempId, error }` | Send failed |
| `voice:live:ready` | `{ chatId }` | Live session opened |
| `voice:live:subtitle` | `{ chatId, userId, originalText, translatedText, sourceLang, targetLang, isFinal }` | Per-recipient subtitle |
| `voice:live:started` / `voice:live:stopped` | `{ chatId, userId, ... }` | Notification |
| `typing:update` | `{ chatId, userId, isTyping }` | Typing indicator |
| `settings:updated` | `{ chatId, receiveLang, autoTranslate }` | Confirmation |
| `sync:complete` | `{ at, since, chatsSynced, totalMessages }` | **D2** Reconnect sync done |
| `sync:truncated` | `{ chatIds, capPerChat, message }` | **D2** > 200 messages missed in these chats — fetch via REST |
| `error` | `{ message }` | Generic WS error |

Per-event payload size limits (`EVENT_SIZE_LIMITS`) enforced server-side.

---

## Security Notes

- **Passwords** — bcrypt hashed (12 rounds default, 4 in tests for speed)
- **JWTs** — Access tokens (7 days by default, configurable via `JWT_EXPIRES_IN`) carry `sub` and `role`; refresh tokens (30d) are sha256-hashed at rest, rotated on every refresh, and revoked on password reset
- **Refresh-token reuse detection** — using a revoked refresh token revokes ALL refresh tokens for that user (treated as a possible token-theft scenario)
- **CSRF** — Refresh-token cookie is HttpOnly + SameSite=strict in production (lax in dev). Access tokens travel in `Authorization: Bearer`, never in cookies
- **Helmet** — full default headers including HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff
- **Rate limits** — separate limiters per route group; `trust proxy: 1` so per-IP buckets work behind nginx
- **Input sanitization** — `sanitizeText` strips `<script>`, all HTML tags, `javascript:` URIs, `data:` URIs, event-handler attributes; preserves Unicode, emoji, newlines; caps at 10000 chars
- **MIME whitelist** — only known image/audio/video/document MIME types accepted; `.exe` and friends rejected at the upload boundary
- **Per-MIME size tiers** — images 15 MB, videos 100 MB, documents 25 MB
- **Media auth** — every media URL requires either `Authorization: Bearer` or `?token=` (Part 1)
- **Password reset** — same response shape regardless of whether the email exists (no enumeration); single-use tokens; 1-hour TTL; successful reset revokes all refresh tokens
- **QR pairing** — codes are 8 chars from a 30-char alphabet (~6.5e11 space); nonces are 32 random bytes hashed with sha256; "unknown code" and "wrong nonce" return identical 401 responses; tokens are single-use; 5-minute TTL
- **WebSocket auth** — token validated on the URL query string; closed with code 4001 on auth failure (client interprets this as "do not auto-reconnect")
- **WebSocket payload caps** — every event has a max-bytes ceiling (`message:send` 50 KB, `voice:send` 25 MB, etc.)
- **Translation** — sender is **explicitly** excluded from per-recipient translation (was a regression in Phase 6, fixed in hardening; locked in by `translation.test.js`)

---

## Mobile & PWA Installation

### iOS (Safari)

1. Open the site in Safari (must be Safari, not Chrome on iOS)
2. Tap the **Share** button at the bottom of the screen
3. Tap **Add to Home Screen**
4. Confirm — the LinguaChat icon appears on your home screen
5. Launch from the home screen — it opens full-screen, no browser chrome

### Android (Chrome / Edge)

1. Open the site in Chrome
2. Tap the menu (⋮) → **Install app** (or **Add to Home screen**)
3. Confirm — LinguaChat installs as a real app
4. Launch from your app drawer

### Desktop (Chrome / Edge)

1. Open the site
2. Click the install icon in the address bar (looks like a small monitor with a download arrow)
3. Click **Install** in the popup
4. The app opens in its own window with no browser tabs

The service worker caches the app shell so subsequent loads are near-instant. `/api` and `/ws` are never cached — live data always hits the server.

---

## Android App (Play Store Distribution)

LinguaChat can be packaged as a native Android app using [Capacitor](https://capacitorjs.com), producing a real AAB/APK suitable for Google Play Store upload or direct device install.

**Quick start (requires Android Studio + Java 17 on your dev machine):**

```bash
cd client
npm install                         # includes @capacitor/core + @capacitor/cli
npm run build                       # build the Vite SPA
npx cap add android                 # one-time: generate the Android project
npx cap sync android                # copy dist/ into the Android project
npx cap open android                # open in Android Studio → Build → Run
```

**For production AAB (Play Store upload):**

```bash
# Set the API URL for the Android build
cp .env.android .env.production     # edit VITE_API_URL to your server

npm run android:build               # builds web + syncs to Android
cd android && ./gradlew bundleRelease
# AAB at: android/app/build/outputs/bundle/release/app-release.aab
```

**Full guide:** see [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md) for signing keys, adaptive icons, Play Store listing, tablet compatibility, push notifications, and live-reload development.

**Key facts:**
- App ID: `com.linguachat.app`
- Min SDK: 22 (Android 5.1+, covers 99%+ of devices)
- Target SDK: 34 (Android 14)
- Tablet: responsive layout adapts automatically (sidebar + chat at ≥768px)
- API URL: set `VITE_API_URL` and `VITE_WS_URL` at build time for production
- Push: existing VAPID web-push works in the Capacitor WebView; FCM is optional

---

## QR-Based Desktop Login

D8 lets a logged-in mobile user sign in to a desktop session by scanning a QR code (or typing an 8-char code).

**On the desktop:**
1. Visit `/qr-login` (or click "Sign in via QR code" on the Login page)
2. A QR code appears, plus an 8-character code
3. The desktop polls the server every 2 seconds

**On the mobile (must already be signed in):**
1. Open the camera and scan the QR — it opens `/scan?code=ABCD1234` in the LinguaChat PWA
2. (Or open `/scan` manually and type the 8-char code)
3. Verify the code matches what's on your desktop, tap **Approve**
4. Done — the desktop receives access + refresh tokens and loads the chat list

Security: 5-minute TTL, single-use, sha256-hashed nonce, identical errors for "unknown code" and "wrong nonce" (no enumeration).

---

## Troubleshooting

**`DATABASE_URL` is invalid / can't connect to Postgres**
- Check Postgres is running (`docker compose ps` or `pg_isready`)
- Confirm the URL format: `postgresql://user:pass@host:5432/dbname`
- For Docker: the host is `postgres` (the service name), not `localhost`

**`ANTHROPIC_API_KEY` not set / translations look like `[JA] hello`**
- That's expected — the system runs in mock mode without a key
- Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env` and restart for real translations

**Password reset emails not arriving**
- Without `SMTP_HOST` set, the app runs in log-only mode: the reset email is printed to the app container's stdout and NOT delivered to the user's inbox. In non-production, the API response also contains `dev.token` for local testing convenience — this is intentional.
- To wire real delivery: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env`, then `docker compose restart app`.
- For providers that require implicit TLS (port 465), also set `SMTP_SECURE=true`.
- Check app logs for `[auth] password-reset email send failed: ...` — the request itself always returns the same "if an account exists..." response (no enumeration), but transport errors surface in logs.
- Also check the user's spam folder; the default `SMTP_FROM` is `no-reply@linguachat.local` which is not a real domain and most providers will filter it — set a verified sender domain in `SMTP_FROM` for production.

**Voice messages show `[Voice message in <lang> — transcription unavailable]`**
- That's expected, not a bug. Speech-to-text is opt-in via `STT_PROVIDER` to keep the app runnable without a second paid API key. The audio still plays normally; only the text transcript is a placeholder.
- To enable real transcription with OpenAI Whisper:
  ```
  STT_PROVIDER=whisper
  OPENAI_API_KEY=sk-...
  OPENAI_WHISPER_MODEL=whisper-1   # optional, this is the default
  ```
- Or with Deepgram:
  ```
  STT_PROVIDER=deepgram
  DEEPGRAM_API_KEY=...
  DEEPGRAM_MODEL=nova-2            # optional, this is the default
  ```
- Restart the app container (`docker compose restart app`) and send a new voice message. Existing messages keep their placeholder; only new ones go through STT.

**Browser shows old cached version after deploying**
- The PWA service worker caches the shell. Bump `CACHE_VERSION` in `client/public/service-worker.js` and redeploy
- Or hard-refresh: Cmd/Ctrl+Shift+R, then close and reopen the tab

**Media URLs return 401 even though I'm logged in**
- The Bearer header is missing. The client should use the `mediaUrl()` helper which appends `?token=` (Part 1 fix)
- If you're testing with curl, pass `?token=$ACCESS_TOKEN`

**WebSocket disconnects keep happening**
- Check nginx config — it must include the upgrade headers (`proxy_http_version 1.1`, `Upgrade`, `Connection "upgrade"`); the bundled `nginx.conf` already does this
- Check the heartbeat — server sends ping every 30s, client must respond with pong (browser does this automatically)

**Tests hang or "Jest did not exit"**
- The WS heartbeat keeps a `setInterval` alive after the test completes. The npm test script uses `--forceExit` to kill it cleanly. If you run jest manually, add `--forceExit`.

**`vite build` warns about dynamic imports of chatStore**
- Pre-existing optimization hint, not an error. Build still succeeds.

**Push notifications not arriving**
- Without `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` set, the server returns 503 from `/api/push/vapid-public-key` and the Profile page push toggle is hidden. Generate keys with `npx web-push generate-vapid-keys` and set both in `.env`.
- Push only fires when the recipient has NO open WebSocket connection (i.e., the app is closed or the tab is not active). If the recipient's tab is open, they receive the message via WS instead — which is the normal path.
- Check browser notification permission: the user must have clicked "Allow" in the browser prompt. If they denied, they need to reset it via browser settings.
- Check app logs for `[push] send failed:` errors — these indicate the web-push library couldn't reach the push service endpoint.
- Stale subscriptions (e.g., after browser reinstall) auto-delete when the push service returns 404 or 410. This is automatic.

**Image thumbnails not generating / no video poster frames**
- Thumbnails and poster frames require `sharp` (npm dep) and `ffmpeg` (system binary) respectively. Both are optional — if unavailable, the original files are served as-is with no error.
- In Docker: the bundled `Dockerfile` installs both automatically (`sharp` via npm, `ffmpeg` via `apk add`).
- For local dev without Docker: `npm install` pulls sharp automatically. For ffmpeg, install via your system's package manager (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Ubuntu/Debian, `apk add ffmpeg` on Alpine).
- Check app logs for `[mediaProcessing] sharp not available` or `[mediaProcessing] ffmpeg/ffprobe not available` to confirm detection status.
- The upload API still succeeds when processing is unavailable — `thumbnailUrl` / `posterUrl` will be `null` in the response instead of a URL.

**Search is slow or not returning expected results**
- By default, message search uses Postgres `tsvector` full-text search with a GIN index for fast ranked results. If the `search_vector` column hasn't been created yet, the system falls back to `ILIKE '%query%'` (slower, no ranking).
- To enable indexed search: run the E8 migration block from `server/db/schema.sql` (the `ALTER TABLE ... ADD COLUMN search_vector` through the `UPDATE messages SET search_vector = ...` backfill). This is idempotent and safe to run multiple times.
- In Docker, the `docker-entrypoint.sh` auto-applies migrations on startup. If you're running manually, execute the SQL block against your database directly.
- The search uses Postgres `simple` text configuration (no language-specific stemming) because messages can be in 30+ languages. This means searches are token-based, not stemmed — "running" won't match "run", but exact words and prefixes work well.

**Errors not appearing in Sentry**
- Without `SENTRY_DSN` set, error tracking is completely disabled (no-op, zero overhead). Set it to your Sentry project DSN and restart.
- Check app logs for `[sentry] Initialized — https://<redacted>@...` on startup to confirm it's active.
- By design, only **unhandled** (non-operational) errors are sent to Sentry. Expected errors like 400 validation failures, 401 auth denials, and 404 not-founds are operational `ApiError` instances and are NOT reported — they would flood Sentry with noise. If you want to track a specific operational error, throw a non-`ApiError` from your handler.
- If using performance tracing, set `SENTRY_TRACES_SAMPLE_RATE` to a value between `0.01` (1%) and `1.0` (100%). Default is `0` (tracing disabled).

**Messages not delivered when running multiple app instances**
- Set `REDIS_URL` to a shared Redis instance (e.g. `redis://redis:6379`). Without it, each Node process has an isolated in-memory WS connection map and cannot relay events to users connected to other instances.
- Watch app logs for `[pubsub] Using Redis at redis://<redacted>@...` to confirm Redis mode is active. If you see no pubsub log, `REDIS_URL` is unset.
- Presence, typing indicators, and message delivery all go through the pub/sub relay. If Redis is down, those features degrade to local-only (same-instance delivery).

**Enabling HTTPS / TLS for production**

**Phone-number registration / login**
- Users can register with **phone number + password** instead of email. Both paths are fully supported side by side.
- Phone numbers are normalized to digits-only storage format (e.g. `+90 555 123 4567` → `905551234567`). The format is E.164-compatible but stored without the `+` prefix.
- Login accepts either email or phone number in the "identifier" field. The server auto-detects which one was entered.
- The registration UI has an Email / Phone toggle. The login UI accepts either format in a single field.
- Phone numbers must be 7–15 digits (after stripping formatting characters) to be considered valid.

**Phone number display formatting**
- Phone numbers are stored canonically as digits-only (e.g. `905551234567`). This is the identity/matching/auth key and is never changed by display formatting.
- For human-readable display, `libphonenumber-js` formats numbers in international style: `+90 555 123 45 67` (Turkish), `+1 202 555 1234` (US), `+44 20 1234 5678` (UK).
- Invalid or unparseable numbers fall back to `+{digits}`. The formatter never throws.
- The system does not automatically detect the user's country. Users enter their full number including country code.

**SMS OTP verification**
- OTP is used for two flows: **passwordless phone registration** and **passwordless login**.
- OTP codes are 6 digits, expire in 5 minutes, single-use, and rate-limited (max 5 requests per phone per 10 minutes, max 5 wrong attempts per code).
- OTP supports three purposes: `verify` (phone ownership confirmation), `login` (passwordless sign-in), and `signup` (passwordless registration — creates account with no password).
- **Passwordless registration flow:** `POST /api/auth/otp/request` with `purpose: "signup"` → 6-digit code sent → `POST /api/auth/otp/verify` with `purpose: "signup"`, `displayName`, `primaryLang` → account created, auth tokens issued. No password required. Signup OTP is rejected if the phone is already registered.
- **Passwordless login flow:** `POST /api/auth/otp/request` with `purpose: "login"` → verify → auth tokens issued. Login OTP is rejected if the phone is not registered.
- **Purpose isolation:** a signup OTP cannot be used for login, and vice versa. Each purpose creates and verifies its own codes independently.
- **Passwordless accounts:** users registered via SMS OTP have no password. Password login against such accounts fails safely with a clear message directing them to OTP login. They can set a password later via the password-reset flow if desired.
- The registration page defaults to "SMS Signup" mode (phone → code → display name → account). Email and Phone+Password modes are available as alternatives.
- **SMS providers:**
  - `SMS_PROVIDER=test` (default): No real SMS sent. OTP code is logged to server console and returned in the API response when `NODE_ENV ≠ production`. Safe for development and testing.
  - `SMS_PROVIDER=twilio`: Sends real SMS via Twilio REST API. Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` env vars.
- **DB migration:** `password_hash` column is now nullable (`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`). Run migrations for existing databases.

**Contacts sync / phone import**
- `POST /api/contacts/match` accepts a list of contacts with phone numbers and returns matched registered LinguaChat users.
- Request format: `{ contacts: [{ name: "Alice", phone: "+90 555 123 4567" }, ...] }`. Max 500 contacts per request.
- Response includes matched users with `id`, `displayName`, `phoneNumber`, `avatarUrl`, `primaryLang`, and the `contactName` from the input list. Email is never leaked.
- The requesting user is excluded from results (won't match against themselves).
- The Import Contacts modal has **three tabs**: Device, Phone Numbers (manual), and Google Contacts.

**Device contacts sync (native)**
- Uses `@capacitor-community/contacts` (v6) to read the phone's address book on Android/iOS.
- The "Device" tab auto-detects whether native contacts access is available via `Capacitor.isNativePlatform()`.
- On native: requests permission → reads contacts (names + phone numbers only) → sends to `POST /api/contacts/match` for bulk matching.
- On web: shows an honest fallback message directing the user to the Phone Numbers or Google tabs.
- **Requires a native Capacitor build** (`npx cap sync android` / `npx cap sync ios`). The plugin is installed as a dependency but cannot function in a plain browser.
- No contact data is stored on the server — phone numbers are used only for matching.

**Google Contacts sync**

**Contact invitations**
- When contacts are imported (via any of the three tabs), the results are split into two sections: "On LinguaChat" (matched) with a "Chat" button, and "Not yet on LinguaChat" (unmatched) with an "Invite" button.
- The Invite button uses the Web Share API (`navigator.share()`) on supported devices, opening the system share sheet so the user can choose SMS, WhatsApp, email, or any other share target. The share payload contains a generic invitation message with the LinguaChat registration URL.
- On desktop browsers without Web Share support, clicking Invite copies the invitation message to the clipboard.
- An SMS-app link (e.g. `sms:+number?body=...`) is also available next to the Invite button, which opens the user's SMS application with a pre-filled message. This uses the user's own SMS — LinguaChat does NOT send paid SMS for invitations.
- The invite URL defaults to `{window.location.origin}/register`. Override with `VITE_INVITE_URL` for custom domains.
- Privacy: no address book data is stored on the server. The `unmatchedContacts` array is returned transiently in the match response for the current request only. No user records are created for unmatched phone numbers.
- The `POST /api/contacts/match` response now includes `unmatchedContacts: [{ contactName, phoneNumber }]` alongside the existing `matched` array.
- The Google tab uses Google Identity Services (GIS) to request an access token with `contacts.readonly` scope. The token is sent to `POST /api/contacts/google-sync`, which fetches contacts via the Google People API, extracts phone numbers, normalizes them, and bulk-matches against registered LinguaChat users.
- **No contact data is stored on the server.** The Google access token is used once for the fetch and then discarded. No refresh tokens are stored.
- Setup: (1) Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com), (2) Enable the "People API", (3) Create an OAuth 2.0 Client ID (Web Application type), (4) Add your domain to Authorized JavaScript origins, (5) Set `VITE_GOOGLE_CLIENT_ID` in your environment.
- If `VITE_GOOGLE_CLIENT_ID` is not set, the Google tab is hidden.
- Privacy: only phone numbers are used for matching. Email is never leaked.

**Docker deployment — nginx serves built frontend**
- The nginx service uses a dedicated `Dockerfile.nginx` that builds the Vite client and copies the dist into the nginx image at build time. No shared volumes or manual file copying needed.
- After `docker compose build && docker compose up -d`, `GET /` returns the LinguaChat frontend. SPA routes (`/login`, `/register`) work via `try_files` fallback.
- To verify: `docker compose exec nginx ls /usr/share/nginx/html/index.html`
- Smoke test: `bash scripts/smoke-test.sh http://localhost`

**Block enforcement**
- Blocking is enforced server-side in all message paths (WebSocket text, voice, and HTTP REST). When a block relationship exists between two users, direct messages are rejected BEFORE persistence, translation, broadcast, or push notification.
- Block is bidirectional: if A blocks B, neither A→B nor B→A direct messages are permitted until unblocked.
- Group messages are unaffected — blocked users can still participate in the same group chat.
- WebSocket blocked sends return `{ code: "USER_BLOCKED" }` error. HTTP blocked sends return 403.

**Enabling HTTPS / TLS for production**
- The bundled `nginx.conf` ships with HTTP-only by default. A fully-configured HTTPS block is included but commented out.
- To enable: (1) obtain a cert with `sudo certbot certonly --standalone -d chat.yourdomain.com`; (2) mount the cert directory into the nginx container by adding `- /etc/letsencrypt:/etc/letsencrypt:ro` to the nginx volumes in `docker-compose.yml`; (3) edit `nginx.conf` — replace `chat.yourdomain.com` with your domain, uncomment the HTTPS server block AND the HTTP→HTTPS redirect block; (4) `docker compose up -d --force-recreate nginx`.
- For cert renewal, certbot's default cron renews automatically; just reload nginx afterward: `docker compose exec nginx nginx -s reload`.
- HSTS is included but commented — only enable it after verifying TLS works, since it's hard to undo.

**Live voice not working on Safari / iOS**
- Safari's `SpeechRecognition` (via `webkitSpeechRecognition`) is significantly limited compared to Chrome/Edge: it stops after every sentence even with `continuous: true`, interim results may not fire, and the session may drop unexpectedly.
- iOS specifically requires HTTPS for microphone access — the app shows a warning if you try to use live voice over plain HTTP on iOS.
- LinguaChat auto-restarts the recognition session when Safari drops it (up to 50 times per session), but the experience will still feel less fluid than on Chrome.
- **Receiving** translated subtitles from other speakers works on all browsers — only the **speaking** (STT) side is affected by Safari's limitations.
- For the best live voice experience, use Chrome or Edge on desktop, or Chrome on Android.

**Large video uploads failing (413 Request Entity Too Large)**
- This was a known issue: the previous `nginx.conf` had `client_max_body_size 30m`, which silently blocked video uploads >30MB despite the app allowing 100MB. Fixed in E12 — now set to `110m`. If you're using a custom nginx.conf, ensure `client_max_body_size` is at least 110m.

**Group chat translation is slow**
- Each recipient's translation is fetched in parallel, but the first time a (text, target_lang) pair is seen the API call adds latency. Subsequent identical translations use the cache and are instant. Bumping `RATE_LIMIT_AI` may help if you're hitting the per-minute ceiling.

---

## Project Layout

```
linguachat/
├── server/
│   ├── index.js                    # Express + WS bootstrap
│   ├── config/                     # Env-driven config
│   ├── db/
│   │   ├── prisma/schema.prisma    # Source of truth for DB schema
│   │   ├── schema.sql              # Mirror for human reference
│   │   ├── store.js                # Prisma-backed data access (32+ methods)
│   │   └── seed.js                 # Demo accounts
│   ├── middleware/                 # auth, validate, rateLimit, errorHandler
│   ├── modules/
│   │   ├── auth/                   # register, login, refresh, password reset, pairing (D8)
│   │   ├── users/                  # profile + listing
│   │   ├── chats/                  # direct + group
│   │   ├── messages/               # send + list + receipts
│   │   ├── translation/            # per-recipient routing
│   │   ├── voice/                  # transcribe + translate
│   │   ├── media/                  # upload + serve + size tiers
│   │   ├── search/                 # FTS-lite via ILIKE
│   │   ├── admin/                  # moderation
│   │   └── ai/
│   │       ├── ai.service.js       # smart replies, summary, tone, grammar
│   │       ├── documents.service.js # Part 3 — PDF/DOCX/XLSX extract + summarize + Q&A + OCR
│   │       ├── ai.controller.js
│   │       └── ai.routes.js
│   ├── ws/socketServer.js          # Real-time + D2 sync:since
│   └── utils/                      # ApiError, hash, jwt, sanitize, storage, virusScan
│
├── client/
│   ├── public/
│   │   ├── manifest.webmanifest    # D7 PWA
│   │   ├── service-worker.js       # D7 PWA
│   │   └── icons/                  # icon-192, icon-512, icon-maskable-512
│   ├── index.html                  # D7 PWA meta tags
│   └── src/
│       ├── main.jsx                # SW registration (production only)
│       ├── App.jsx                 # All routes
│       ├── api/
│       │   ├── client.js           # fetch wrapper, mediaUrl(), token mgmt
│       │   └── socket.js           # WS client + D2 sync anchor
│       ├── store/                  # Zustand: auth, chat, user
│       ├── pages/                  # Login, Register, ForgotPassword, ResetPassword, QRLogin (D8), ScanQR (D8), Profile
│       ├── components/
│       │   ├── AppLayout.jsx       # Sidebar + main pane (D6 mobile-aware)
│       │   ├── chat/               # ChatList, ChatView, MessageBubble, MessageInput, DocChatPanel, etc.
│       │   └── ui/                 # Avatar, SidePanel (D6), Spinner, etc.
│       └── styles/globals.css      # D6 breakpoints + design tokens
│
├── tests/
│   ├── helpers/
│   │   ├── env.js                  # Test env vars
│   │   └── buildApp.js             # In-memory store + Express assembly
│   └── server/                     # 9 suites, 137 tests
│
├── Dockerfile                      # Multi-stage build
├── docker-compose.yml              # Prod: app + postgres + minio + nginx
├── docker-compose.dev.yml          # Dev: postgres + minio only
├── docker-entrypoint.sh            # Auto-runs migrations
├── nginx.conf                      # WS upgrade + rate limit + gzip
├── ecosystem.config.js             # PM2 alternative to Docker
├── jest.config.js
├── package.json
└── README.md
```

---

## License & Credits

This project is built by Mesut and uses:

- **Anthropic Claude** for translation, OCR, summarization, and document Q&A
- **PostgreSQL** + **Prisma** for persistence
- **Express 4** + **ws 8** for HTTP + WebSocket
- **React 18** + **Vite** + **Zustand** + **react-router-dom** for the client
- **qrcode.react** for the D8 QR display
- **lucide-react** for icons
- **DM Sans** + **JetBrains Mono** typefaces from Google Fonts
- **MinIO** / **AWS S3** / **Cloudflare R2** for media storage
- **pdf-parse**, **mammoth**, **xlsx** for document extraction
- **bcryptjs**, **jsonwebtoken**, **helmet**, **express-rate-limit** for security

License: MIT (see LICENSE file in repo root, or contact the owner if missing).
