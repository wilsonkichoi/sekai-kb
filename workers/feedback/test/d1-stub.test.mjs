/**
 * Self-test of the test harness (workers/feedback/test/d1-stub.mjs).
 *
 * The D1 stub encodes the rate-limit upsert semantics the contract documents, so a bug in
 * the stub would produce false verdicts about the worker. These tests do not touch the
 * worker at all; they keep the harness honest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createD1Stub, INSERT_COLUMNS } from './d1-stub.mjs';

const SQL = {
  RATE_LIMIT_UPSERT: '<<rate limit upsert statement>>',
  INSERT_FEEDBACK: '<<insert feedback statement>>',
};

const NOW = 1_700_000_000;
const WINDOW = 3600;
const IP_HASH = 'a'.repeat(64);

function rateLimit(stub, { ipHash = IP_HASH, now = NOW, window = WINDOW } = {}) {
  return stub.prepare(SQL.RATE_LIMIT_UPSERT).bind(ipHash, now, now - window).first();
}

function insertRow(stub, overrides = {}) {
  const values = {
    id: 'id-1',
    created_at: '2026-01-01T00:00:00.000Z',
    page: '/guides/example/',
    category: 'correction',
    message: 'a message that is long enough',
    contact: null,
    user_agent: null,
    status: 'new',
    ...overrides,
  };
  return stub
    .prepare(SQL.INSERT_FEEDBACK)
    .bind(...INSERT_COLUMNS.map((column) => values[column]))
    .run();
}

test('harness: a first rate-limit call stores window_start = now and count = 1', async () => {
  const stub = createD1Stub(SQL);
  const row = await rateLimit(stub);
  assert.deepEqual(row, { window_start: NOW, count: 1 });
});

test('harness: repeat rate-limit calls inside the window increment the count and keep window_start', async () => {
  const stub = createD1Stub(SQL);
  await rateLimit(stub);
  await rateLimit(stub, { now: NOW + 5 });
  const third = await rateLimit(stub, { now: NOW + 9 });
  assert.deepEqual(third, { window_start: NOW, count: 3 });
});

test('harness: a rate-limit row at or before the window floor is replaced with a fresh window', async () => {
  const stub = createD1Stub(SQL);
  stub.seedRateLimit(IP_HASH, { window_start: NOW - WINDOW, count: 99 });
  const row = await rateLimit(stub);
  assert.deepEqual(row, { window_start: NOW, count: 1 });
});

test('harness: rate-limit rows are isolated per ip hash', async () => {
  const stub = createD1Stub(SQL);
  await rateLimit(stub, { ipHash: 'a'.repeat(64) });
  await rateLimit(stub, { ipHash: 'a'.repeat(64) });
  const other = await rateLimit(stub, { ipHash: 'b'.repeat(64) });
  assert.deepEqual(other, { window_start: NOW, count: 1 });
});

test('harness: the returned rate-limit row is a copy the caller cannot mutate', async () => {
  const stub = createD1Stub(SQL);
  const first = await rateLimit(stub);
  first.count = 1000;
  const second = await rateLimit(stub);
  assert.equal(second.count, 2);
});

test('harness: an insert records its bound columns and reports one changed row', async () => {
  const stub = createD1Stub(SQL);
  const result = await insertRow(stub, { contact: 'reader@example.invalid' });
  assert.equal(result.success, true);
  assert.equal(result.meta.changes, 1);
  assert.equal(stub.rows.length, 1);
  assert.equal(stub.rows[0].contact, 'reader@example.invalid');
  assert.equal(stub.rows[0].status, 'new');
});

test('harness: all() is implemented and returns the documented result envelope', async () => {
  const stub = createD1Stub(SQL);
  const result = await stub.prepare(SQL.RATE_LIMIT_UPSERT).bind(IP_HASH, NOW, NOW - WINDOW).all();
  assert.equal(result.success, true);
  assert.deepEqual(result.results, [{ window_start: NOW, count: 1 }]);
});

test('harness: statements are routed by identity, and an unknown statement throws', () => {
  const stub = createD1Stub(SQL);
  assert.throws(() => stub.prepare('SELECT 1'), /unknown prepared statement/);
});

test('harness: a wrong bind-argument count throws instead of silently storing a bad row', async () => {
  const stub = createD1Stub(SQL);
  await assert.rejects(
    () => stub.prepare(SQL.INSERT_FEEDBACK).bind('only', 'three', 'args').run(),
    /expects 8 bind args/,
  );
  await assert.rejects(
    () => stub.prepare(SQL.RATE_LIMIT_UPSERT).bind(IP_HASH).first(),
    /expects 3 bind args/,
  );
});

test('harness: touched reports any D1 contact, prepare included', async () => {
  const stub = createD1Stub(SQL);
  assert.equal(stub.touched, false);
  stub.prepare(SQL.INSERT_FEEDBACK);
  assert.equal(stub.touched, true);
  assert.equal(stub.calls.length, 0);
});

test('harness: createD1Stub rejects an SQL object it cannot route by identity', () => {
  assert.throws(() => createD1Stub(null), TypeError);
  assert.throws(() => createD1Stub({ RATE_LIMIT_UPSERT: 'x' }), TypeError);
  assert.throws(
    () => createD1Stub({ RATE_LIMIT_UPSERT: 'same', INSERT_FEEDBACK: 'same' }),
    TypeError,
  );
});
