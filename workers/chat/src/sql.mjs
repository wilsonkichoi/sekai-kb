// workers/chat/src/sql.mjs — the rate-limit statements, against migrations/0001_init.sql.
//
// The statements themselves live in workers/lib/ratelimit.mjs, which is where the
// rolling-window implementation that binds them lives too; this module re-exports them
// under the name the chat worker has always used. Two workers now run the same window
// against the same schema (workers/chat/, workers/mcp/), and a second copy of these
// strings would be a second schema contract free to drift from the shipped migration.
//
// They stay reachable WITHOUT importing index.mjs, which loads the gitignored corpus
// artifact at module scope. That import is what makes index.mjs unusable as a plain
// module in a suite with no artifact installed, and two suites installing one would race
// under `node --test`.
//
// index.mjs re-exports this object, so the identity seam the D1 stub routes on is
// unchanged: there is still exactly one string per statement in the process.

export { SQL } from '../../lib/ratelimit.mjs';
