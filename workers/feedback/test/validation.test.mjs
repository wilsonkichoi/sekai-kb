/**
 * LB-69 DoD 4: every documented 400 validation class gets its own test, plus the
 * boundary values that must still be accepted, the trimming rule, and the fixed order of
 * the content-type / size / parse / validation checks.
 *
 * Contract: each class answers 400 with exactly `{error, field}` and touches no D1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest, SQL } from '../src/index.mjs';
import { createD1Stub } from './d1-stub.mjs';
import {
  MAX_BODY_BYTES,
  MAX_CATEGORY,
  MAX_CONTACT,
  MAX_MESSAGE,
  MAX_PAGE,
  MIN_MESSAGE,
  OMIT,
  assertErrorBody,
  assertSuccessBody,
  chars,
  makeEnv,
  makeRequest,
  postJson,
  validPayload,
} from './helpers.mjs';

/** Send a request and assert the documented 400 body, with no D1 contact. */
async function expectRejected(requestOptions, { status = 400, error, field } = {}) {
  const DB = createD1Stub(SQL);
  const response = await handleRequest(makeRequest(requestOptions), makeEnv({ DB }));

  assert.equal(response.status, status, `expected ${status} for ${error}/${field}`);
  await assertErrorBody(response, error, field);
  assert.equal(DB.touched, false, 'a rejected request must not touch D1');
  return response;
}

/** Send a payload and assert it is accepted, so a boundary test proves the limit is exact. */
async function expectAccepted(payload, requestOptions = {}) {
  const DB = createD1Stub(SQL);
  const response = await handleRequest(postJson(payload, requestOptions), makeEnv({ DB }));

  assert.equal(response.status, 200, 'expected the payload to be accepted');
  await assertSuccessBody(response);
  assert.equal(DB.rows.length, 1, 'an accepted payload must insert exactly one row');
  return DB.rows[0];
}

/** A JSON body of exactly `target` UTF-8 bytes, valid apart from its size. */
function jsonBodyOfBytes(target) {
  const base = validPayload();
  const encoder = new TextEncoder();
  const empty = JSON.stringify({ ...base, filler: '' });
  const deficit = target - encoder.encode(empty).length;
  assert.ok(deficit >= 0, 'target size must exceed the minimum valid payload');
  const body = JSON.stringify({ ...base, filler: chars(deficit) });
  assert.equal(encoder.encode(body).length, target, 'fixture must be exactly the target size');
  return body;
}

// --- required fields -------------------------------------------------------------

test('400 required/page when page is missing, non-string, or blank after trim', async () => {
  for (const page of [OMIT, null, 123, true, {}, [], '', '   ', '\t\n ']) {
    await expectRejected(
      { body: validPayload({ page }) },
      { error: 'required', field: 'page' },
    );
  }
});

test('400 required/category when category is missing, non-string, or blank after trim', async () => {
  for (const category of [OMIT, null, 7, false, {}, [], '', '  ', '\n']) {
    await expectRejected(
      { body: validPayload({ category }) },
      { error: 'required', field: 'category' },
    );
  }
});

test('400 required/message when message is missing, non-string, or blank after trim', async () => {
  for (const message of [OMIT, null, 42, {}, [], '', '     ', '\t']) {
    await expectRejected(
      { body: validPayload({ message }) },
      { error: 'required', field: 'message' },
    );
  }
});

// --- format and length -----------------------------------------------------------

test('400 invalid_format/page when page does not start with a slash', async () => {
  for (const page of ['guides/example/', 'https://kb.example.invalid/guides/example/', '../guides', 'x']) {
    await expectRejected(
      { body: validPayload({ page }) },
      { error: 'invalid_format', field: 'page' },
    );
  }
});

test('400 too_long/page when page exceeds 200 characters', async () => {
  await expectRejected(
    { body: validPayload({ page: `/${chars(MAX_PAGE)}` }) },
    { error: 'too_long', field: 'page' },
  );
});

test('a page of exactly 200 characters is accepted', async () => {
  const page = `/${chars(MAX_PAGE - 1)}`;
  assert.equal(page.length, MAX_PAGE);
  const row = await expectAccepted(validPayload({ page }));
  assert.equal(row.page, page);
});

test('400 too_long/category when category exceeds 64 characters', async () => {
  await expectRejected(
    { body: validPayload({ category: chars(MAX_CATEGORY + 1, 'c') }) },
    { error: 'too_long', field: 'category' },
  );
});

test('a category of exactly 64 characters is accepted', async () => {
  const category = chars(MAX_CATEGORY, 'c');
  const row = await expectAccepted(validPayload({ category }));
  assert.equal(row.category, category);
});

test('400 too_short/message when message is under 10 characters', async () => {
  await expectRejected(
    { body: validPayload({ message: chars(MIN_MESSAGE - 1, 'm') }) },
    { error: 'too_short', field: 'message' },
  );
});

test('a message of exactly 10 characters is accepted', async () => {
  const message = chars(MIN_MESSAGE, 'm');
  const row = await expectAccepted(validPayload({ message }));
  assert.equal(row.message, message);
});

