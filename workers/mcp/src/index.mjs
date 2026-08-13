// workers/mcp/src/index.mjs — a stateless remote MCP server for this knowledge base.
//
// One endpoint, four read-only tools, no sessions and no Durable Objects: an MCP client
// registers the deployed URL once and can then list topics, fetch an article, keyword
// search, and search by meaning, without cloning the repository or knowing any of its
// URLs. That is the delta over the static `/kb/` protocol, which already serves any
// consumer able to fetch a URL: a tool-only client cannot use it, and no static file can
// answer a semantic query.
//
// STATELESS IS THE ARCHITECTURE, NOT A SIMPLIFICATION (ADR 005). Every request carries
// everything it needs, so no isolate has to outlive one, which is what keeps this inside
// the Workers free tier with no Durable Object behind it. An adopter who needs sessions,
// server-initiated messages, or per-connection state has a documented scale-up path —
// the SDK's McpAgent on Durable Objects — and takes on the paid product that implies.
//
// WHAT PROTECTS THIS ENDPOINT. MCP clients are desktop applications that normally send
// no Origin header, and those requests remain accepted. Browser clients are not part of
// the contract, so every request that does carry Origin is rejected. An allowlist derived
// from the request URL would not close DNS rebinding: the attacker controls that hostname.
// Three of the four tools only re-serve files the deployed site already publishes. The
// fourth, `semantic_search`, spends this account's shared 10k-neuron/day Workers AI
// allowance, so it also charges a per-hashed-address rolling rate limit before embedding.
//
// THE ENTRY MODULE EXPORTS ONLY HANDLERS. `main` in wrangler.toml points here, and the
// Workers runtime walks this module's named exports expecting each to be a fetch handler
// or a Durable Object class: a plain string, object, or array among them fails the
// isolate at STARTUP with "Incorrect type for map entry '<name>'", before any request.
// Unit tests never see it, because `node --test` imports the module rather than starting
// workerd. So constants and statements a suite needs live in their own modules
// (./protocol.mjs, ./tools.mjs, ./sql.mjs) and are imported from there, never re-exported
// from here. workers/lib/test/entry-exports.mjs is the assertion that keeps this true.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { DEFAULT_RELEVANCE_FLOOR, relevanceFloorVar } from '../../lib/corpus.mjs';
import { loadCorpus } from '../../lib/vectors.mjs';
import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  consumeRateLimit,
  hashAddress,
  positiveIntVar,
} from '../../lib/ratelimit.mjs';
import {
  TOOL_DEFINITIONS,
  ToolInputError,
  ToolUnavailableError,
  getArticle,
  listTopics,
  search,
  semanticSearch,
} from './tools.mjs';
import {
  RPC,
  SERVER_VERSION,
  classifyMessage,
  jsonResponse,
  negotiateProtocolVersion,
  protocolVersionForRequest,
  readBoundedText,
  rpcError,
  rpcResult,
  toolText,
} from './protocol.mjs';

/** Tools that spend the account's Workers AI allowance and therefore cost rate budget. */
const METERED_TOOLS = new Set(['semantic_search']);

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function serverName(env) {
  const site = isNonBlankString(env?.SITE_NAME) ? env.SITE_NAME.trim() : 'knowledge base';
  return `${site} knowledge base (MCP)`;
}

/* -- rate limit ------------------------------------------------------------ */

/**
 * Charge one unit for a metered tool call. Returns null when the call may proceed, or
 * the `{code, message}` an error result should carry.
 *
 * A missing salt is a misconfiguration, not a rejection to hide: the worker refuses the
 * metered tool and says so, exactly as workers/chat/ refuses a request without one,
 * rather than falling back to an unsalted hash that would be trivially reversible.
 */
