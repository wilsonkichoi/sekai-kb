-- Exact rolling-window state for the MCP worker's metered tools. Raw IP addresses are
-- never stored; the key is sha256(address + IP_HASH_SALT).
CREATE TABLE IF NOT EXISTS submission_window (
  ip_hash       TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, window_start)
);
