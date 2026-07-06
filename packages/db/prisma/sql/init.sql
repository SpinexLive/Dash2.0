-- PostgreSQL initialization extras applied after Prisma migrations.
-- Run manually or wire into your migration pipeline.

-- GIN index for fast JSONB queries on match payloads.
CREATE INDEX IF NOT EXISTS idx_matches_payload ON matches USING GIN ("rawPayload");

-- Generated K/D column (Prisma can't express STORED generated columns yet).
-- Add to member_stats if you want DB-computed K/D:
ALTER TABLE member_stats
  ADD COLUMN IF NOT EXISTS kd NUMERIC(6,2)
  GENERATED ALWAYS AS (CASE WHEN deaths = 0 THEN kills ELSE kills::numeric / deaths END) STORED;

-- Trigger to broadcast member creation over LISTEN/NOTIFY for real-time refresh.
CREATE OR REPLACE FUNCTION notify_member_created() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('events', json_build_object(
    'type', 'member.created',
    'userId', NEW."userId"::text
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_member_created ON members;
CREATE TRIGGER trg_member_created
  AFTER INSERT ON members
  FOR EACH ROW EXECUTE FUNCTION notify_member_created();

-- Trigger to broadcast roster slot response changes.
CREATE OR REPLACE FUNCTION notify_roster_updated() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('events', json_build_object(
    'type', 'roster.updated',
    'rosterId', NEW."rosterId"::text,
    'slotId', NEW.id::text,
    'response', NEW.response
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roster_updated ON roster_slots;
CREATE TRIGGER trg_roster_updated
  AFTER UPDATE OF response ON roster_slots
  FOR EACH ROW EXECUTE FUNCTION notify_roster_updated();
