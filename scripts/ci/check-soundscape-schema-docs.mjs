#!/usr/bin/env node
// check-soundscape-schema-docs.mjs -- the soundscape manifest schema documentation gate.
//
// `src/lib/sounds.ts` is the only implementation of the `knowledge/sounds/_manifest.md`
// schema, and two documents restate that schema in prose: docs/SPEC.md (New builds, 4)
// and the manifest's own body, which is what an adopter reads before editing the file.
// Prose that drifts from the reader is worse than absent prose, because it gets believed
// rather than looked up, and this repository is a template -- a wrong field list
// propagates to every adopter on the next tag merge
// (`.agent-toolkit/rules/guard-or-explain-prose-drift.md`).
//
// This guard DERIVES all five field lists from the reader's own exported arrays and
// asserts that every registered statement enumerates exactly the list of the group it
// describes. Adding, removing, or renaming a field in src/lib/sounds.ts therefore changes
// what this guard demands, with no second edit here: the registry holds anchors (prose),
// never field names.
//
// Failure modes, all exit 1:
//   - a registered statement enumerates a field set that is not its group's set;
//   - a registered anchor is NOT FOUND (someone reworded, moved, or deleted the
//     statement). This is a FAILURE, never a silent pass: an unfindable statement is
//     exactly how a stale one hides. Re-point the registry entry in the same commit that
//     rewords the statement;
//   - src/lib/sounds.ts no longer exports one of the five arrays, or it can no longer be
//     parsed, which would otherwise silently weaken the whole guard.
//
// Registry scopes, matching scripts/ci/check-scan-root-docs.mjs:
//   - `framework` -- framework-owned file, present in every checkout. A missing file or
//     anchor fails in both modes.
//   - `instance`  -- a file the adopter owns or that adoption removes (docs/SPEC.md is a
//     maintainer doc stripped at adoption, ADR 008; the demo manifest is content the init
//     wizard deletes and the adopter rewrites). Required in TEMPLATE mode, where this
//     repository authors the text. In an adopted instance an absent file or a reworded
//     anchor is reported as skipped, because the adopter owns that prose -- but a
//     statement that IS found must still enumerate the reader's fields.
//
// Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-soundscape-schema-docs.mjs   (run from anywhere)
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const READER = 'src/lib/sounds.ts';

/* -- Derivation: the field lists come from the reader, never from here -- */

// The reader declares each group as one exported const array literal:
//   export const RECORDING_REQUIRED_FIELDS = ['title', 'location', ...] as const;
function deriveFields(source, name) {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = re.exec(source);
  if (!m) return null;
  const fields = m[1]
    .split(',')
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return fields.length > 0 ? fields : null;
}

const GROUPS = {
  'recording required': 'RECORDING_REQUIRED_FIELDS',
  'recording optional': 'RECORDING_OPTIONAL_FIELDS',
  'category required': 'CATEGORY_REQUIRED_FIELDS',
  'category optional': 'CATEGORY_OPTIONAL_FIELDS',
  'wishlist required': 'WISHLIST_REQUIRED_FIELDS',
};

/* -- The registry: which statement describes which field group -- */
//
// Each entry's `anchor` has exactly one capture group, and that group captures ONLY the
// enumeration -- comma-separated field names terminated by a period. Anchors carry prose,
// never field names, so they stay valid when the reader changes and fail loudly when the
// prose changes.

const SPEC = 'docs/SPEC.md';
const MANIFEST = 'knowledge/sounds/_manifest.md';

const REGISTRY = [
  {
    file: SPEC,
    label: 'New builds (4), recording required fields',
    group: 'recording required',
    scope: 'instance',
    anchor: /A\s+recording\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), recording optional fields',
    group: 'recording optional',
    scope: 'instance',
    anchor: /A\s+recording\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), category required fields',
    group: 'category required',
    scope: 'instance',
    anchor: /A\s+category\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), category optional fields',
    group: 'category optional',
    scope: 'instance',
    anchor: /A\s+category\s+also\s+accepts\s+optional\s+([^,]+),/,
  },
  {
    file: SPEC,
    label: 'New builds (4), wishlist fields',
    group: 'wishlist required',
    scope: 'instance',
    anchor: /whose\s+entries\s+carry\s+([^]*?)\s+and\s+name/,
  },
  {
    file: MANIFEST,
    label: 'manifest body, recording required fields',
    group: 'recording required',
    scope: 'instance',
    anchor: /A\s+recording\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, recording optional fields',
    group: 'recording optional',
    scope: 'instance',
    anchor: /A\s+recording\s+also\s*\n?\s*accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, category required fields',
    group: 'category required',
    scope: 'instance',
    anchor: /A\s+category\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, category optional fields',
    group: 'category optional',
    scope: 'instance',
    anchor: /A\s+category\s+also\s+accepts\s+optional\s+([^:]+):/,
  },
  {
    file: MANIFEST,
    label: 'manifest body, wishlist fields',
    group: 'wishlist required',
    scope: 'instance',
    anchor: /whose\s+entries\s+carry\s+([^]*?)\s+and\s+name/,
  },
];

