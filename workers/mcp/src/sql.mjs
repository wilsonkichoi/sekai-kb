// workers/mcp/src/sql.mjs — the rate-limit statements, against migrations/0001_init.sql.
//
// The statements live in workers/lib/ratelimit.mjs, shared with workers/chat/; this
// module re-exports them under the name this worker's suite and its D1 stub route on.
// The DATABASE is not shared — each worker deploys its own account-scoped D1 and ships
// its own migration — but the schema contract those statements assume is, which is
// exactly why there is one copy of them.
//
// They stay reachable WITHOUT importing index.mjs, which loads the gitignored corpus
// artifact at module scope.

export { SQL } from '../../lib/ratelimit.mjs';
