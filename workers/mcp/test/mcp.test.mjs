/**
 * LB-95 contract tests for the MCP worker's transport: the JSON-RPC envelope, the MCP
 * methods, the rate limit that protects the Workers AI allowance, and the shipped D1
 * migration the limit runs against.
 *
 * The suite installs the same synthetic vector artifact workers/chat/ uses, because
 * src/index.mjs binds the corpus at module scope. It restores a pre-existing artifact
 * byte-for-byte, or removes only the one it created. `npm run test:workers` runs worker
 * suites one file at a time for exactly this reason: two suites installing the same
 * shared path concurrently would race.
 *
 * No test performs network I/O and no test reads the implementation source.
 *
 * This file lives under workers/, which both machine gates scan: its source is pure
 * ASCII and carries no denylisted place term.
 */

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createD1Stub } from '../../lib/test/d1-stub.mjs';
import { assertHandlerOnlyExports } from '../../lib/test/entry-exports.mjs';
import {
  CLIENT_IP,
  FLOORED_TITLES,
  SITE_NAME,
  createAiStub,
  createFetchStub,
  makeEnv,
  rpc,
  rpcRequest,
} from './helpers.mjs';

const fixturePath = fileURLToPath(
  new URL('../../lib/test/fixtures/corpus-vectors.fixture.json', import.meta.url),
);
const artifactPath = fileURLToPath(new URL('../../lib/vectors.json', import.meta.url));
const originalArtifact = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, readFileSync(fixturePath));

let cleaned = false;
function cleanupArtifact() {
  if (cleaned) return;
  cleaned = true;
  if (originalArtifact === null) rmSync(artifactPath, { force: true });
  else writeFileSync(artifactPath, originalArtifact);
}
process.once('exit', cleanupArtifact);
after(cleanupArtifact);

// A developer's real artifact is gitignored, so a leaked synthetic copy is invisible to
// `git status` and would be bundled by the next deploy. 'exit' does not run on a signal.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanupArtifact();
    process.exit(130);
  });
}

const workerModule = await import('../src/index.mjs');
const { handleRequest, default: worker } = workerModule;
// Everything else comes from the module that OWNS it, never re-exported through the
// entry: `main` may export only handlers, or the isolate fails at startup
// (workers/lib/test/entry-exports.mjs).
const { SQL } = await import('../src/sql.mjs');
const { TOOL_DEFINITIONS } = await import('../src/tools.mjs');
const { SERVER_VERSION } = await import('../src/protocol.mjs');

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url)),
  'utf8',
);

/** Env with a D1 stub wired in, for the paths that charge the rate limit. */
function meteredEnv(overrides = {}) {
  const DB = overrides.DB ?? createD1Stub(SQL);
  const AI = overrides.AI ?? createAiStub();
  return { DB, AI, env: makeEnv({ DB, AI, ...overrides }) };
}

/** Send one JSON-RPC message and return the parsed response body. */
async function call(
  message,
  {
    env,
    fetchImpl = createFetchStub(),
    ip = CLIENT_IP,
    origin,
    protocolVersion = '2025-06-18',
  } = {},
) {
  const response = await handleRequest(
    rpcRequest(message, { ip, origin, protocolVersion }),
    env ?? makeEnv(),
    { fetchImpl },
  );
  return { response, body: await response.json() };
}

/** The JSON payload a successful tools/call carries, parsed back out of its text block. */
function toolPayload(result) {
  assert.equal(result.isError, false);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

describe('the public module surface', () => {
  test('exports the handler, the default fetch, the tool catalogue, and the SQL', () => {
    assert.equal(typeof handleRequest, 'function');
    assert.equal(typeof worker.fetch, 'function');
    assert.equal(Array.isArray(TOOL_DEFINITIONS), true);
    assert.equal(TOOL_DEFINITIONS.length, 4);
    assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+$/);
    for (const key of ['RATE_LIMIT_PRUNE', 'RATE_LIMIT_RECORD', 'RATE_LIMIT_COUNT', 'RATE_LIMIT_RELEASE']) {
      assert.equal(typeof SQL[key], 'string');
      assert.ok(SQL[key].length > 0);
    }
  });

  test('the entry module exports only handlers, so the isolate can start', () => {
    // Found on this task's manual step: a non-handler named export from `main` fails
    // workerd at isolate startup, before any request, and `node --test` cannot see it
    // because it imports the module instead of booting the runtime.
    assertHandlerOnlyExports(workerModule, 'workers/mcp/src/index.mjs');
  });

  test('the default fetch reaches the same handler', async () => {
    const response = await worker.fetch(rpcRequest(rpc(1, 'ping')), makeEnv(), {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 1, result: {} });
  });
});

