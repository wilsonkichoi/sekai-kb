/**
 * In-memory D1 stub for the feedback worker tests (LB-69 DoD 5).
 *
 * Implements the `prepare(sql) -> { bind(...args) -> { run, first, all } }` subset the
 * worker uses. Statements are routed by *identity* against the worker's exported
 * `SQL.RATE_LIMIT_UPSERT` / `SQL.INSERT_FEEDBACK` strings, never by parsing SQL text, so
 * the stub stays valid however the statements are worded.
 *
 * Test-owned code: it emulates the D1 semantics the contract documents and records every
 * call so tests can assert call counts, bound arguments, and stored rows.
 */

/** Column order of the INSERT_FEEDBACK bind arguments, per the contract. */
export const INSERT_COLUMNS = [
  'id',
  'created_at',
  'page',
  'category',
  'message',
  'contact',
  'user_agent',
  'status',
];

/** Bind-argument names of the RATE_LIMIT_UPSERT statement, per the contract. */
export const RATE_LIMIT_ARGS = ['ip_hash', 'now', 'window_floor'];

const RATE_LIMIT = 'rate_limit';
const INSERT = 'insert';

/**
 * @param {{ RATE_LIMIT_UPSERT: string, INSERT_FEEDBACK: string }} SQL
 *   the worker's exported SQL object; used for identity routing.
 */
export function createD1Stub(SQL) {
  if (
    !SQL ||
    typeof SQL.RATE_LIMIT_UPSERT !== 'string' ||
    typeof SQL.INSERT_FEEDBACK !== 'string'
  ) {
    throw new TypeError('createD1Stub: SQL must expose RATE_LIMIT_UPSERT and INSERT_FEEDBACK strings');
  }
  if (SQL.RATE_LIMIT_UPSERT === SQL.INSERT_FEEDBACK) {
    throw new TypeError('createD1Stub: the two SQL statements must be distinguishable by identity');
  }

  /** @type {Map<string, { window_start: number, count: number }>} */
  const rateLimitRows = new Map();
  /** @type {string[]} every sql string handed to prepare() */
  const prepared = [];
  /** @type {{ kind: string, method: string, args: unknown[] }[]} every executed statement */
  const calls = [];
  /** @type {Record<string, unknown>[]} every row bound to INSERT_FEEDBACK */
  const rows = [];

  function classify(sql) {
    if (sql === SQL.RATE_LIMIT_UPSERT) return RATE_LIMIT;
    if (sql === SQL.INSERT_FEEDBACK) return INSERT;
    throw new Error(`d1 stub: unknown prepared statement (${String(sql).slice(0, 60)})`);
  }

  function applyRateLimit(args) {
    if (args.length !== 3) {
      throw new Error(`d1 stub: RATE_LIMIT_UPSERT expects 3 bind args, got ${args.length}`);
    }
    const [ipHash, now, windowFloor] = args;
    if (typeof ipHash !== 'string' || ipHash.length === 0) {
      throw new Error('d1 stub: RATE_LIMIT_UPSERT ip_hash must be a non-empty string');
    }
    if (!Number.isFinite(now) || !Number.isFinite(windowFloor)) {
      throw new Error('d1 stub: RATE_LIMIT_UPSERT now/window_floor must be finite numbers');
    }
    const stored = rateLimitRows.get(ipHash);
    const next =
      !stored || stored.window_start <= windowFloor
        ? { window_start: now, count: 1 }
        : { window_start: stored.window_start, count: stored.count + 1 };
    rateLimitRows.set(ipHash, next);
    return { ...next };
  }

  function applyInsert(args) {
    if (args.length !== INSERT_COLUMNS.length) {
      throw new Error(
        `d1 stub: INSERT_FEEDBACK expects ${INSERT_COLUMNS.length} bind args, got ${args.length}`,
      );
    }
    const row = {};
    INSERT_COLUMNS.forEach((column, index) => {
      row[column] = args[index];
    });
    rows.push(row);
    return null;
  }

  function makeStatement(kind, args) {
    let executed = false;
    let result;
    const exec = (method) => {
      calls.push({ kind, method, args: [...args] });
      if (!executed) {
        executed = true;
        result = kind === RATE_LIMIT ? applyRateLimit(args) : applyInsert(args);
      }
      return result;
    };
    return {
      async run() {
        const row = exec('run');
        return { success: true, meta: { changes: kind === INSERT ? 1 : 0 }, results: row ? [row] : [] };
      },
      async first() {
        return exec('first');
      },
      async all() {
        const row = exec('all');
        return { success: true, meta: {}, results: row ? [row] : [] };
      },
    };
  }

  return {
    /** sql strings passed to prepare(), in order */
    prepared,
    /** executed statements: { kind, method, args } */
    calls,
    /** rows bound to INSERT_FEEDBACK, keyed by column name */
    rows,
    /** live rate-limit table, keyed by ip hash */
    rateLimitRows,

    prepare(sql) {
      prepared.push(sql);
      const kind = classify(sql);
      return {
        bind(...args) {
          return makeStatement(kind, args);
        },
      };
    },

    /** every executed RATE_LIMIT_UPSERT call */
    get rateLimitCalls() {
      return calls.filter((call) => call.kind === RATE_LIMIT);
    },
    /** every executed INSERT_FEEDBACK call */
    get insertCalls() {
      return calls.filter((call) => call.kind === INSERT);
    },
    /** pre-load a rate-limit row so a test can drive the counter deterministically */
    seedRateLimit(ipHash, row) {
      rateLimitRows.set(ipHash, { window_start: row.window_start, count: row.count });
    },
    /** true when the worker touched D1 in any way (prepare included) */
    get touched() {
      return prepared.length > 0 || calls.length > 0;
    },
  };
}
