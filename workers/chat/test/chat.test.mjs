/**
 * LB-84 contract tests for the chat Worker public handler.
 *
 * The suite installs a small synthetic vector artifact before dynamically importing
 * the worker. It restores a pre-existing artifact byte-for-byte, or removes only the
 * artifact it created. No test reads the worker implementation source.
 */

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COUNT, PRUNE, RECORD, RELEASE, createD1Stub } from './d1-stub.mjs';
import {
  ALLOWED_ORIGIN,
  CLIENT_IP,
  DEFAULT_LIMIT,
  DEFAULT_WINDOW,
  MAX_BODY_BYTES,
  OMIT,
  OTHER_ORIGIN,
  SALT,
  SITE_NAME,
  assertCors,
  assertValidationError,
  createAiStub,
  expectedIpHash,
  jsonBodyOfBytes,
  makeEnv,
  makeRequest,
  postJson,
  streamingBody,
  validPayload,
} from './helpers.mjs';

// The fixture is deliberately NOT named vectors.json: both machine gates skip that
// basename, so a fixture carrying it would be scanned by nobody. This name is what
// makes DoD 8's "synthetic, place-free" property machine-checked.
const fixturePath = fileURLToPath(
  new URL('./fixtures/corpus-vectors.fixture.json', import.meta.url),
);
const artifactPath = fileURLToPath(new URL('../vectors.json', import.meta.url));
const fixtureBytes = readFileSync(fixturePath);
const originalArtifact = existsSync(artifactPath) ? readFileSync(artifactPath) : null;
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, fixtureBytes);

let cleaned = false;
const originalAtob = globalThis.atob;
const fixtureBase64 = JSON.parse(fixtureBytes.toString('utf8')).vectors;
let fixtureDecodeCalls = 0;
globalThis.atob = function countedAtob(value) {
  if (value === fixtureBase64) fixtureDecodeCalls += 1;
  return originalAtob.call(this, value);
};

function cleanupArtifact() {
  if (cleaned) return;
  cleaned = true;
  globalThis.atob = originalAtob;
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
const { CHAT_MODEL, EMBED_MODEL, SQL, handleRequest, default: worker } = workerModule;

const EXPECTED_TITLES = ['Alpha Guide', 'Bravo Guide', 'Charlie Guide', 'Delta Guide', 'Echo Guide'];
const EXPECTED_URLS = ['/guides/alpha', '/guides/bravo', '/guides/charlie', '/guides/delta', '/guides/echo'];

async function accepted(overrides = {}, payload = validPayload()) {
  const setup = makeEnv(SQL, overrides);
  const response = await handleRequest(postJson(payload), setup.env);
  return { ...setup, response };
}

async function errorShape(response, status) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
  return body;
}

describe('public module and model contract', () => {
  test('exports the pinned chat and embedding models, SQL, handleRequest, and default fetch', () => {
    assert.equal(CHAT_MODEL, '@cf/zai-org/glm-4.7-flash');
    assert.equal(EMBED_MODEL, '@cf/baai/bge-m3');
    assert.equal(typeof SQL, 'object');
    assert.equal(typeof handleRequest, 'function');
    assert.equal(typeof worker, 'object');
    assert.equal(typeof worker.fetch, 'function');
    for (const key of ['RATE_LIMIT_PRUNE', 'RATE_LIMIT_RECORD', 'RATE_LIMIT_COUNT', 'RATE_LIMIT_RELEASE']) {
      assert.equal(typeof SQL[key], 'string', `SQL.${key} must be a string`);
      assert.ok(SQL[key].length > 0, `SQL.${key} must not be empty`);
    }
  });

  test('default fetch exposes the same successful handler path', async () => {
    const { env } = makeEnv(SQL);
    const response = await worker.fetch(postJson(validPayload()), env, {});
    assert.equal(response.status, 200);
    assertCors(response);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
  });
});

