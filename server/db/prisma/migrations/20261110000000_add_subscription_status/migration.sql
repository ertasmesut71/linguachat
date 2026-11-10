-- Billing: subscription status per user (free | active). Non-destructive.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" VARCHAR(20) DEFAULT 'free';
