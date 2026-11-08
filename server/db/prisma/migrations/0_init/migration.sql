-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin', 'moderator');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('online', 'away', 'offline', 'do_not_disturb');

-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('direct', 'group');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'voice', 'image', 'video', 'file', 'system');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('sending', 'sent', 'delivered', 'seen');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "PairingStatus" AS ENUM ('pending', 'approved', 'consumed', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255),
    "phone_number" VARCHAR(20),
    "password_hash" VARCHAR(255),
    "display_name" VARCHAR(100) NOT NULL,
    "avatar_url" VARCHAR(500),
    "bio" VARCHAR(500) NOT NULL DEFAULT '',
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'offline',
    "primary_lang" VARCHAR(10) NOT NULL DEFAULT 'en',
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" UUID NOT NULL,
    "type" "ChatType" NOT NULL DEFAULT 'direct',
    "name" VARCHAR(200),
    "description" VARCHAR(500),
    "avatar_url" VARCHAR(500),
    "created_by" UUID,
    "disappearing_timer" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "receive_lang" VARCHAR(10),
    "auto_translate" BOOLEAN NOT NULL DEFAULT true,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "last_read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hidden_at" TIMESTAMPTZ,
    "cleared_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "favorited_at" TIMESTAMPTZ,

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reply_to_id" UUID,
    "edited_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_receipts" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'sent',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "source_lang" VARCHAR(10) NOT NULL,
    "target_lang" VARCHAR(10) NOT NULL,
    "translated_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_tokens" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "nonce_hash" VARCHAR(255) NOT NULL,
    "device_label" VARCHAR(120),
    "status" "PairingStatus" NOT NULL DEFAULT 'pending',
    "approved_user_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_users" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hidden_messages" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "starred_messages" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "starred_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_messages" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "pinned_by" UUID NOT NULL,
    "pinned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_lists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chat_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_list_members" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL DEFAULT 'verify',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "chats_type_idx" ON "chats"("type");

-- CreateIndex
CREATE INDEX "chat_members_chat_id_idx" ON "chat_members"("chat_id");

-- CreateIndex
CREATE INDEX "chat_members_user_id_idx" ON "chat_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_members_chat_id_user_id_key" ON "chat_members"("chat_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_chat_id_created_at_idx" ON "messages"("chat_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "message_receipts_message_id_idx" ON "message_receipts"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_receipts_message_id_user_id_key" ON "message_receipts"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "translations_message_id_idx" ON "translations"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "translations_message_id_target_lang_key" ON "translations"("message_id", "target_lang");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_tokens_code_key" ON "pairing_tokens"("code");

-- CreateIndex
CREATE INDEX "pairing_tokens_code_idx" ON "pairing_tokens"("code");

-- CreateIndex
CREATE INDEX "pairing_tokens_status_idx" ON "pairing_tokens"("status");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "blocked_users_blocker_id_idx" ON "blocked_users"("blocker_id");

-- CreateIndex
CREATE INDEX "blocked_users_blocked_id_idx" ON "blocked_users"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_users_blocker_id_blocked_id_key" ON "blocked_users"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- CreateIndex
CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");

-- CreateIndex
CREATE INDEX "hidden_messages_user_id_idx" ON "hidden_messages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "hidden_messages_message_id_user_id_key" ON "hidden_messages"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "starred_messages_user_id_idx" ON "starred_messages"("user_id");

-- CreateIndex
CREATE INDEX "starred_messages_message_id_idx" ON "starred_messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "starred_messages_message_id_user_id_key" ON "starred_messages"("message_id", "user_id");

-- CreateIndex
CREATE INDEX "pinned_messages_chat_id_idx" ON "pinned_messages"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "pinned_messages_chat_id_message_id_key" ON "pinned_messages"("chat_id", "message_id");

-- CreateIndex
CREATE INDEX "chat_lists_user_id_idx" ON "chat_lists"("user_id");

-- CreateIndex
CREATE INDEX "chat_list_members_list_id_idx" ON "chat_list_members"("list_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_list_members_list_id_chat_id_key" ON "chat_list_members"("list_id", "chat_id");

-- CreateIndex
CREATE INDEX "idx_otp_codes_phone" ON "otp_codes"("phone", "purpose", "consumed");

-- CreateIndex
CREATE INDEX "idx_otp_codes_expires" ON "otp_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_approved_user_id_fkey" FOREIGN KEY ("approved_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hidden_messages" ADD CONSTRAINT "hidden_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_messages" ADD CONSTRAINT "starred_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_messages" ADD CONSTRAINT "starred_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_pinned_by_fkey" FOREIGN KEY ("pinned_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_lists" ADD CONSTRAINT "chat_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_list_members" ADD CONSTRAINT "chat_list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "chat_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