async function chargeMeteredCall(request, env) {
  if (!isNonBlankString(env?.IP_HASH_SALT)) {
    return {
      code: RPC.INTERNAL_ERROR,
      message:
        'this server is missing its IP_HASH_SALT secret, so the rate limit that protects ' +
        'its Workers AI allowance cannot be applied',
    };
  }
  if (!env?.DB) {
    return {
      code: RPC.INTERNAL_ERROR,
      message: 'this server has no D1 binding, so its rate-limit state has nowhere to live',
    };
  }

  const ipHash = await hashAddress(request.headers.get('CF-Connecting-IP') || '', env.IP_HASH_SALT);
  const verdict = await consumeRateLimit(env.DB, ipHash, {
    max: positiveIntVar(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
    windowSeconds: positiveIntVar(
      env.RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    ),
  });
  if (verdict.allowed) return null;
  return {
    code: RPC.INTERNAL_ERROR,
    message:
      `rate limit reached for this address; retry in ${verdict.retryAfterSeconds} second(s). ` +
      'The limit is keyed on a hash of the caller address, so everyone behind one network ' +
      'shares one budget.',
  };
}

/* -- tools/call ------------------------------------------------------------ */

/**
 * Run one tool and return an MCP tool result.
 *
 * A tool's own failure — an unknown slug, a malformed argument, an unreachable site —
 * comes back as `isError: true` content rather than a JSON-RPC error. That is the MCP
 * convention and it is the useful one: the model reads the failure as a result it can
 * act on ("call list_topics first"), where a protocol error would surface to the client
 * as a broken server.
 */
async function callTool(name, args, request, env, options = {}) {
  const tool = TOOL_DEFINITIONS.find((definition) => definition.name === name);
  if (!tool) {
    return {
      rpcError: {
        code: RPC.INVALID_PARAMS,
        message: `unknown tool "${name}"`,
        data: { available: TOOL_DEFINITIONS.map((definition) => definition.name) },
      },
    };
  }

  if (METERED_TOOLS.has(name)) {
    const denied = await chargeMeteredCall(request, env);
    if (denied) return { result: toolText(denied.message, true) };
  }

  try {
    if (name === 'list_topics') return { result: toolText(await listTopics(args, env, options)) };
    if (name === 'get_article') return { result: toolText(await getArticle(args, env, options)) };
    if (name === 'search') return { result: toolText(await search(args, env, options)) };

    const corpus = loadCorpus();
    const floor = relevanceFloorVar(env?.RELEVANCE_FLOOR, DEFAULT_RELEVANCE_FLOOR);
    return {
      result: toolText(await semanticSearch(args, env, { ...options, corpus, floor })),
    };
  } catch (error) {
    if (error instanceof ToolInputError || error instanceof ToolUnavailableError) {
      return { result: toolText(error.message, true) };
    }
    // Anything else is this server's bug or a corrupt bundled artifact. It is still a
    // tool result rather than a transport error, so one broken tool does not read to the
    // client as an unusable server, but the message is kept so an operator can act.
    return { result: toolText(`internal tool failure: ${error.message}`, true) };
  }
}

/* -- dispatch -------------------------------------------------------------- */

async function dispatch(message, request, env, options) {
  const { method, params, id } = message;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: serverName(env), version: SERVER_VERSION },
      instructions:
        'This server exposes one place-specific knowledge base. Call list_topics to see ' +
        'what it covers, search or semantic_search to find articles, and get_article to ' +
        'read one in full. Answer only from what these tools return.',
    });
  }

  if (method === 'ping') return rpcResult(id, {});

  if (method === 'tools/list') return rpcResult(id, { tools: TOOL_DEFINITIONS });

  if (method === 'tools/call') {
    const name = params?.name;
    if (typeof name !== 'string' || name === '') {
      return rpcError(id, RPC.INVALID_PARAMS, 'tools/call requires a "name"');
    }
    const args = params?.arguments ?? {};
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return rpcError(id, RPC.INVALID_PARAMS, 'tools/call "arguments" must be an object');
    }
    const outcome = await callTool(name, args, request, env, options);
    if (outcome.rpcError) {
      return rpcError(id, outcome.rpcError.code, outcome.rpcError.message, outcome.rpcError.data);
    }
    return rpcResult(id, outcome.result);
  }

  return rpcError(id, RPC.METHOD_NOT_FOUND, `unknown method "${method}"`);
}