describe('retrieval, prompting, and SSE', () => {
  test('embeds with EMBED_MODEL and {text:[message]}, retrieves top 5 by normalized dot product, and prompts every selected chunk', async () => {
    const message = 'Which guide best matches this question?';
    const history = [
      { role: 'user', content: 'turn zero' },
      { role: 'assistant', content: 'turn one' },
      { role: 'user', content: 'turn two' },
      { role: 'assistant', content: 'turn three' },
      { role: 'user', content: 'turn four' },
      { role: 'assistant', content: 'turn five' },
    ];
    const AI = createAiStub({ query: [10, 0, 0] });
    const { response } = await accepted({ AI }, { message, history });

    assert.equal(response.status, 200);
    assert.equal(AI.calls.length, 2);
    assert.equal(AI.calls[0].model, EMBED_MODEL);
    assert.deepEqual(AI.calls[0].input, { text: [message] });

    assert.equal(AI.calls[1].model, CHAT_MODEL);
    assert.equal(AI.calls[1].input.stream, true);
    const messages = AI.calls[1].input.messages;
    assert.deepEqual(messages.slice(1, -1), history.slice(-4), 'only the last four history entries belong in the prompt');
    assert.deepEqual(messages.at(-1), { role: 'user', content: message });
    assert.equal(messages[0].role, 'system');
    const systemPrompt = messages[0].content;
    for (let index = 0; index < EXPECTED_TITLES.length; index += 1) {
      assert.ok(systemPrompt.includes(EXPECTED_TITLES[index]), `missing title ${EXPECTED_TITLES[index]}`);
      assert.ok(systemPrompt.includes(EXPECTED_URLS[index]), `missing URL ${EXPECTED_URLS[index]}`);
    }
    assert.equal(systemPrompt.includes('Foxtrot Guide'), false, 'the sixth-ranked chunk must not be prompted');
    assert.ok(systemPrompt.includes(SITE_NAME), 'the system prompt must identify the configured site');
    assert.match(systemPrompt, /only/i, 'the system prompt must restrict answers to supplied context');
    assert.match(systemPrompt, /context|excerpt/i, 'the system prompt must identify the supplied context');
    assert.match(systemPrompt, /cite/i, 'the system prompt must require citations');
    assert.match(systemPrompt, /url/i, 'the system prompt must require source article URLs');
    assert.match(
      systemPrompt,
      /brows/i,
      `the unsure path must suggest browsing, got ${JSON.stringify(systemPrompt)}`,
    );
  });

  test('passes upstream data frames, removes [DONE], and ends with citations for every prompted chunk', async () => {
    const AI = createAiStub({
      streamParts: ['data: {"response":"Guide "}\n', '\ndata: {"response":"answer"}\n\n', 'data: [DONE]\n\n'],
    });
    const { response } = await accepted({ AI });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const body = await response.text();

    assert.ok(
      body.includes('data: {"response":"Guide "}\n\n'),
      `first upstream frame was not preserved: ${JSON.stringify(body)}`,
    );
    assert.ok(
      body.includes('data: {"response":"answer"}\n\n'),
      `second upstream frame was not preserved: ${JSON.stringify(body)}`,
    );
    assert.equal(body.includes('[DONE]'), false, 'the upstream terminal marker must not reach the client');
    assert.match(body, /event: citations\ndata: .+\n\n$/, 'citations must remain the final event');
  });

  test('an upstream that ends without a blank line still yields a separate citations frame', async () => {
    const AI = createAiStub({ streamParts: ['data: {"response":"tail"}'] });
    const { response } = await accepted({ AI });
    const body = await response.text();
    assert.match(
      body,
      /^data: \{"response":"tail"\}\n\nevent: citations\ndata: .+\n\n$/,
      `the trailing partial frame must be terminated, got ${JSON.stringify(body)}`,
    );
  });

  test('final citations contain exactly title and URL for every prompted chunk', async () => {
    const { response } = await accepted();
    const body = await response.text();
    const finalFrame = body.match(/event: citations\ndata: (.+)\n\n$/);
    assert.ok(finalFrame, `expected a final citations event, got ${JSON.stringify(body)}`);
    assert.deepEqual(JSON.parse(finalFrame[1]), {
      citations: EXPECTED_TITLES.map((title, index) => ({ title, url: EXPECTED_URLS[index] })),
    });
  });

  test('decodes the base64 vector artifact once across two handler invocations', async () => {
    const first = await accepted();
    const second = await accepted();
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    await first.response.text();
    await second.response.text();
    assert.equal(fixtureDecodeCalls, 1, 'the fixture base64 must be decoded once in module-global state');
  });

  for (const mismatch of ['model', 'dim']) {
    test(`returns 503 and names the artifact ${mismatch} mismatch`, () => {
      const runner = fileURLToPath(new URL('./artifact-case.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [runner, mismatch], {
        encoding: 'utf8',
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, 503);
      const text = output.body.toLowerCase();
      assert.match(
        text,
        /mismatch|does not match|incompatible/,
        `response must name the incompatibility: ${output.body}`,
      );
      if (mismatch === 'model') assert.ok(text.includes('model'), `response must name model: ${output.body}`);
      else assert.match(text, /dim|dimension/, `response must name dimension: ${output.body}`);
    });
  }

  // An AI outage and a corrupt artifact are different operator problems. Reporting the
  // first as the second sends whoever is on the deploy after an artifact that is fine.
  test('an embedding call failure is 503 with CORS, and is not reported as an artifact mismatch', async () => {
    const AI = {
      calls: [],
      async run(model) {
        if (model === EMBED_MODEL) throw new Error('inference upstream refused the request');
        throw new Error('generation must not be reached');
      },
    };
    const { response } = await accepted({ AI });
    const body = await errorShape(response, 503);
    assertCors(response);
    assert.notEqual(body.error, 'query_embedding_incompatible', 'an outage is not a mismatch');
  });

  test('a generation failure is 503 with CORS and an {error} body, never a bare runtime 500', async () => {
    const AI = createAiStub({
      onRun(model) {
        if (model === CHAT_MODEL) throw new Error('daily neuron allocation exhausted');
      },
    });
    const { response } = await accepted({ AI });
    await errorShape(response, 503);
    assertCors(response);
  });
});

describe('CORS and method handling', () => {
  test('allowed OPTIONS returns the exact 204 preflight contract without touching D1 or AI', async () => {
    const { DB, AI, env } = makeEnv(SQL);
    const response = await handleRequest(makeRequest({ method: 'OPTIONS', contentType: OMIT }), env);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type');
    assert.equal(response.headers.get('vary'), 'Origin');
    assert.deepEqual(
      [...response.headers.keys()].filter((name) => name.startsWith('access-control-')).sort(),
      ['access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-origin'],
    );
    assert.equal(DB.touched, false);
    assert.equal(AI.calls.length, 0);
  });

  test('an unset, missing, or mismatched origin is 403 and never receives wildcard CORS', async () => {
    const cases = [
      { request: postJson(validPayload(), { origin: OTHER_ORIGIN }), env: {} },
      { request: postJson(validPayload(), { origin: OMIT }), env: {} },
      { request: postJson(validPayload()), env: { ALLOWED_ORIGIN: OMIT } },
      { request: makeRequest({ method: 'OPTIONS', contentType: OMIT }), env: { ALLOWED_ORIGIN: OMIT } },
    ];
    for (const item of cases) {
      const { DB, AI, env } = makeEnv(SQL, item.env);
      const response = await handleRequest(item.request, env);
      assert.equal(response.status, 403);
      assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(DB.touched, false);
      assert.equal(AI.calls.length, 0);
    }
  });

  test('every method other than POST and OPTIONS returns 405', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
      const { DB, AI, env } = makeEnv(SQL);
      const response = await handleRequest(makeRequest({ method, contentType: OMIT }), env);
      await errorShape(response, 405);
      assertCors(response);
      assert.equal(DB.touched, false);
      assert.equal(AI.calls.length, 0);
    }
  });
});