test('400 too_long/message when message exceeds 4000 characters', async () => {
  await expectRejected(
    { body: validPayload({ message: chars(MAX_MESSAGE + 1, 'm') }) },
    { error: 'too_long', field: 'message' },
  );
});

test('a message of exactly 4000 characters is accepted', async () => {
  const message = chars(MAX_MESSAGE, 'm');
  const row = await expectAccepted(validPayload({ message }));
  assert.equal(row.message.length, MAX_MESSAGE);
});

test('400 too_long/contact when contact is present and exceeds 200 characters', async () => {
  const contact = `${chars(MAX_CONTACT - 9)}@e.invalid`;
  assert.equal(contact.length, MAX_CONTACT + 1);
  await expectRejected(
    { body: validPayload({ contact }) },
    { error: 'too_long', field: 'contact' },
  );
});

test('a contact of exactly 200 characters is accepted', async () => {
  const contact = `${chars(MAX_CONTACT - 10)}@e.invalid`;
  assert.equal(contact.length, MAX_CONTACT);
  const row = await expectAccepted(validPayload({ contact }));
  assert.equal(row.contact, contact);
});

test('400 invalid_format/contact when contact is present and contains no at sign', async () => {
  for (const contact of ['no-at-sign', 'reader.example.invalid', '12345']) {
    await expectRejected(
      { body: validPayload({ contact }) },
      { error: 'invalid_format', field: 'contact' },
    );
  }
});

// --- transport-level classes -----------------------------------------------------

test('400 invalid_content_type/content-type when the body is not application/json', async () => {
  for (const contentType of ['text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded', 'text/json']) {
    await expectRejected(
      { body: validPayload(), contentType },
      { error: 'invalid_content_type', field: 'content-type' },
    );
  }
});

test('application/json with a charset parameter is accepted', async () => {
  await expectAccepted(validPayload(), { contentType: 'application/json; charset=utf-8' });
});

test('400 payload_too_large/body when the body exceeds 8192 bytes', async () => {
  await expectRejected(
    { body: jsonBodyOfBytes(MAX_BODY_BYTES + 1) },
    { error: 'payload_too_large', field: 'body' },
  );
});

test('a body of exactly 8192 bytes is accepted', async () => {
  const DB = createD1Stub(SQL);
  const body = jsonBodyOfBytes(MAX_BODY_BYTES);
  const response = await handleRequest(makeRequest({ body }), makeEnv({ DB }));

  assert.equal(response.status, 200);
  await assertSuccessBody(response);
});

test('400 payload_too_large/body when Content-Length alone declares more than 8192 bytes', async () => {
  await expectRejected(
    { body: validPayload(), headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } },
    { error: 'payload_too_large', field: 'body' },
  );
});

test('400 invalid_json/body for a body that is not parseable JSON', async () => {
  for (const body of ['{not json', '', '{"page": }', '{"page": "/a",']) {
    await expectRejected({ body }, { error: 'invalid_json', field: 'body' });
  }
});

test('400 invalid_json/body for JSON that is not an object', async () => {
  for (const body of ['[]', '"a string"', '42', 'null', 'true', '[{"page":"/guides/example/"}]']) {
    await expectRejected({ body }, { error: 'invalid_json', field: 'body' });
  }
});

// --- trimming and check order ----------------------------------------------------

test('length checks apply to the trimmed value, not the raw string', async () => {
  // Trimmed length is 9, which is under the minimum even though the raw string is 13.
  await expectRejected(
    { body: validPayload({ message: `  ${chars(MIN_MESSAGE - 1, 'm')}  ` }) },
    { error: 'too_short', field: 'message' },
  );
  // Trimmed length is exactly 200, so surrounding whitespace must not push it over.
  const page = `  /${chars(MAX_PAGE - 1)}  `;
  const row = await expectAccepted(validPayload({ page }));
  assert.equal(row.page, page.trim());
});

test('the blank check precedes the format and length checks for the same field', async () => {
  // A blank page neither starts with a slash nor is too long: required must win.
  await expectRejected({ body: validPayload({ page: '   ' }) }, { error: 'required', field: 'page' });
  await expectRejected({ body: validPayload({ category: '   ' }) }, { error: 'required', field: 'category' });
});

test('content-type is checked before body size, which is checked before JSON parsing', async () => {
  // Wrong content type and an oversized body: the content-type class wins.
  await expectRejected(
    { body: jsonBodyOfBytes(MAX_BODY_BYTES + 1), contentType: 'text/plain' },
    { error: 'invalid_content_type', field: 'content-type' },
  );
  // Oversized body that is also unparseable: the size class wins.
  await expectRejected(
    { body: `{${chars(MAX_BODY_BYTES + 1)}` },
    { error: 'payload_too_large', field: 'body' },
  );
  // Unparseable body that would also fail validation: the parse class wins.
  await expectRejected({ body: '{"page":' }, { error: 'invalid_json', field: 'body' });
});

test('an unknown extra field in the payload does not reject an otherwise valid submission', async () => {
  const row = await expectAccepted(validPayload({ unexpected: 'ignored' }));
  assert.equal(row.page, '/guides/example/');
});
