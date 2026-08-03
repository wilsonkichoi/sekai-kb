#!/usr/bin/env node
// check-sounds.mjs -- `npm run sounds:check`.
//
// Validates the soundscape manifest against the schema exported by
// src/lib/sounds.ts and the filesystem under public/. Exits nonzero when a
// committed inconsistency would silently drop a recording at build time:
//
//   - a recording missing a required field
//   - a `file` that does not resolve under public/
//   - a `file` escaping public/ (leading-slash violation or `..` segment)
//   - a duplicate category `id`
//
// An mp3 under public/media/sounds/ that no entry references is REPORTED on
// stdout and does NOT fail -- an adopter mid-session legitimately has one.
//
// The field lists are IMPORTED from the reader, never restated here. If the
// reader adds a field, this gate demands it without a second edit.
//
// Usage: node scripts/ci/check-sounds.mjs [--root <path>]
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RECORDING_REQUIRED_FIELDS,
  RECORDING_OPTIONAL_FIELDS,
  CATEGORY_REQUIRED_FIELDS,
  CATEGORY_OPTIONAL_FIELDS,
  WISHLIST_REQUIRED_FIELDS,
  MANIFEST_PATH,
} from '../../src/lib/sounds.ts';

import matter from 'gray-matter';

const ROOT = (() => {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--root');
  if (idx !== -1 && args[idx + 1]) return resolve(args[idx + 1]);
  return fileURLToPath(new URL('../..', import.meta.url));
})();

const MANIFEST_ABS = join(ROOT, MANIFEST_PATH);
const PUBLIC_DIR = join(ROOT, 'public');
const SOUNDS_DIR = join(PUBLIC_DIR, 'media', 'sounds');

const errors = [];
const warnings = [];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafePublicPath(file) {
  if (!file.startsWith('/')) return false;
  return !file.split(/[\\/]/).includes('..');
}

if (!existsSync(MANIFEST_ABS)) {
  console.log(`OK: no ${MANIFEST_PATH} -- soundscape is unconfigured; nothing to check.`);
  process.exit(0);
}

let raw;
try {
  raw = readFileSync(MANIFEST_ABS, 'utf8');
} catch (err) {
  console.error(`FAIL: cannot read ${MANIFEST_PATH}: ${err.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = matter(raw);
} catch (err) {
  console.error(`FAIL: ${MANIFEST_PATH} frontmatter parse error: ${err.message}`);
  process.exit(1);
}

const data = parsed.data || {};
const referencedFiles = new Set();

function checkRecording(entry, index, categoryId) {
  const at = categoryId
    ? `entry ${index} in category "${categoryId}"`
    : `entry ${index}`;

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    errors.push(`${MANIFEST_PATH}: ${at} is not a mapping.`);
    return;
  }

  const missing = RECORDING_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(entry[f]));
  if (missing.length > 0) {
    errors.push(
      `${MANIFEST_PATH}: ${at} is missing required field(s): ${missing.join(', ')}.`,
    );
    return;
  }

  const file = entry.file.trim();

  if (!isSafePublicPath(file)) {
    errors.push(
      `${MANIFEST_PATH}: ${at} declares file "${file}" which is not a safe ` +
        'site-root-absolute path (must start with "/" and contain no ".." segment).',
    );
    return;
  }

  const diskPath = join(PUBLIC_DIR, file);
  if (!existsSync(diskPath)) {
    errors.push(
      `${MANIFEST_PATH}: ${at} declares file "${file}" which does not exist under public/.`,
    );
    return;
  }

  referencedFiles.add(file);
}

function checkCategory(cat, index, seenIds) {
  if (typeof cat !== 'object' || cat === null || Array.isArray(cat)) {
    errors.push(`${MANIFEST_PATH}: category ${index} is not a mapping.`);
    return;
  }

  const missing = CATEGORY_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(cat[f]));
  if (missing.length > 0) {
    errors.push(
      `${MANIFEST_PATH}: category ${index} is missing required field(s): ${missing.join(', ')}.`,
    );
    return;
  }

  const id = cat.id.trim();
  if (seenIds.has(id)) {
    errors.push(
      `${MANIFEST_PATH}: category ${index} repeats id "${id}" -- category ids must be unique.`,
    );
  }
  seenIds.add(id);

  const sounds = cat.sounds;
  if (sounds !== undefined && sounds !== null) {
    if (!Array.isArray(sounds)) {
      errors.push(
        `${MANIFEST_PATH}: category "${id}" has a non-list \`sounds\` field.`,
      );
    } else {
      sounds.forEach((entry, i) => checkRecording(entry, i, id));
    }
  }
}

const categories = data.categories;
if (Array.isArray(categories)) {
  const seenIds = new Set();
  categories.forEach((cat, i) => checkCategory(cat, i, seenIds));
} else if (categories !== undefined && categories !== null) {
  errors.push(`${MANIFEST_PATH}: \`categories\` must be a list.`);
} else {
  const sounds = data.sounds;
  if (sounds !== undefined && sounds !== null) {
    if (!Array.isArray(sounds)) {
      errors.push(`${MANIFEST_PATH}: \`sounds\` must be a list.`);
    } else {
      sounds.forEach((entry, i) => checkRecording(entry, i, null));
    }
  }
}

// Orphan detection: mp3 files under public/media/sounds/ not referenced.
if (existsSync(SOUNDS_DIR)) {
  let files;
  try {
    files = readdirSync(SOUNDS_DIR);
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith('.mp3')) continue;
    const publicPath = `/media/sounds/${file}`;
    if (!referencedFiles.has(publicPath)) {
      warnings.push(`orphan: ${publicPath} exists under public/ but no manifest entry references it.`);
    }
  }
}

if (warnings.length > 0) {
  for (const w of warnings) console.log(w);
}

if (errors.length > 0) {
  console.error(`FAIL: ${MANIFEST_PATH} has ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const entryCount = referencedFiles.size;
console.log(
  `OK: ${MANIFEST_PATH} is valid -- ${entryCount} recording(s) checked` +
    `${warnings.length > 0 ? `; ${warnings.length} orphan(s) reported` : ''}.`,
);