describe('request validation', () => {
  async function reject(request, expectedField) {
    const { DB, AI, env } = makeEnv(SQL);
    const response = await handleRequest(request, env);
    await assertValidationError(response, expectedField);
    assert.equal(DB.touched, false, 'validation failures must not spend a rate-limit slot');
    assert.equal(AI.calls.length, 0, 'validation failures must not call AI');
  }

  test('rejects media types other than application/json, while accepting a charset parameter', async () => {
    for (const contentType of ['text/plain', 'application/jsonp', 'text/json', 'application/x-www-form-urlencoded']) {
      await reject(postJson(validPayload(), { contentType }), 'content-type');
    }
    const { response } = await accepted({}, validPayload());
    assert.equal(response.status, 200);
    const setup = makeEnv(SQL);
    const charset = await handleRequest(
      postJson(validPayload(), { contentType: 'application/json; charset=utf-8' }),
      setup.env,
    );
    assert.equal(charset.status, 200);
  });

  test('rejects declared and streamed bodies over 32768 bytes, and accepts exactly 32768 bytes', async () => {
    await reject(
      makeRequest({ body: validPayload(), headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }),
      'body',
    );
    await reject(makeRequest({ body: jsonBodyOfBytes(MAX_BODY_BYTES + 1) }), 'body');

    const { stream, state } = streamingBody(1024, 4096);
    await reject(makeRequest({ body: stream, headers: { 'Content-Length': OMIT } }), 'body');
    assert.ok(state.pulled <= Math.ceil(MAX_BODY_BYTES / 1024) + 1, 'oversized stream must be abandoned at the ceiling');

    const setup = makeEnv(SQL);
    const exact = await handleRequest(makeRequest({ body: jsonBodyOfBytes(MAX_BODY_BYTES) }), setup.env);
    assert.equal(exact.status, 200, 'the exact byte ceiling must remain accepted');
  });

  test('rejects malformed JSON and JSON values that are not objects', async () => {
    for (const body of ['{bad json', '', 'null', '[]', 'true', '42', '"text"']) {
      await reject(makeRequest({ body }), 'body');
    }
  });

  test('rejects missing, non-string, blank, one-character, and over-1000 messages', async () => {
    for (const message of [OMIT, null, 3, {}, [], '', '   ', 'x', 'x'.repeat(1001)]) {
      await reject(postJson(validPayload({ message })), 'message');
    }
  });

  test('accepts message lengths 2 and 1000 exactly', async () => {
    for (const message of ['xy', 'x'.repeat(1000)]) {
      const { response } = await accepted({}, validPayload({ message }));
      assert.equal(response.status, 200, `message length ${message.length} must be accepted`);
    }
  });

  test('rejects history when missing, not an array, or longer than 20 entries', async () => {
    for (const history of [OMIT, null, {}, 'history', 4, Array(21).fill({ role: 'user', content: 'entry' })]) {
      await reject(postJson(validPayload({ history })), 'history');
    }
  });

  test('rejects history entries with missing, non-string, or blank role or content', async () => {
    const invalid = [
      {},
      { role: 'user' },
      { content: 'entry' },
      { role: null, content: 'entry' },
      { role: 7, content: 'entry' },
      { role: '', content: 'entry' },
      { role: '   ', content: 'entry' },
      { role: 'user', content: null },
      { role: 'user', content: 7 },
      { role: 'user', content: '' },
      { role: 'user', content: '   ' },
    ];
    for (const entry of invalid) await reject(postJson(validPayload({ history: [entry] })), /^history(?:\[|$)/);
  });

  test('accepts exactly 20 valid history entries and forwards only the final four', async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `history entry ${index}`,
    }));
    const AI = createAiStub();
    const { response } = await accepted({ AI }, validPayload({ history }));
    assert.equal(response.status, 200);
    assert.deepEqual(AI.calls[1].input.messages.slice(1, -1), history.slice(-4));
  });

  test('missing IP_HASH_SALT is a hard 500 before hashing, D1, or AI', async () => {
    const { DB, AI, env } = makeEnv(SQL, { IP_HASH_SALT: OMIT });
    const response = await handleRequest(postJson(validPayload()), env);
    await errorShape(response, 500);
    assertCors(response);
    assert.equal(DB.touched, false);
    assert.equal(AI.calls.length, 0);
  });
});

