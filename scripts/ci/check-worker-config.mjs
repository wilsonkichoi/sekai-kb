#!/usr/bin/env node
// check-worker-config.mjs -- the committed-worker-config gate.
//
// Every deploy value a Cloudflare Worker carries is place identity: the Worker script
// name and the D1 database_name are ACCOUNT-scoped (two instances sharing them
// collide in one account), and ALLOWED_ORIGIN names this instance's site. workers/ is
// a code tree under iron rule 2, so none of them may be committed there; they are
// generated at deploy time into a gitignored wrangler.generated.toml instead
// (scripts/deploy/gen-worker-config.mjs).
//
// The denylist gate cannot catch this class on its own. It fires on a place NAME, so
// `ALLOWED_ORIGIN = "https://example.com"` or `name = "coastal-feedback"` passes it
// cleanly while being exactly the value that must not be committed. This gate asserts
// the committed template still carries the framework placeholders, which is a
// statement about the file rather than about any particular place, and therefore
// fails in an adopter's checkout too -- the point, since an adopter is who would
// otherwise paste a real origin in and never be told.
//
// Checks, all exit 1:
//   - a committed workers/<w>/wrangler.toml this reader cannot parse (an unparsed
//     config is one nothing is checking);
//   - a worker directory with no expectation registered below (a new worker must
//     declare what it ships with, rather than being exempt by omission);
//   - `name`, any `[[d1_databases]]` `database_name` or `database_id`, or any [vars]
//     value that is not the constant the framework ships;
//   - a missing registered key (deleting ALLOWED_ORIGIN is not a way to pass);
//   - a `[[d1_databases]]` block set that does not match the bindings registered
//     below, including a deleted one (removing the whole block is not a way to pass
//     either: the generator only rewrites keys the template already has, so a
//     template with no D1 block generates a deploy config with no `env.DB`);
//   - a wrangler.generated.toml tracked by git (it is derived and gitignored; the two
//     machine gates skip it by name, so committing one would smuggle identity past
//     them).
//
// Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-worker-config.mjs [--root <dir>]
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  GENERATED_BASENAME,
  PLACEHOLDER,
  TEMPLATE_BASENAME,
  parseWranglerToml,
} from '../deploy/wrangler-config.mjs';

/* -- What each worker ships with -------------------------------------------
 *
 * One entry per directory under workers/. `vars` lists EVERY key the template's
 * [vars] block carries and the exact framework constant for each: an empty
 * ALLOWED_ORIGIN (the worker fail-closes on it -- see workers/feedback/test/
 * cors.test.mjs) plus the rate-limit defaults. `name`, `database_name`, and
 * `database_id` are always the placeholder, so they are not repeated per worker.
 *
 * `d1Bindings` lists the `binding` of every [[d1_databases]] block the template
 * ships, in order, and is what makes a deleted block a failure rather than a pass.
 * The generator rewrites keys the template already carries; it never adds a block.
 * So a template whose D1 block went missing still generates cleanly, and the
 * deployed worker reaches `env.DB.prepare` with `env.DB` undefined -- a checkable
 * count here is the only place that stays wrong loudly.
 *
 * A framework change to a default is a deliberate edit here as well as in the
 * template; that second edit is what keeps this gate a contract rather than a
 * restatement of whatever the file happens to say today.
 */
const EXPECTED = {
  feedback: {
    vars: {
      ALLOWED_ORIGIN: '',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_SECONDS: '3600',
    },
    d1Bindings: ['DB'],
  },
};

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

let root = DEFAULT_ROOT;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    root = argv[i + 1];
    i += 1;
    if (!root) {
      console.error('FAIL: --root needs a directory');
      process.exit(1);
    }
  } else {
    console.error(`FAIL: unknown argument "${argv[i]}"`);
    process.exit(1);
  }
}

const failures = [];
const workersDir = join(root, 'workers');

if (!existsSync(workersDir)) {
  console.log('OK: worker config gate -- no workers/ tree in this checkout.');
  process.exit(0);
}