describe('the MCP handshake', () => {
  test('initialize declares tool capability and names the configured site', async () => {
    const { response, body } = await call(
      rpc(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'selftest', version: '0.0.0' },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 1);
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.ok(body.result.capabilities.tools, 'tools capability must be declared');
    assert.ok(body.result.serverInfo.name.includes(SITE_NAME));
    assert.equal(body.result.serverInfo.version, SERVER_VERSION);
  });

  test('a protocol revision this server does not implement is answered with one it does', async () => {
    const { body } = await call(rpc(1, 'initialize', { protocolVersion: '1999-01-01' }));
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.equal(body.error, undefined);
  });

  test('the initialized notification is accepted with no response body', async () => {
    const response = await handleRequest(
      rpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      makeEnv(),
    );
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
  });

  test('tools/list returns all four tools with their schemas', async () => {
    const { body } = await call(rpc(2, 'tools/list'));
    assert.deepEqual(
      body.result.tools.map((tool) => tool.name),
      ['list_topics', 'get_article', 'search', 'semantic_search'],
    );
    for (const tool of body.result.tools) {
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  test('ping answers so a client can keep the endpoint warm', async () => {
    const { body } = await call(rpc('p', 'ping'));
    assert.deepEqual(body, { jsonrpc: '2.0', id: 'p', result: {} });
  });
});

describe('tools/call over the transport', () => {
  test('every tool answers its success path end to end', async () => {
    const { env } = meteredEnv({ AI: createAiStub({ query: [10, 0, 0] }) });
    const fetchImpl = createFetchStub();

    const topics = await call(rpc(1, 'tools/call', { name: 'list_topics', arguments: {} }), {
      env,
      fetchImpl,
    });
    assert.equal(toolPayload(topics.body.result).count, 3);

    const article = await call(
      rpc(2, 'tools/call', { name: 'get_article', arguments: { slug: 'guides/alpha' } }),
      { env, fetchImpl },
    );
    assert.match(toolPayload(article.body.result).markdown, /Alpha Guide/);

    const keyword = await call(
      rpc(3, 'tools/call', { name: 'search', arguments: { query: 'bravo' } }),
      { env, fetchImpl },
    );
    assert.equal(toolPayload(keyword.body.result).results[0].slug, 'guides/bravo');

    const semantic = await call(
      rpc(4, 'tools/call', { name: 'semantic_search', arguments: { query: 'which guide?' } }),
      { env, fetchImpl },
    );
    assert.deepEqual(
      toolPayload(semantic.body.result).results.map((hit) => hit.title),
      FLOORED_TITLES,
    );
  });

  test('a tool failure is reported in band as isError, not as a transport error', async () => {
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'get_article', arguments: { slug: 'guides/nope' } }),
    );
    assert.equal(body.error, undefined, 'a tool failure is not a JSON-RPC error');
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /no article "guides\/nope"/);
  });

  test('an unknown tool name is a JSON-RPC invalid-params error listing the real ones', async () => {
    const { response, body } = await call(
      rpc(1, 'tools/call', { name: 'delete_everything', arguments: {} }),
    );
    assert.equal(response.status, 200);
    assert.equal(body.error.code, -32602);
    assert.match(body.error.message, /delete_everything/);
    assert.deepEqual(body.error.data.available, [
      'list_topics',
      'get_article',
      'search',
      'semantic_search',
    ]);
  });

  test('a tools/call with no name, or non-object arguments, is invalid params', async () => {
    for (const params of [{}, { name: '' }, { name: 'search', arguments: [] }, { name: 'search', arguments: 'q' }]) {
      const { body } = await call(rpc(1, 'tools/call', params));
      assert.equal(body.error.code, -32602, `params ${JSON.stringify(params)} must be refused`);
    }
  });
});

