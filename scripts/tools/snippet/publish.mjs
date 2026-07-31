#!/usr/bin/env node
// publish.mjs -- `npm run snippet:publish`.
//
// Reads knowledge/SNIPPET-INBOX.md, publishes every `approved` entry through the
// adapter imported below, and writes `posted` plus the returned URL back into the
// file. `pending`, `posted`, and `rejected` entries are left untouched.
//
// The adapter is chosen by the import on the next line and nothing else: there is
// no registry, no loader, no plugin path, and no environment variable. Wiring a
// platform adapter means editing that import, which is a code review -- see
// ./README.md for why that is the intended cost.
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publishApproved, QueueError } from './queue.mjs';
import { manualAdapter, closeManualAdapter } from './manual-adapter.mjs';

const adapter = manualAdapter;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const QUEUE = join(ROOT, 'knowledge', 'SNIPPET-INBOX.md');
const QUEUE_LABEL = 'knowledge/SNIPPET-INBOX.md';

if (process.argv.length > 2) {
  console.error(`FAIL: ${process.argv.slice(2).join(' ')}: this runner takes no arguments.`);
  process.exit(2);
}

if (!existsSync(QUEUE)) {
  console.log(`OK: no ${QUEUE_LABEL} in this checkout -- nothing to publish. Run /sekai-snippet to create it.`);
  process.exit(0);
}

const source = readFileSync(QUEUE, 'utf8');

let result;
try {
  result = await publishApproved(source, adapter, { log: (line) => console.log(line) });
} catch (err) {
  if (err instanceof QueueError) {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }
  throw err;
} finally {
  closeManualAdapter();
}

if (result.text !== source) writeFileSync(QUEUE, result.text);

const byStatus = new Map();
for (const entry of result.skipped) byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
const skippedSummary =
  [...byStatus.entries()].sort().map(([status, count]) => `${count} ${status}`).join(', ') || 'none';

console.log(`\nadapter: ${adapter.id} (maxChars ${adapter.maxChars})`);
console.log(`published: ${result.published.length}`);
for (const entry of result.published) console.log(`  ${entry.id} -> ${entry.url}`);
console.log(`left alone: ${skippedSummary}`);

if (result.refused.length > 0) {
  console.error(`refused: ${result.refused.length}`);
  for (const entry of result.refused) console.error(`  ${entry.id}: ${entry.reason}`);
  console.error(`\nFAIL: ${result.refused.length} approved entr(y/ies) were not published.`);
  process.exit(1);
}

console.log(`OK: ${QUEUE_LABEL} is up to date.`);
