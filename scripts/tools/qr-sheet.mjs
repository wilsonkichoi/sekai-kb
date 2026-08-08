#!/usr/bin/env node
// qr-sheet.mjs -- print the QR codes that deep link into this instance's chat.
//
// Every context declared in `knowledge/chat/_contexts.md` becomes one card: the code
// that opens `https://<domain>/chat?ctx=<slug>`, the place's name, and the URL as
// text for anyone who would rather type it. The result is a single self-contained
// HTML file you open and print -- there is no `/qr` route, because a public page
// would publish the internal context map for no visitor benefit and would change a
// gated statement about this site's route list.
//
// An instance with no manifest exits 0 saying so. Declaring no context is not a
// failure; it means this place has nothing to put on a wall yet.
//
// Usage:
//   npm run qr:sheet
//   npm run qr:sheet -- --domain example.invalid
//   npm run qr:sheet -- --out reports/codes.html
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no place-specific string.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readChatContexts, CONTEXT_MANIFEST_PATH } from '../../src/lib/chat-contexts.ts';
import { renderSheet, SHEET_OUTPUT_PATH } from '../lib/qr-sheet.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function fail(message) {
  console.error(`qr-sheet: ${message}`);
  process.exit(1);
}

/* -- arguments ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const options = { root: DEFAULT_ROOT, out: SHEET_OUTPUT_PATH };
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i];
  const value = argv[i + 1];
  if (['--domain', '--out', '--root', '--topics'].includes(flag)) {
    if (!value) fail(`${flag} needs a value.`);
    options[flag.slice(2)] = value;
    i += 1;
  } else {
    fail(`unknown argument "${flag}".`);
  }
}
const root = resolve(options.root);

/* -- place config ----------------------------------------------------------- */

const configPath = join(root, 'place.config.ts');
let place = null;
if (existsSync(configPath)) {
  try {
    place = (await import(pathToFileURL(configPath).href)).default;
  } catch (error) {
    fail(
      `place.config.ts could not be imported (${error.message}).\n` +
        '  Run this through `npm run qr:sheet`, which passes the type-stripping flag Node needs.',
    );
  }
}

const domain = (options.domain ?? place?.place?.domain ?? '').trim();
if (!domain) {
  fail('no domain to encode. Set `place.domain` in place.config.ts, or pass --domain <host>.');
}

/* -- the routes a context `article` may resolve to --------------------------- */
//
// Only supplied when this build has actually produced them. Passing an empty or
// stale set would drop every context that declares an `article` -- and a card
// silently missing off a printed sheet is worse than a link this run could not
// verify, which the reader is warned about instead (src/lib/chat-contexts.ts).

const topicsPath = resolve(root, options.topics ?? 'public/kb/topics.json');
let knownRoutes;
if (existsSync(topicsPath)) {
  try {
    const topics = JSON.parse(readFileSync(topicsPath, 'utf8'));
    if (Array.isArray(topics)) {
      knownRoutes = topics.map((topic) => topic?.url).filter((url) => typeof url === 'string');
    }
  } catch (error) {
    console.warn(`qr-sheet: ${topicsPath} could not be read (${error.message}); article links are omitted.`);
  }
} else if (options.topics) {
  fail(`--topics ${options.topics} does not exist.`);
}

/* -- read, render, write ----------------------------------------------------- */

// The reader emits its own diagnostics to the console, so a dropped context is
// visible here without this file reprinting the list.
const { contexts } = readChatContexts(root, knownRoutes ? { knownRoutes } : {});

if (contexts.length === 0) {
  console.log(
    `OK: no contexts declared in ${CONTEXT_MANIFEST_PATH} -- nothing to print. ` +
      'Declare one to put a code on a wall.',
  );
  process.exit(0);
}

const html = renderSheet({
  contexts,
  domain,
  siteName: (place?.place?.name ?? '').trim(),
  generated: new Date().toISOString(),
});

const outPath = resolve(root, options.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

console.log(`qr-sheet: ${contexts.length} context(s) from ${CONTEXT_MANIFEST_PATH}`);
for (const context of contexts) console.log(`qr-sheet:   ${context.slug}  ${context.label}`);
console.log(`OK: sheet written to ${options.out}. Open it and print; it lays out on A4 and US Letter.`);
