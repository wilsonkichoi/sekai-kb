// workers/lib/ratelimit.mjs -- the exact rolling-window rate limit shared by every
// public Worker that spends a metered resource.
//
// Two Workers need it for the same reason: workers/chat/ and workers/mcp/ both call
// Workers AI on an endpoint anyone can reach, and both draw on ONE account-wide
// 10k-neuron/day free-tier allowance. A limit implemented twice is a limit that drifts
// twice, and the D1 schema behind it (migrations/0001_init.sql, identical in both
// Workers) is the part that must not.
//
// Cloudflare's native Rate Limiting binding supports only 10- or 60-second periods, so
// it cannot express the configurable 3,600-second EXACT rolling window this implements
// on D1 instead.
//
// The key is `sha256(address + salt)`, never the address: per public address, not per
// person. Everyone behind one NAT -- a hotspot, a cafe, a school, a group standing at
// one QR placement -- shares one budget, which is why the ceiling is instance-tunable.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

/**
 * The statements, against migrations/0001_init.sql.
 *
 * They live in their own module (rather than beside a Worker's request handler) so a
 * test can execute them without importing a Worker that loads the gitignored corpus
 * artifact at module scope. Each Worker re-exports this object, so the string IDENTITY
 * the D1 test stub routes on stays a single instance per process.
 */
export const SQL = {
  RATE_LIMIT_PRUNE: `
    DELETE FROM submission_window
    WHERE ip_hash = ?1 AND (window_start <= ?2 OR count <= 0)
  `,
  RATE_LIMIT_RECORD: `
    INSERT INTO submission_window (ip_hash, window_start, count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
  `,
  RATE_LIMIT_COUNT: `
    SELECT SUM(count) AS total, MIN(window_start) AS oldest
    FROM submission_window
    WHERE ip_hash = ?1
  `,
  RATE_LIMIT_RELEASE: `
    UPDATE submission_window
    SET count = count - 1
    WHERE ip_hash = ?1 AND window_start = ?2 AND count > 0
  `,
};

export const DEFAULT_RATE_LIMIT_MAX = 20;
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600;

/** A positive-integer deploy var, falling back on anything unparseable or non-positive. */
export function positiveIntVar(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** `sha256(address + salt)`, hex. The raw address is never stored or logged. */
export async function hashAddress(address, salt) {
  const bytes = new TextEncoder().encode(`${address}${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Charge one unit against `ipHash`'s rolling window.
 *
 * Returns `{allowed: true}` when the request fits, or
 * `{allowed: false, retryAfterSeconds}` when it does not -- in which case the unit is
 * RELEASED again before returning, so a rejected request does not consume budget and
 * push the caller's recovery time out on every retry.
 *
 * Record-then-count rather than count-then-record: two concurrent requests that both
 * counted first would both see room and both proceed. Recording first makes the count
 * include this request, so the check is against the state the caller actually created.
 */
export async function consumeRateLimit(db, ipHash, options = {}) {
  const {
    max = DEFAULT_RATE_LIMIT_MAX,
    windowSeconds = DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    now = Math.floor(Date.now() / 1000),
  } = options;

  await db.prepare(SQL.RATE_LIMIT_PRUNE).bind(ipHash, now - windowSeconds).run();
  await db.prepare(SQL.RATE_LIMIT_RECORD).bind(ipHash, now).run();
  const usage = await db.prepare(SQL.RATE_LIMIT_COUNT).bind(ipHash).first();
  if (Number(usage?.total ?? 0) <= max) return { allowed: true };

  await db.prepare(SQL.RATE_LIMIT_RELEASE).bind(ipHash, now).run();
  const oldest = Number(usage?.oldest ?? now);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, oldest + windowSeconds - now),
  };
}
