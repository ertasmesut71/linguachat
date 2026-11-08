-- ═══════════════════════════════════════════════════════
-- LinguaChat Database Schema (reference)
-- Target: PostgreSQL 15+
-- ═══════════════════════════════════════════════════════

CREATE TYPE user_role AS ENUM ('user', 'admin', 'moderator');
CREATE TYPE user_status AS ENUM ('online', 'away', 'offline', 'do_not_disturb');
CREATE TYPE chat_type AS ENUM ('direct', 'group');
CREATE TYPE message_type AS ENUM ('text', 'voice', 'image', 'video', 'file', 'system');
CREATE TYPE message_status AS ENUM ('sending', 'sent', 'delivered', 'seen');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      VARCHAR(500),
    bio             VARCHAR(500) DEFAULT '',
    role            user_role DEFAULT 'user',
    status          user_status DEFAULT 'offline',
    primary_lang    VARCHAR(10) NOT NULL DEFAULT 'en',
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                chat_type NOT NULL DEFAULT 'direct',
    name                VARCHAR(200),
    description         VARCHAR(500),
    avatar_url          VARCHAR(500),
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            member_role DEFAULT 'member',
    receive_lang    VARCHAR(10),
    auto_translate  BOOLEAN DEFAULT TRUE,
    muted           BOOLEAN DEFAULT FALSE,
    last_read_at    TIMESTAMPTZ DEFAULT NOW(),
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chat_id, user_id)
);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    type            message_type DEFAULT 'text',
    content         TEXT NOT NULL DEFAULT '',
    metadata        JSONB DEFAULT '{}',
    reply_to_id     UUID REFERENCES messages(id),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_chat ON messages(chat_id, created_at DESC);

-- E8 — Full-text search: tsvector column + GIN index + auto-populate trigger.
-- For new databases this runs as part of the initial schema. For existing
-- databases, run this block as a one-time migration.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN (search_vector);

-- Trigger function: populates search_vector from content on INSERT/UPDATE.
-- Uses 'simple' configuration (no stemming) because content can be in any
-- of 30+ languages — Postgres language-specific configs would favor one
-- language. Simple tokenization + GIN still gives massive speedup over ILIKE.
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS NOT NULL AND length(NEW.content) > 0 THEN
    NEW.search_vector := to_tsvector('simple', NEW.content);
  ELSE
    NEW.search_vector := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

-- Backfill existing rows (safe to run multiple times — idempotent).
UPDATE messages SET search_vector = to_tsvector('simple', content)
  WHERE search_vector IS NULL AND content IS NOT NULL AND length(content) > 0;

CREATE TABLE translations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    source_lang     VARCHAR(10) NOT NULL,
    target_lang     VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, target_lang)
);

CREATE TABLE message_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          message_status DEFAULT 'sent',
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE password_reset_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);

CREATE TYPE pairing_status AS ENUM ('pending', 'approved', 'consumed', 'expired');

CREATE TABLE pairing_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              VARCHAR(16) NOT NULL UNIQUE,
    nonce_hash        VARCHAR(255) NOT NULL,
    device_label      VARCHAR(120),
    status            pairing_status NOT NULL DEFAULT 'pending',
    approved_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    consumed_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pairing_tokens_code ON pairing_tokens(code);
CREATE INDEX idx_pairing_tokens_status ON pairing_tokens(status);

CREATE TABLE push_subscriptions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL UNIQUE,
    p256dh       VARCHAR(255) NOT NULL,
    auth         VARCHAR(255) NOT NULL,
    user_agent   VARCHAR(500),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- ─── H: Block / Report (E-item) ───

CREATE TABLE IF NOT EXISTS blocked_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);

CREATE TABLE IF NOT EXISTS reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);

-- ─── Phone-number identity (phone-number-centric onboarding) ───
-- email becomes nullable (existing users keep their email).
-- phone_number is a new optional unique field for phone-based login.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number) WHERE phone_number IS NOT NULL;

-- ─── OTP verification codes (SMS OTP) ───
CREATE TABLE IF NOT EXISTS otp_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       VARCHAR(20) NOT NULL,
    code        VARCHAR(10) NOT NULL,
    purpose     VARCHAR(20) NOT NULL DEFAULT 'verify',  -- verify | login | recovery
    attempts    INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    consumed    BOOLEAN DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone ON otp_codes(phone, purpose, consumed);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON otp_codes(expires_at);

-- ─── Passwordless registration support ───
-- Allow passwordless accounts (phone OTP signup without password).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ─── Per-user "Delete for me" (hides a message from ONE user's view only) ───
CREATE TABLE IF NOT EXISTS hidden_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_hidden_messages_user ON hidden_messages(user_id);

-- ─── Per-user starred messages ───
CREATE TABLE IF NOT EXISTS starred_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_starred_messages_user ON starred_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_starred_messages_message ON starred_messages(message_id);

-- ─── Chat-level pinned messages ───
CREATE TABLE IF NOT EXISTS pinned_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pinned_messages_chat ON pinned_messages(chat_id);

-- ─── Per-user chat visibility (Delete Chat / Clear Chat) ───
-- hidden_at: chat is hidden from user's list (Delete Chat)
-- cleared_at: messages before this timestamp are hidden for user (Clear Chat)
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