describe('salted rolling D1 rate limit', () => {
  test('default 20/3600 accepts the twentieth request and rejects the twenty-first with Retry-After', async () => {
    const DB = createD1Stub(SQL);
    const AI = createAiStub();
    const env = { DB, AI, ALLOWED_ORIGIN, SITE_NAME, IP_HASH_SALT: SALT };

    for (let number = 1; number <= DEFAULT_LIMIT; number += 1) {
      const response = await handleRequest(postJson(validPayload()), env);
      assert.equal(response.status, 200, `request ${number} must be accepted`);
    }
    const rejected = await handleRequest(postJson(validPayload()), env);
    assert.equal(rejected.status, 429);
    assert.match(rejected.headers.get('retry-after'), /^\d+$/);
    assert.ok(Number(rejected.headers.get('retry-after')) >= 1);
    assertCors(rejected);

    const ipHash = await expectedIpHash();
    assert.equal(DB.usage(ipHash).total, DEFAULT_LIMIT, 'the rejected request must release its slot');
    assert.ok(DB.callsOf(RELEASE).length > 0, 'a 429 must issue the release statement');
    const lastPrune = DB.callsOf(PRUNE).at(-1).args;
    const lastRecord = DB.callsOf(RECORD).at(-1).args;
    assert.equal(lastRecord[1] - lastPrune[1], DEFAULT_WINDOW, 'the default rolling window is 3600 seconds');
  });

  test('configured max and rolling window replace the defaults at exact boundaries', async () => {
    const DB = createD1Stub(SQL);
    const ipHash = await expectedIpHash();
    const now = Math.floor(Date.now() / 1000);
    DB.seed(ipHash, { window_start: now - 59, count: 2 });
    const env = {
      DB,
      AI: createAiStub(),
      ALLOWED_ORIGIN,
      SITE_NAME,
      IP_HASH_SALT: SALT,
      RATE_LIMIT_MAX: '2',
      RATE_LIMIT_WINDOW_SECONDS: '60',
    };
    const response = await handleRequest(postJson(validPayload()), env);
    assert.equal(response.status, 429);
    const [, floor] = DB.callsOf(PRUNE).at(-1).args;
    const [, boundNow] = DB.callsOf(RECORD).at(-1).args;
    assert.equal(boundNow - floor, 60);
    assert.equal(DB.usage(ipHash).total, 2);
  });

  test('only entries aged out of the rolling window stop counting', async () => {
    const DB = createD1Stub(SQL);
    const ipHash = await expectedIpHash();
    const now = Math.floor(Date.now() / 1000);
    DB.seed(
      ipHash,
      { window_start: now - DEFAULT_WINDOW, count: 1 },
      { window_start: now - 1, count: DEFAULT_LIMIT - 1 },
    );
    const env = { DB, AI: createAiStub(), ALLOWED_ORIGIN, SITE_NAME, IP_HASH_SALT: SALT };
    const response = await handleRequest(postJson(validPayload()), env);
    assert.equal(response.status, 200, 'the exact-floor entry is pruned and frees one slot');
    assert.equal(DB.usage(ipHash).total, DEFAULT_LIMIT);
  });

  test('D1 receives only sha256(IP + salt), never the raw client IP', async () => {
    const { DB, response } = await accepted();
    assert.equal(response.status, 200);
    const expected = await expectedIpHash(CLIENT_IP, SALT);
    for (const call of DB.calls) {
      assert.equal(call.args[0], expected);
      assert.equal(call.args.some((value) => String(value).includes(CLIENT_IP)), false);
    }
    assert.deepEqual(DB.calls.map((call) => call.kind), [PRUNE, RECORD, COUNT]);
  });
});
