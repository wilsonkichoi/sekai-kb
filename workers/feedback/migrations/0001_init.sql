-- 0001_init.sql — the feedback capability's D1 schema.
--
-- Applied with `npx wrangler d1 migrations apply <database-name>` (see
-- docs/runbook/DEPLOY.md §Cloudflare Workers). Carries no place identity.

-- Reader submissions.
-- `status` is the triage lifecycle field: rows land as 'new' and the triage skill
-- moves them from there. No column holds an IP address.
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  page        TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  contact     TEXT,
  user_agent  TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
);

-- The triage skill reads untriaged rows oldest-first; this is the index for that
-- one query shape.
CREATE INDEX IF NOT EXISTS idx_feedback_status_created ON feedback (status, created_at);

-- Rate-limit state, one row per hashed address. `ip_hash` is
-- sha256(CF-Connecting-IP + IP_HASH_SALT) and is the PRIMARY KEY, which is what
-- makes the worker's single-statement `ON CONFLICT(ip_hash)` upsert atomic.
-- `window_start` is unix seconds; `count` is the submissions inside the current
-- window. Nothing here is reversible to an address without the salt.
CREATE TABLE IF NOT EXISTS submission_window (
  ip_hash       TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0
);
