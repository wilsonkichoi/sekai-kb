// workers/feedback/src/index.mjs — the feedback capability's Cloudflare Worker.
//
// A single POST endpoint that stores reader feedback in D1, for the feedback widget
// to post to. It runs on the Cloudflare free tier, so every control here is a table
// or a header — no KV, no Durable Objects, no rate-limit binding.
//
// This file is framework-owned and carries zero place identity: the site's origin
// arrives as env.ALLOWED_ORIGIN at deploy time, never as a literal here (AGENTS.md
// iron rule 2; both machine gates scan workers/).
//
// The handler is exported separately from the `fetch` wiring so the test suite can
// drive it directly against an in-memory D1 stub (workers/feedback/test/).

/** Defaults for the two tunable vars, used when the var is absent or unusable. */
const DEFAULT_RATE_LIMIT_MAX = 5;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600;

/** Hard ceiling on the request body, before any parsing. */
const MAX_BODY_BYTES = 8192;

/** Field bounds. `message` also has a floor: a 3-character report is not a report. */
const MAX_PAGE_CHARS = 200;
const MAX_CATEGORY_CHARS = 64;
const MIN_MESSAGE_CHARS = 10;
const MAX_MESSAGE_CHARS = 4000;
const MAX_CONTACT_CHARS = 200;

/** The honeypot field. A real widget renders it hidden; only a bot fills it in. */
const HONEYPOT_FIELD = 'website';

/**
 * The two statements this worker issues, exported so the test D1 stub can route on
 * identity rather than parsing SQL.
 */
