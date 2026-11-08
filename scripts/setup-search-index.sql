-- setup-search-index.sql
-- Non-destructive: safe to run on any existing DB. All statements use IF NOT EXISTS / CREATE OR REPLACE.
-- Run this AFTER `prisma db push` to activate full-text search.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/setup-search-index.sql
--
-- What it does:
--   1. Ensures the search_vector column exists (idempotent)
--   2. Creates the GIN index (idempotent)
--   3. Creates/replaces the trigger function
--   4. Creates/replaces the trigger
--   5. Backfills existing rows where search_vector is NULL
--   6. Backfills edited rows where search_vector may be stale (deletedAt IS NULL)
--
-- This does NOT wipe data. It does NOT use --accept-data-loss.
-- After running, all new inserts and edits auto-update search_vector via the trigger.

-- 1. Column (prisma db push creates this, but include for safety)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. GIN index
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN (search_vector);

-- 3. Trigger function
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

-- 4. Trigger (drop+create is idempotent via DROP IF EXISTS)
DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

-- 5+6. Backfill: populate search_vector for all existing non-deleted messages
UPDATE messages
  SET search_vector = to_tsvector('simple', content)
  WHERE content IS NOT NULL
    AND length(content) > 0
    AND deleted_at IS NULL;

-- Clear search_vector for deleted messages (should not be searchable)
UPDATE messages
  SET search_vector = NULL
  WHERE deleted_at IS NOT NULL
    AND search_vector IS NOT NULL;
