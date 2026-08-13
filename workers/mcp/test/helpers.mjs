/**
 * Shared fixtures for the MCP worker suites.
 *
 * Everything here is synthetic. workers/ is framework code that ships to every adopter,
 * so no fixture may assume the demo corpus, the demo config, or any place name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeArtifact } from '../../lib/corpus.mjs';

export const SITE_ORIGIN = 'https://kb.example.invalid';
export const SITE_NAME = 'Example Knowledge Base';
export const CLIENT_IP = '203.0.113.17';
export const SALT = 'mcp-contract-test-salt-0123456789';
export const WORKER_URL = 'https://mcp.example.invalid/';

/** The site's /kb/topics.json shape, as build-kb-index.mjs emits it. */
export const TOPICS = [
  {
    title: 'Alpha Guide',
    description: 'How the alpha works.',
    category: 'guides',
    tags: ['alpha', 'reference'],
    url: '/guides/alpha',
    kb: '/kb/articles/guides/alpha.md',
    readingTime: 3,
    date: '2026-01-02T00:00:00.000Z',
    featured: false,
  },
  {
    title: 'Bravo Guide',
    description: 'The bravo procedure end to end.',
    category: 'guides',
    tags: ['bravo'],
    url: '/guides/bravo',
    kb: '/kb/articles/guides/bravo.md',
    readingTime: 5,
    date: '2026-01-03T00:00:00.000Z',
    featured: true,
  },
  {
    title: 'Charlie Overview',
    description: 'Background on charlie.',
    category: 'notes',
    tags: ['charlie'],
    url: '/notes/charlie',
    kb: '/kb/articles/notes/charlie.md',
    readingTime: 2,
    date: '2026-01-04T00:00:00.000Z',
    featured: false,
  },
];

/** The site's /kb/search-index.json shape, as build-search-index.mjs emits it. */
export const SEARCH_DOCS = TOPICS.map((topic) => ({
  t: topic.title,
  d: topic.description,
  u: topic.url,
  tags: topic.tags,
  lang: 'en',
}));

export const ALPHA_MARKDOWN = '---\ntitle: Alpha Guide\n---\n\nThe alpha body.\n';

/**
 * A `fetch` stand-in over a `{path: {status, body, contentType}}` table, recording every
 * call so a test can assert the URL and the edge-cache options the worker asked for.
 * A path with no entry answers 404, which is what the deployed site does.
 */
export function createFetchStub(routes = {}) {
  const calls = [];
  const table = {
    '/kb/topics.json': { body: JSON.stringify(TOPICS) },
    '/kb/search-index.json': { body: JSON.stringify(SEARCH_DOCS) },
    '/kb/articles/guides/alpha.md': { body: ALPHA_MARKDOWN, contentType: 'text/markdown' },
    ...routes,
  };
  const impl = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const route = table[path];
    if (!route) return new Response('not found', { status: 404 });
    if (route.throws) throw new Error(route.throws);
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: { 'Content-Type': route.contentType ?? 'application/json' },
    });
  };
  impl.calls = calls;
  return impl;
}

/**
 * Workers AI stand-in. `query` is the raw embedding returned for any text, so a test
 * steers retrieval by choosing a direction rather than by stubbing the ranking.
 */
export function createAiStub({ query = [10, 0, 0], throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (throws) throw new Error(throws);
      return { data: [query] };
    },
  };
}

/**
 * The decoded synthetic corpus, from the same fixture workers/chat/ installs.
 *
 * Six unit vectors that rank strictly against the default query [10, 0, 0]:
 * alpha 1.000, bravo 0.898, charlie 0.709, delta 0.504, echo 0.197, foxtrot -1.000.
 * The shipped 0.46 floor therefore admits exactly the first four.
 */
export const FIXTURE_CORPUS = decodeArtifact(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../lib/test/fixtures/corpus-vectors.fixture.json', import.meta.url)),
      'utf8',
    ),
  ),
);

/** Titles the shipped floor admits for the default query, best first. */
export const FLOORED_TITLES = ['Alpha Guide', 'Bravo Guide', 'Charlie Guide', 'Delta Guide'];

export function makeEnv(overrides = {}) {
  return {
    SITE_ORIGIN,
    SITE_NAME,
    IP_HASH_SALT: SALT,
    ...overrides,
  };
}

/** An HTTP request carrying one JSON-RPC message or a legacy batch. */
export function rpcRequest(
  body,
  { method = 'POST', ip = CLIENT_IP, origin, protocolVersion } = {},
) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  });
  if (ip) headers.set('CF-Connecting-IP', ip);
  if (origin !== undefined) headers.set('Origin', origin);
  if (protocolVersion !== undefined) headers.set('MCP-Protocol-Version', protocolVersion);
  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(WORKER_URL, init);
}

export const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