describe('MALFORMED requests', () => {
  // DoD 2: the named malformed-request case. Each of these is a distinct JSON-RPC
  // failure, and the code has to distinguish them -- a client debugging its own
  // transport learns nothing from one catch-all.
  test('a body that is not JSON is a parse error', async () => {
    const response = await handleRequest(rpcRequest('{ not json'), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32700);
    assert.equal(body.id, null);
  });

  test('a body that is not a JSON-RPC 2.0 object is an invalid request', async () => {
    for (const payload of [
      42,
      '"a string"',
      null,
      { method: 'ping' },
      { jsonrpc: '1.0', method: 'ping', id: 1 },
      { jsonrpc: '2.0', id: 1 },
      { jsonrpc: '2.0', method: 'ping', id: 1, params: 'nope' },
      { jsonrpc: '2.0', method: 'ping', id: { object: true } },
    ]) {
      const response = await handleRequest(rpcRequest(payload), makeEnv());
      const body = await response.json();
      assert.equal(response.status, 400, `${JSON.stringify(payload)} must be refused`);
      assert.equal(body.error.code, -32600, `${JSON.stringify(payload)} must be invalid-request`);
      assert.ok(body.error.message.length > 0);
    }
  });

  test('a 2025-06-18 batched request is refused', async () => {
    const response = await handleRequest(
      rpcRequest([rpc(1, 'ping'), rpc(2, 'ping')], { protocolVersion: '2025-06-18' }),
      makeEnv(),
    );
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32600);
    assert.match(body.error.message, /batched/);
  });

  test('a missing version header uses 2025-03-26 batch compatibility', async () => {
    const response = await handleRequest(
      rpcRequest([
        rpc(1, 'ping'),
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        rpc(2, 'tools/list'),
      ]),
      makeEnv(),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.map((message) => message.id), [1, 2]);
    assert.deepEqual(body[0].result, {});
    assert.equal(body[1].result.tools.length, 4);
  });

  test('an explicit 2025-03-26 header keeps batch compatibility', async () => {
    const response = await handleRequest(
      rpcRequest([rpc(1, 'ping'), rpc(2, 'ping')], { protocolVersion: '2025-03-26' }),
      makeEnv(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).map((message) => message.id),
      [1, 2],
    );
  });

  test('an unsupported protocol version header is refused before dispatch', async () => {
    const response = await handleRequest(
      rpcRequest(rpc(1, 'ping'), { protocolVersion: '2099-01-01' }),
      makeEnv(),
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, -32600);
    assert.match(body.error.message, /MCP-Protocol-Version/);
  });

  test('an unknown method is method-not-found, and keeps the request id', async () => {
    const { body } = await call(rpc(7, 'resources/list'));
    assert.equal(body.error.code, -32601);
    assert.equal(body.id, 7);
  });

  test('an oversized body is refused without being buffered', async () => {
    const huge = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'x'.repeat(128 * 1024) } },
    });
    const response = await handleRequest(rpcRequest(huge), makeEnv());
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, -32600);
  });
});

describe('the stateless transport surface', () => {
  test('GET is refused with the reason, because this server opens no SSE stream', async () => {
    const response = await handleRequest(rpcRequest(undefined, { method: 'GET' }), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /stateless/);
  });

  test('DELETE is refused, because there is no session to terminate', async () => {
    const response = await handleRequest(rpcRequest(undefined, { method: 'DELETE' }), makeEnv());
    assert.equal(response.status, 405);
    assert.match((await response.json()).error.message, /session/);
  });

  test('a request without Origin is accepted for desktop MCP clients', async () => {
    const { response, body } = await call(rpc(1, 'ping'));
    assert.equal(response.status, 200);
    assert.deepEqual(body.result, {});
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('browser preflights are rejected even when Origin matches the request URL', async () => {
    const origin = new URL('https://mcp.example.invalid/').origin;
    const response = await handleRequest(
      rpcRequest(undefined, { method: 'OPTIONS', origin }),
      makeEnv(),
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.match((await response.json()).error.message, /Origin/);
  });

  test('a hostile Origin is rejected before a tool can run', async () => {
    const AI = createAiStub({ query: [10, 0, 0] });
    const { env } = meteredEnv({ AI });
    const response = await handleRequest(
      rpcRequest(
        rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }),
        { origin: 'https://attacker.example.invalid', protocolVersion: '2025-06-18' },
      ),
      env,
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await response.json()).error.code, -32600);
    assert.equal(AI.calls.length, 0);
  });
});