export const SQL = {
  // One atomic upsert does the whole rolling-window decision: a row older than the
  // window is reset to a fresh window, anything else increments in place. RETURNING
  // hands back the post-increment state, so there is no read-then-write race between
  // two concurrent requests from the same address.
  RATE_LIMIT_UPSERT: `
    INSERT INTO submission_window (ip_hash, window_start, count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET
      window_start = CASE WHEN submission_window.window_start <= ?3
                          THEN ?2 ELSE submission_window.window_start END,
      count        = CASE WHEN submission_window.window_start <= ?3
                          THEN 1 ELSE submission_window.count + 1 END
    RETURNING window_start, count
  `,
  INSERT_FEEDBACK: `
    INSERT INTO feedback
      (id, created_at, page, category, message, contact, user_agent, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
};

/* -- Responses -------------------------------------------------------------- */

// CORS is pinned to the single configured origin on every response the worker
// returns. The one exception is the 403 below, which carries no
// Access-Control-Allow-Origin at all — a rejected origin is never told it is
// allowed, and the header is never `*`.
function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  };
}

function json(body, status, allowedOrigin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(allowedOrigin ? corsHeaders(allowedOrigin) : {}),
      ...extraHeaders,
    },
  });
}

function badRequest(error, field, allowedOrigin) {
  return json({ error, field }, 400, allowedOrigin);
}

/* -- Env parsing ------------------------------------------------------------ */

// Vars arrive as strings from wrangler.toml and as numbers from a test env; both
// are accepted. Anything unusable (absent, blank, non-numeric, zero, negative)
// falls back to the default rather than disabling the control.
function positiveIntVar(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/* -- IP hashing ------------------------------------------------------------- */

// The address is hashed before it reaches any storage or log path, so no code path
// downstream of this function can leak it (DoD 1: no raw IP is stored or logged).
// A missing salt is a hard failure upstream of this call — an unsalted hash of an
// address is reversible by brute force over the address space.
async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${ip}${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* -- Validation ------------------------------------------------------------- */

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

// Returns { error, field } for the first failing class, or null when the payload is
// valid. Required-ness is checked before format and length for the same field, so a
// blank value reports `required` rather than a format complaint about "".
function validate(payload) {
  const page = trimmed(payload.page);
  const category = trimmed(payload.category);
  const message = trimmed(payload.message);
  const contact = trimmed(payload.contact);

  if (!page) return { error: 'required', field: 'page' };
  if (!category) return { error: 'required', field: 'category' };
  if (!message) return { error: 'required', field: 'message' };

  if (!page.startsWith('/')) return { error: 'invalid_format', field: 'page' };
  if (page.length > MAX_PAGE_CHARS) return { error: 'too_long', field: 'page' };
  if (category.length > MAX_CATEGORY_CHARS) return { error: 'too_long', field: 'category' };
  if (message.length < MIN_MESSAGE_CHARS) return { error: 'too_short', field: 'message' };
  if (message.length > MAX_MESSAGE_CHARS) return { error: 'too_long', field: 'message' };

  // contact is optional: absent or blank is valid and stores NULL.
  if (contact) {
    if (contact.length > MAX_CONTACT_CHARS) return { error: 'too_long', field: 'contact' };
    if (!contact.includes('@')) return { error: 'invalid_format', field: 'contact' };
  }

  return null;
}

/* -- Handler ---------------------------------------------------------------- */

/**
 * The whole worker. Exported directly so tests can call it with a stub `env`.
 *
 * @param {Request} request
 * @param {{DB: object, ALLOWED_ORIGIN: string, IP_HASH_SALT: string,
 *          RATE_LIMIT_MAX?: string|number, RATE_LIMIT_WINDOW_SECONDS?: string|number}} env
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, env) {
  // 1. Origin. This is the outermost gate, so an unconfigured or mismatched origin
  // learns nothing about the endpoint's methods or payload shape.
  const allowedOrigin = env?.ALLOWED_ORIGIN;
  const origin = request.headers.get('Origin');
  if (!isNonEmptyString(allowedOrigin) || !isNonEmptyString(origin) || origin !== allowedOrigin) {
    return json({ error: 'origin_not_allowed' }, 403, null);
  }

  // 2. Method.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(allowedOrigin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, allowedOrigin);
  }

  // 3. Salt. Missing configuration fails closed before anything is hashed or stored.
  // Blank counts as missing: `wrangler secret put` will happily store a whitespace
  // value, and a salt nobody chose is a configuration error, not a salt. The check
  // is on the trimmed value but the raw value is what gets hashed, so a deliberate
  // salt with leading or trailing space keeps its full entropy.
  const salt = env?.IP_HASH_SALT;
  if (!isNonEmptyString(salt) || !salt.trim()) {
    return json({ error: 'server_misconfigured' }, 500, allowedOrigin);
  }

  // 4. Content type.
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return badRequest('invalid_content_type', 'content-type', allowedOrigin);
  }

  // 5. Body size. The declared length is rejected without reading the body; the
  // actual byte length is re-checked because Content-Length is client-supplied.
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return badRequest('payload_too_large', 'body', allowedOrigin);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return badRequest('payload_too_large', 'body', allowedOrigin);
  }

  // 6. JSON. A JSON array or scalar parses fine but is not a submission.
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return badRequest('invalid_json', 'body', allowedOrigin);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return badRequest('invalid_json', 'body', allowedOrigin);
  }

  // 7. Honeypot. A trapped submission gets a response indistinguishable from a real
  // one — same status, same body shape, a fresh id — and touches no storage at all,
  // so a bot cannot tell it was caught and cannot consume the rate-limit budget of
  // the address it is spoofing.
  if (trimmed(payload[HONEYPOT_FIELD])) {
    return json({ ok: true, id: crypto.randomUUID() }, 200, allowedOrigin);
  }

  // 8. Validation, before any D1 call: a malformed payload costs no database work.
  const invalid = validate(payload);
  if (invalid) {
    return badRequest(invalid.error, invalid.field, allowedOrigin);
  }

  // 9. Rate limit.
  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') || '', salt);
  const max = positiveIntVar(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const windowSeconds = positiveIntVar(
    env.RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  );
  const now = Math.floor(Date.now() / 1000);

  const window = await env.DB.prepare(SQL.RATE_LIMIT_UPSERT)
    .bind(ipHash, now, now - windowSeconds)
    .first();

  if (window.count > max) {
    const retryAfter = Math.max(1, window.window_start + windowSeconds - now);
    return json({ error: 'rate_limited' }, 429, allowedOrigin, {
      'Retry-After': String(retryAfter),
    });
  }

  // 10. Store. `status` starts at 'new'; the triage skill moves it from there.
  const id = crypto.randomUUID();
  const contact = trimmed(payload.contact);
  await env.DB.prepare(SQL.INSERT_FEEDBACK)
    .bind(
      id,
      new Date().toISOString(),
      trimmed(payload.page),
      trimmed(payload.category),
      trimmed(payload.message),
      contact || null,
      request.headers.get('User-Agent') || null,
      'new',
    )
    .run();

  return json({ ok: true, id }, 200, allowedOrigin);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