/* -- Statement parsing -- */

// A captured enumeration may wrap across lines and carry markdown backticks and an
// "and"/"or" conjunction before the last item. Strip all of that, then split on commas.
function parseFields(span) {
  return span
    .split('\n')
    .join(' ')
    .split(',')
    .map((token) => token.trim().replace(/^(?:and|or)\s+/i, ''))
    .map((token) => token.replace(/[`'"]/g, '').trim())
    .filter(Boolean);
}

const asSet = (fields) => [...new Set(fields)].sort().join(', ');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* -- Run -- */

const failures = [];
const skipped = [];
let checked = 0;

let readerSource;
try {
  readerSource = readFileSync(join(ROOT, READER), 'utf8');
} catch (err) {
  console.error(`FAIL: soundscape schema docs guard cannot read ${READER}: ${err.message}`);
  process.exit(1);
}

const EXPECTED = {};
for (const [group, constName] of Object.entries(GROUPS)) {
  const fields = deriveFields(readerSource, constName);
  if (!fields) {
    failures.push(
      `${READER}: no parseable \`export const ${constName} = [...]\` -- the guard cannot ` +
        `derive the ${group} field list. Re-point the derivation in this guard.`,
    );
    continue;
  }
  EXPECTED[group] = asSet(fields);
}

if (failures.length) {
  console.error('FAIL: soundscape schema docs guard could not derive the field lists:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

const templateMode = existsSync(join(ROOT, '.sekai-template'));

for (const site of REGISTRY) {
  const abs = join(ROOT, site.file);
  const required = site.scope === 'framework' || templateMode;

  if (!existsSync(abs)) {
    if (required) {
      failures.push(
        `${site.file}: registered file is missing (${site.label}). A registered schema ` +
          'statement cannot be checked, which is a failure, not a pass.',
      );
    } else {
      skipped.push(`${site.file} (absent)`);
    }
    continue;
  }

  const text = readFileSync(abs, 'utf8');
  const match = site.anchor.exec(text);
  if (!match) {
    if (required) {
      failures.push(
        `${site.file}: anchor NOT FOUND for "${site.label}". The statement was reworded, ` +
          "moved, or deleted -- re-point this guard's registry entry in the same commit.",
      );
    } else {
      skipped.push(`${site.file} (${site.label}: adopter-reworded)`);
    }
    continue;
  }

  const found = parseFields(match[1]);
  const expected = EXPECTED[site.group];
  if (asSet(found) !== expected) {
    failures.push(
      `${site.file}:${lineOf(text, match.index)}: ${site.label} (${site.group})\n` +
        `      found:    ${asSet(found) || '(none)'}\n` +
        `      expected: ${expected}`,
    );
    continue;
  }

  checked += 1;
}

if (failures.length) {
  console.error("FAIL: soundscape schema statements do not match the reader's field lists:");
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  for (const [group, fields] of Object.entries(EXPECTED)) {
    console.error(`  ${group} (${READER}): ${fields}`);
  }
  console.error('  Fix the statement, or re-point this guard if the statement moved.');
  process.exit(1);
}

const mode = templateMode ? 'template mode' : 'instance mode';
const skips = skipped.length
  ? `; ${skipped.length} instance-owned skipped: ${skipped.join(', ')}`
  : '';
console.log(
  `OK: soundscape schema docs guard passed [${mode}] -- ${checked} statements match ` +
    `${READER} (${Object.entries(EXPECTED)
      .map(([group, fields]) => `${group}: ${fields}`)
      .join('; ')})${skips}`,
);
