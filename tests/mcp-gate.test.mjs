// The MCP surface gate: `features.mcp` AND a non-empty `workers.mcp`.
//
// Four combinations, and only one of them advertises anything. The gate lives in
// src/lib/mcp.ts so the build-time consumer (llms.txt, via build-kb-index.mjs) and every
// later surface cannot drift apart, so this asserts the predicate AND that the consumer
// consults it -- a correct predicate nobody calls would pass a test of the predicate
// alone.
//
// The absent-key cases are the load-bearing ones. `features.mcp` and `workers.mcp` are
// new keys, and an instance merges a framework release without editing its config, so a
// read that threw on a config predating them would break every existing adopter's build
// (SPEC: new place.config keys must be absent-safe).
//
// Fixtures here are synthetic. tests/ is framework code that ships to every adopter, so
// nothing may assume the demo corpus, the demo config, or any place name.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { resolveMcp } from '../src/lib/mcp.ts';

const ENDPOINT = 'https://mcp.example.invalid';

/** A config carrying only what the gate reads. */
const config = (mcpFlag, workers) => ({ features: { mcp: mcpFlag }, workers });

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the four flag and endpoint combinations resolve to one enabled state', () => {
  // 1. flag off, endpoint present -- a deliberate "configured but not yet on".
  assert.deepEqual(resolveMcp(config(false, { mcp: ENDPOINT })), {
    enabled: false,
    endpoint: ENDPOINT,
  });

  // 2. flag on, no `workers` block at all -- a config written before the key existed.
  assert.deepEqual(resolveMcp(config(true, undefined)), { enabled: false, endpoint: '' });

  // 3. flag on, endpoint present but empty -- the worker is not deployed yet.
  assert.deepEqual(resolveMcp(config(true, { mcp: '' })), { enabled: false, endpoint: '' });

  // 4. both halves present -- the only enabled state.
  assert.deepEqual(resolveMcp(config(true, { mcp: ENDPOINT })), {
    enabled: true,
    endpoint: ENDPOINT,
  });
});

test('a config predating either key reads as off instead of throwing', () => {
  // The absent-safe contract, stated as the three shapes an upgrading instance can be
  // in: no `features.mcp`, no `workers` block, and neither.
  assert.deepEqual(resolveMcp({ features: { chat: true }, workers: { chat: ENDPOINT } }), {
    enabled: false,
    endpoint: '',
  });
  assert.deepEqual(resolveMcp({ features: { mcp: true } }), { enabled: false, endpoint: '' });
  assert.deepEqual(resolveMcp({}), { enabled: false, endpoint: '' });
});

test('a whitespace-only endpoint is empty, and the endpoint is trimmed', () => {
  assert.deepEqual(resolveMcp(config(true, { mcp: '   ' })), { enabled: false, endpoint: '' });
  assert.deepEqual(resolveMcp(config(true, { mcp: `  ${ENDPOINT}  ` })), {
    enabled: true,
    endpoint: ENDPOINT,
  });
});

test('a truthy non-true flag does not enable the endpoint', () => {
  // `features.mcp` is a boolean in the schema; a string from a hand-edited config must
  // not slip through as truthy.
  assert.equal(resolveMcp(config('yes', { mcp: ENDPOINT })).enabled, false);
  assert.equal(resolveMcp(config(1, { mcp: ENDPOINT })).enabled, false);
});

test('the llms.txt generator advertises the endpoint through the shared predicate', () => {
  const generator = source('../scripts/core/build-kb-index.mjs');
  assert.match(
    generator,
    /resolveMcp/,
    'build-kb-index.mjs must resolve the MCP surface through src/lib/mcp.ts',
  );
  assert.match(
    generator,
    /mcp\.enabled/,
    'the MCP line in llms.txt must be gated on the resolved surface',
  );
});