async function processMessage(raw, request, env, options, { batched = false } = {}) {
  const message = classifyMessage(raw);
  if (message.kind === 'invalid') {
    return { body: rpcError(message.id, RPC.INVALID_REQUEST, message.message), invalid: true };
  }
  if (batched && message.method === 'initialize') {
    return {
      body: rpcError(message.id, RPC.INVALID_REQUEST, 'initialize cannot be part of a batch'),
      invalid: true,
    };
  }
  if (message.kind === 'notification') return { body: null, invalid: false };
  return { body: await dispatch(message, request, env, options), invalid: false };
}

function validatedOriginHeaders(request) {
  return request.headers.has('Origin') ? null : {};
}

/* -- transport ------------------------------------------------------------- */

export async function handleRequest(request, env, options = {}) {
  const originHeaders = validatedOriginHeaders(request);
  if (originHeaders === null) {
    return jsonResponse(
      rpcError(null, RPC.INVALID_REQUEST, 'Origin headers are not accepted by this MCP endpoint'),
      403,
    );
  }
  const respond = (body, status = 200, extraHeaders = {}) =>
    jsonResponse(body, status, { ...originHeaders, ...extraHeaders });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: originHeaders });
  }

  const protocolVersion = protocolVersionForRequest(request);
  if (protocolVersion === null) {
    return respond(
      rpcError(null, RPC.INVALID_REQUEST, 'unsupported MCP-Protocol-Version header'),
      400,
    );
  }

  // A stateless server has no stream to open and no session to delete, so the two other
  // verbs Streamable HTTP defines are answered rather than left to 404 as if the
  // endpoint were wrong.
  if (request.method === 'GET') {
    return respond(
      rpcError(
        null,
        RPC.TRANSPORT_UNSUPPORTED,
        'this server is stateless and opens no SSE stream; send requests as HTTP POST',
      ),
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }
  if (request.method === 'DELETE') {
    return respond(
      rpcError(null, RPC.TRANSPORT_UNSUPPORTED, 'this server keeps no session to terminate'),
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }
  if (request.method !== 'POST') {
    return respond(
      rpcError(null, RPC.INVALID_REQUEST, `${request.method} is not supported`),
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }

  const body = await readBoundedText(request);
  if (body.tooLarge) {
    return respond(rpcError(null, RPC.INVALID_REQUEST, 'request body is too large'), 413);
  }

  let parsed;
  try {
    parsed = JSON.parse(body.text);
  } catch (error) {
    return respond(
      rpcError(null, RPC.PARSE_ERROR, `request body is not valid JSON: ${error.message}`),
      400,
    );
  }

  if (Array.isArray(parsed)) {
    if (protocolVersion !== '2025-03-26') {
      return respond(
        rpcError(
          null,
          RPC.INVALID_REQUEST,
          'batched requests are not supported by this protocol revision',
        ),
        400,
      );
    }
    if (parsed.length === 0) {
      return respond(rpcError(null, RPC.INVALID_REQUEST, 'a batch must not be empty'), 400);
    }
    const responses = [];
    for (const item of parsed) {
      const outcome = await processMessage(item, request, env, options, { batched: true });
      if (outcome.body !== null) responses.push(outcome.body);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: originHeaders });
    }
    return respond(responses);
  }

  const outcome = await processMessage(parsed, request, env, options);
  if (outcome.invalid) return respond(outcome.body, 400);
  // A notification has no id, so JSON-RPC forbids a response body for it. 202 is what
  // Streamable HTTP specifies: accepted, nothing to say back.
  if (outcome.body === null) {
    return new Response(null, { status: 202, headers: originHeaders });
  }
  return respond(outcome.body);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