describe('the rate limit on the metered tool', () => {
  test('semantic_search charges one unit per call, keyed on the hashed address', async () => {
    const { DB, env } = meteredEnv({ AI: createAiStub({ query: [10, 0, 0] }) });
    await call(rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }), { env });

    assert.equal(DB.callsOf('record').length, 1);
    const [ipHash] = DB.callsOf('record')[0].args;
    assert.match(ipHash, /^[0-9a-f]{64}$/, 'the key is a hash, never the address');
    assert.equal(ipHash.includes(CLIENT_IP), false);
  });

  test('the three site-backed tools spend no rate budget', async () => {
    const { DB, env } = meteredEnv();
    for (const [name, args] of [
      ['list_topics', {}],
      ['get_article', { slug: 'guides/alpha' }],
      ['search', { query: 'guide' }],
    ]) {
      await call(rpc(1, 'tools/call', { name, arguments: args }), { env });
    }
    assert.equal(DB.touched, false, 'a public static read must not consume the AI budget');
  });

  test('an exhausted budget refuses the tool and says when to retry', async () => {
    const AI = createAiStub({ query: [10, 0, 0] });
    const { DB, env } = meteredEnv({ AI, RATE_LIMIT_MAX: '2' });
    const send = () =>
      call(rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }), { env });

    await send();
    await send();
    const third = await send();

    assert.equal(third.body.result.isError, true);
    assert.match(third.body.result.content[0].text, /rate limit reached/);
    assert.match(third.body.result.content[0].text, /second\(s\)/);
    assert.equal(AI.calls.length, 2, 'a refused call must not spend a neuron');
    assert.equal(DB.callsOf('release').length, 1, 'a refused call releases its own unit');
  });

  test('a missing IP_HASH_SALT refuses the metered tool instead of hashing without one', async () => {
    const { env } = meteredEnv();
    delete env.IP_HASH_SALT;
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }),
      { env },
    );
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0].text, /IP_HASH_SALT/);
  });

  test('the shipped statements run against the shipped migration', () => {
    // The D1 stub routes by string identity and never executes SQL, so nothing else
    // under `npm run test:workers` would notice a typo in a statement or a drift
    // between its ON CONFLICT target and this worker's own primary key.
    const db = new DatabaseSync(':memory:');
    db.exec(MIGRATION);
    const hash = 'a'.repeat(64);
    const now = 1_700_000_000;

    db.prepare(SQL.RATE_LIMIT_RECORD).run(hash, now);
    db.prepare(SQL.RATE_LIMIT_RECORD).run(hash, now);
    assert.deepEqual({ ...db.prepare(SQL.RATE_LIMIT_COUNT).get(hash) }, { total: 2, oldest: now });

    db.prepare(SQL.RATE_LIMIT_RELEASE).run(hash, now);
    assert.equal(db.prepare(SQL.RATE_LIMIT_COUNT).get(hash).total, 1);

    db.prepare(SQL.RATE_LIMIT_PRUNE).run(hash, now);
    assert.deepEqual({ ...db.prepare(SQL.RATE_LIMIT_COUNT).get(hash) }, { total: null, oldest: null });
    db.close();
  });
});

describe('the corpus binding', () => {
  test('semantic_search reads the artifact bundled beside the shared retrieval code', async () => {
    // The fixture installed at workers/lib/vectors.json is what this answer comes from,
    // which is the property that stops chat and MCP from retrieving against two corpora.
    const { env } = meteredEnv({ AI: createAiStub({ query: [10, 0, 0] }) });
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q', limit: 1 } }),
      { env },
    );
    const payload = toolPayload(body.result);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].slug, 'guides/alpha');
  });

  test('a query nothing in the corpus answers returns no passages at all', async () => {
    // Orthogonal to every fixture vector, so every passage scores 0 against the shipped
    // floor. An empty result is the honest answer, and it has to be reachable through
    // the transport and not only inside the ranking.
    const { env } = meteredEnv({ AI: createAiStub({ query: [0, 0, 10] }) });
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }),
      { env },
    );
    const payload = toolPayload(body.result);
    assert.equal(payload.count, 0);
    assert.deepEqual(payload.results, []);
  });

  test('a retuned RELEVANCE_FLOOR var narrows what the tool returns', async () => {
    const { env } = meteredEnv({ AI: createAiStub({ query: [10, 0, 0] }), RELEVANCE_FLOOR: '0.95' });
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }),
      { env },
    );
    assert.deepEqual(
      toolPayload(body.result).results.map((hit) => hit.title),
      ['Alpha Guide'],
      'only the passage above the retuned floor survives',
    );
  });

  test('an unusable RELEVANCE_FLOOR falls back to the shipped default rather than failing', async () => {
    const { env } = meteredEnv({ AI: createAiStub({ query: [10, 0, 0] }), RELEVANCE_FLOOR: 'nonsense' });
    const { body } = await call(
      rpc(1, 'tools/call', { name: 'semantic_search', arguments: { query: 'q' } }),
      { env },
    );
    assert.deepEqual(
      toolPayload(body.result).results.map((hit) => hit.title),
      FLOORED_TITLES,
    );
  });
});
