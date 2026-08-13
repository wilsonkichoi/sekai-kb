// workers/feedback/src/sql.mjs -- the statements this worker issues, against
// migrations/0001_init.sql.
//
// They live apart from index.mjs so the test D1 stub can route on string IDENTITY
// without importing the entry module, and because `main` points at index.mjs: the
// Workers runtime rejects any named export from the entry module that is not a handler,
// so `export const SQL = {...}` there fails the isolate at STARTUP with "Incorrect type
// for map entry 'SQL'", before a single request. `node --test` imports the module
// happily and reports green, which is why workers/lib/test/entry-exports.mjs asserts the
// rule instead.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

/**
 * The statements this worker issues, exported so the test D1 stub can route on
 * identity rather than parsing SQL.
 */
export const SQL = {
  // The window is genuinely rolling, not a fixed window anchored at the first hit.
  // submission_window holds one row per (address, second) in which a submission
  // arrived: `window_start` is that second and `count` is how many arrived in it.
  // The limit is then the sum over the rows still inside the window, which is exact
  // at the one-second resolution of the timestamps -- there is no boundary at which
  // a counter resets and lets a second full allowance through.
  //
  // PRUNE, RECORD, COUNT run in that order on every request; a rejected request then
  // runs RELEASE. They need no transaction: PRUNE is idempotent, RECORD is a single
  // atomic upsert, and COUNT runs after this request's own RECORD, so a concurrent
  // request can only make the observed total higher than the true one, never lower.
  // Over-counting rejects; under-counting would over-admit, and that is the direction
  // that must be impossible. RELEASE runs only after this request has already decided
  // to reject, so it can never turn another request's rejection into an acceptance.

  // Also drops exhausted rows (RELEASE can leave a row at zero). A zero row counts
  // nothing but would still answer MIN(window_start), which is what Retry-After is
  // derived from -- so it has to go before COUNT runs, not merely at window expiry.
  RATE_LIMIT_PRUNE: `
    DELETE FROM submission_window
    WHERE ip_hash = ?1 AND (window_start <= ?2 OR count <= 0)
  `,
  RATE_LIMIT_RECORD: `
    INSERT INTO submission_window (ip_hash, window_start, count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(ip_hash, window_start) DO UPDATE SET count = count + 1
  `,
  // Every surviving row is inside the window, because PRUNE just removed the rest.
  // `oldest` is what Retry-After is derived from: the window frees a slot when the
  // oldest surviving second falls out of it.
  RATE_LIMIT_COUNT: `
    SELECT SUM(count) AS total, MIN(window_start) AS oldest
    FROM submission_window
    WHERE ip_hash = ?1
  `,
  // Give back the slot a rejected request took in RECORD. A refused attempt is not a
  // submission, so it must not consume budget: if it did, an address that hit the
  // limit and then obeyed Retry-After would re-record itself on every retry and stay
  // pinned above the limit forever.
  RATE_LIMIT_RELEASE: `
    UPDATE submission_window
    SET count = count - 1
    WHERE ip_hash = ?1 AND window_start = ?2 AND count > 0
  `,
  INSERT_FEEDBACK: `
    INSERT INTO feedback
      (id, created_at, page, category, message, contact, user_agent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
};