const workerDirs = readdirSync(workersDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let checked = 0;

for (const dir of workerDirs) {
  const rel = `workers/${dir}/${TEMPLATE_BASENAME}`;
  const abs = join(workersDir, dir, TEMPLATE_BASENAME);
  if (!existsSync(abs)) continue;

  const expected = EXPECTED[dir];
  if (!expected) {
    failures.push(
      `${rel}: no expectation registered for worker "${dir}". Add its shipped [vars] ` +
        'constants to EXPECTED in scripts/ci/check-worker-config.mjs; a worker that is ' +
        'not registered is a worker nothing is checking.',
    );
    continue;
  }

  let config;
  try {
    config = parseWranglerToml(readFileSync(abs, 'utf8'));
  } catch (err) {
    failures.push(`${rel}: ${err.message}`);
    continue;
  }

  const report = (key, found, want) =>
    failures.push(
      `${rel}: ${key}\n` +
        `      found:    ${JSON.stringify(found)}\n` +
        `      expected: ${JSON.stringify(want)} (the framework placeholder/constant)`,
    );

  if (!('name' in config.top)) {
    failures.push(`${rel}: no top-level "name" key. The template must ship one, as the placeholder.`);
  } else if (config.top.name !== PLACEHOLDER) {
    report('name', config.top.name, PLACEHOLDER);
  }

  const vars = config.tables.vars ?? {};
  for (const [key, want] of Object.entries(expected.vars)) {
    if (!(key in vars)) {
      failures.push(`${rel}: [vars] has no "${key}" key; the generator overrides it and needs it present.`);
    } else if (vars[key] !== want) {
      report(`[vars] ${key}`, vars[key], want);
    }
  }
  for (const key of Object.keys(vars)) {
    if (!(key in expected.vars)) {
      failures.push(
        `${rel}: [vars] carries an unregistered key "${key}" = ${JSON.stringify(vars[key])}. ` +
          'Register its framework constant in scripts/ci/check-worker-config.mjs, or remove it.',
      );
    }
  }

  const databases = config.arrays.d1_databases ?? [];
  const wantBindings = expected.d1Bindings ?? [];
  if (databases.length !== wantBindings.length) {
    failures.push(
      `${rel}: ships ${databases.length} [[d1_databases]] block(s), but ` +
        `${wantBindings.length} are registered (${JSON.stringify(wantBindings)}). The generator ` +
        'rewrites keys the template already has and never adds a block, so a missing one ' +
        'generates a deploy config with no database binding. Restore the block, or update ' +
        'd1Bindings in scripts/ci/check-worker-config.mjs if the worker genuinely dropped it.',
    );
  }
  databases.forEach((db, i) => {
    const wantBinding = wantBindings[i];
    if (wantBinding !== undefined) {
      if (!('binding' in db)) {
        failures.push(`${rel}: [[d1_databases]][${i}] has no "binding" key; the worker code resolves the database through it.`);
      } else if (db.binding !== wantBinding) {
        report(`[[d1_databases]][${i}] binding`, db.binding, wantBinding);
      }
    }
    for (const key of ['database_name', 'database_id']) {
      if (!(key in db)) {
        failures.push(`${rel}: [[d1_databases]][${i}] has no "${key}" key; the generator overrides it and needs it present.`);
      } else if (db[key] !== PLACEHOLDER) {
        report(`[[d1_databases]][${i}] ${key}`, db[key], PLACEHOLDER);
      }
    }
  });

  checked += 1;
}

// A generated config is gitignored and skipped by name in both machine gates, so a
// committed one would carry deployment identity straight past them.
const tracked = spawnSync('git', ['-C', root, 'ls-files', `*/${GENERATED_BASENAME}`, GENERATED_BASENAME], {
  encoding: 'utf8',
});
if (tracked.status === 0) {
  for (const path of tracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    failures.push(
      `${path}: a generated worker config is tracked by git. It is derived, gitignored, ` +
        'and skipped by both machine gates by name -- committing one puts deployment ' +
        `identity in the repository. Run \`git rm --cached ${path}\`.`,
    );
  }
}

if (failures.length) {
  console.error('FAIL: committed worker configs carry values the framework does not ship:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  console.error('  A committed wrangler.toml is a template, never a deploy config. Real names,');
  console.error(`  ids, and origins belong in the generated ${GENERATED_BASENAME} that`);
  console.error('  `npm run worker-config` writes from place.config.ts (docs/runbook/DEPLOY.md).');
  process.exit(1);
}

console.log(
  `OK: worker config gate passed -- ${checked} committed ${TEMPLATE_BASENAME} file(s) carry ` +
    'framework placeholders only, and no generated config is tracked.',
);
