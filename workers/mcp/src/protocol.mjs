// workers/mcp/src/protocol.mjs — the Model Context Protocol envelope, transport-side.
//
// MCP is JSON-RPC 2.0 carried over "Streamable HTTP": one endpoint, POST for every
// client-to-server message, with the server free to answer either as a single JSON
// response or as an SSE stream. This server is STATELESS — no sessions, no server-
// initiated messages, therefore no SSE — so every response here is a single JSON body.
// That is the shape ADR 005 verified as free-tier viable on Workers with no Durable
// Objects behind it, and it is why this file is small enough to own outright.
//
// WHY THIS IS HAND-ROLLED rather than `createMcpHandler` from the SDK. ADR 005 and the
// SPEC name that pattern, and this implements it — the stateless HTTP handler, no DO.
// The npm package that packages the pattern (`mcp-handler`) reaches it through
// `@modelcontextprotocol/sdk`, whose dependency tree pulls a Node HTTP server stack
// (express, hono, @hono/node-server), a JSON-schema validator, a JOSE implementation,
// and `cross-spawn` into a static-site framework's lockfile in order to serve four
// read-only tools. None of that runs in a Worker; all of it would ship to every adopter
// and have to be kept current for them. The protocol surface a stateless server owes a
// client is the ~200 lines below, so the framework owns them. If an adopter outgrows
// stateless, the scale-up path is the SDK's McpAgent on Durable Objects (see the
// wrangler template's header), and that is where the dependency belongs.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

/**
 * Protocol revisions this server implements, newest first.
 *
 * Negotiation rule (MCP `initialize`): the client proposes one, and the server answers
 * with a version IT supports — the client's, when that is one of these, otherwise this
 * server's newest. A client that cannot live with the answer disconnects. So an unknown
 * proposal is not an error here, and adding a revision is one entry in this list.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Reported to clients as this server's own version; bumped with the tool contract.
 *
 * It lives here rather than in the entry module because the Workers runtime rejects a
 * named export from `main` that is not a handler -- see the header of src/index.mjs.
 */
export const SERVER_VERSION = '1.0.0';

/** JSON-RPC 2.0 error codes, plus the one application code this server defines. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Implementation-defined range: a transport this stateless server does not offer. */
  TRANSPORT_UNSUPPORTED: -32000,
};

/** Largest request body accepted, before parsing. A tool call is a few hundred bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

export function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

/**
 * CORS, deliberately wide open — and deliberately NOT this endpoint's access control.
 *
 * MCP clients are desktop applications and editors, not browsers: they send no `Origin`
 * header at all, so an origin allowlist (what workers/chat/ and workers/feedback/ use)
 * would reject every intended consumer while stopping nobody, since a non-browser client
 * is not bound by CORS in the first place. The control that actually matters here is the
 * per-hashed-address rate limit on the one tool that spends the account's Workers AI
 * allowance (`semantic_search`); see src/index.mjs. Everything else this server returns
 * is already public: it is the deployed site's own `/kb/` files.
 */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, MCP-Protocol-Version',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

/**
 * Read at most MAX_BODY_BYTES of the request body, cancelling the stream rather than
 * buffering past the limit. Returns `{text}` or `{tooLarge: true}`.
 */
export async function readBoundedText(request) {
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

/**
 * Classify one parsed JSON-RPC message.
 *
 * Returns `{kind: 'request', id, method, params}`, `{kind: 'notification', method,
 * params}`, or `{kind: 'invalid', id, message}`. A notification is a message with no
 * `id`: it gets no response body at all, which is why the two are distinguished before
 * dispatch rather than inside it.
 *
 * JSON-RPC batching (a top-level array) was removed from MCP in revision 2025-06-18 and
 * is refused rather than half-implemented — a server that accepted a batch would owe an
 * array response that no supported revision defines.
 */
export function classifyMessage(message) {
  if (Array.isArray(message)) {
    return {
      kind: 'invalid',
      id: null,
      message: 'batched requests are not supported by this protocol revision',
    };
  }
  if (message === null || typeof message !== 'object') {
    return { kind: 'invalid', id: null, message: 'a request must be a JSON object' };
  }
  if (message.jsonrpc !== '2.0') {
    return {
      kind: 'invalid',
      id: message.id ?? null,
      message: 'missing or unsupported "jsonrpc" version, expected "2.0"',
    };
  }
  if (typeof message.method !== 'string' || message.method === '') {
    return {
      kind: 'invalid',
      id: message.id ?? null,
      message: 'missing "method"',
    };
  }
  const params = message.params ?? {};
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return {
      kind: 'invalid',
      id: message.id ?? null,
      message: '"params" must be an object when present',
    };
  }
  if (message.id === undefined || message.id === null) {
    return { kind: 'notification', method: message.method, params };
  }
  if (typeof message.id !== 'string' && typeof message.id !== 'number') {
    return {
      kind: 'invalid',
      id: null,
      message: '"id" must be a string or a number',
    };
  }
  return { kind: 'request', id: message.id, method: message.method, params };
}

/** The negotiated revision for one `initialize` call. */
export function negotiateProtocolVersion(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

/**
 * A successful `tools/call` result. MCP carries tool output as content blocks, and a
 * tool's own failure (an article that does not exist) is reported IN BAND with
 * `isError: true` rather than as a JSON-RPC error — protocol errors are about the
 * protocol, and a model needs to see a tool failure as a result it can react to.
 */
export function toolText(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError };
}
