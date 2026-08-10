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
//   - a documented default in docs/runbook/DEPLOY.md that disagrees with the constant
//     the template ships, a registered default the runbook documents nowhere, and a
//     runbook table whose `<!-- worker-vars: <name> -->` anchor is gone. The runbook is
//     the only place an operator reads these values, and it ships to every adopter on
//     the next tag merge, so a retuned constant with a stale table is a wrong number
//     with no way for its reader to know;
//   - a runbook row whose Source cell disagrees with WORKER_VAR_OVERRIDES about where
//     an instance records a retuned value: an overridable var whose row names no
//     `workers.<key>`, a row naming a key no override is registered for, or a row
//     naming the wrong one. Telling an operator to measure a value and not telling them
//     where to put the answer is the defect this whole override path exists to fix, and
//     it comes back the moment the two drift;
//   - an override registered for a [vars] key the committed template does not carry.
//     This is the fatal half of that contract: the generator only warns and drops the
//     value, because an instance that hits it hit it by upgrading and still has to be
//     able to deploy. Failing here is what keeps the framework from shipping the
//     mismatch in the first place;
//   - a derived worker artifact tracked by git. Two exist: wrangler.generated.toml
//     (`npm run worker-config`) and workers/chat/vectors.json (`npm run
//     embeddings:build`). Both are gitignored and both are skipped by name in the two
//     machine gates, so committing one would smuggle place identity past them -- the
//     deploy config through its origin and worker names, the vector index through every
//     article title, url, and body chunk it carries.
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
  WORKER_VAR_OVERRIDES,
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
  chat: {
    vars: {
      ALLOWED_ORIGIN: '',
      SITE_NAME: '',
      RATE_LIMIT_MAX: '20',
      RATE_LIMIT_WINDOW_SECONDS: '3600',
      RELEVANCE_FLOOR: '0.46',
    },
    aiBinding: 'AI',
    d1Bindings: ['DB'],
  },
  feedback: {
    vars: {
      ALLOWED_ORIGIN: '',
      RATE_LIMIT_MAX: '5',
      RATE_LIMIT_WINDOW_SECONDS: '3600',
    },
    d1Bindings: ['DB'],
  },
  og: {
    vars: {
      SITE_ORIGIN: '',
      SITE_NAME: '',
      CATEGORY_COLORS: '',
    },
    d1Bindings: [],
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
const checkedWorkers = [];

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

  // An override is a promise that setting `workers.<key>` changes a real deploy var.
  // If the template drops the var, that promise breaks only for the instance that set
  // the key, at generation time, long after the change that broke it -- and there it
  // is a warning, not a stop. This is where it is caught while it is still cheap.
  for (const [key, spec] of Object.entries(WORKER_VAR_OVERRIDES[dir] ?? {})) {
    if (!(key in vars)) {
      failures.push(
        `${rel}: scripts/deploy/wrangler-config.mjs registers \`workers.${spec.configKey}\` as an ` +
          `override for [vars] ${key}, but the template carries no such key. Restore it, or drop ` +
          'the registration.',
      );
    }
  }

  const ai = config.tables.ai;
  if (expected.aiBinding) {
    if (!ai || ai.binding !== expected.aiBinding) {
      report('[ai] binding', ai?.binding, expected.aiBinding);
    }
  } else if (ai) {
    failures.push(`${rel}: carries an unregistered [ai] binding.`);
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
  checkedWorkers.push(dir);
}

/* -- The runbook's documented defaults --------------------------------------
 *
 * EXPECTED above pins what the template ships. docs/runbook/DEPLOY.md is where an
 * operator reads those same values, and nothing but this check connects the two: a
 * retuned constant leaves a table stating the old number, which ships to every adopter
 * on the next tag merge and reads exactly like a correct one.
 *
 * Each worker's table is anchored by an `<!-- worker-vars: <name> -->` comment, so the
 * association is declared rather than inferred from heading order, and deleting the
 * anchor fails instead of silently exempting the table. A row whose Source cell reads
 * "template (`X`)" is a claim about a shipped constant; every other row (place-derived,
 * secret, binding) is outside this contract. The two sets must match exactly in both
 * directions: a documented value that has drifted, and a shipped default the runbook
 * never mentions, are the same defect seen from either end.
 *
 * A shipped constant an instance may retune carries a second clause,
 * "template (`X`), override `workers.<key>`", and that clause is checked against
 * WORKER_VAR_OVERRIDES the same way in both directions. The runbook is where an
 * operator is told to measure a value; a table that states the default without stating
 * where the answer goes sends them back to editing a framework-owned file, which is the
 * state this override path was added to end.
 *
 * What this cannot cover: the measured scores in the "Tuning the relevance floor"
 * section (0.435, 0.484, 0.512, 0.595). Those are experimental results produced by
 * running an embedding model over the demo corpus, not values any source in this
 * repository carries, so no guard can derive them. They carry the date they were
 * measured and the procedure that reproduces them, which is what a reader needs in
 * order to distrust them once the corpus has moved.
 */
const RUNBOOK_REL = 'docs/runbook/DEPLOY.md';

/**
 * A Source cell claiming a shipped constant, optionally naming the place.config.ts
 * key that overrides it: "template (`0.46`), override `workers.chatRelevanceFloor`".
 * A cell in any other shape is a row about something else and is not checked here.
 */
const SOURCE_RE = /^template \(`([^`]*)`\)(?:, override `workers\.([A-Za-z0-9_]+)`)?$/;

const runbookAbs = join(root, RUNBOOK_REL);
const runbookPresent = existsSync(runbookAbs);

if (runbookPresent) {
  const lines = readFileSync(runbookAbs, 'utf8').split('\n');
  const documented = new Map();

  for (let i = 0; i < lines.length; i++) {
    const anchor = lines[i].match(/^<!--\s*worker-vars:\s*([a-z0-9-]+)\s*-->\s*$/);
    if (!anchor) continue;
    const worker = anchor[1];

    if (documented.has(worker)) {
      failures.push(`${RUNBOOK_REL}: two "worker-vars: ${worker}" anchors; one table per worker.`);
      continue;
    }

    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j += 1;
    const rows = [];
    while (j < lines.length && lines[j].startsWith('|')) {
      rows.push(lines[j]);
      j += 1;
    }
    if (rows.length === 0) {
      failures.push(
        `${RUNBOOK_REL}: the "worker-vars: ${worker}" anchor is followed by no table. ` +
          'The anchor marks the table that documents that worker\'s shipped constants.',
      );
      continue;
    }

    const defaults = new Map();
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
      const name = cells[0]?.match(/^`([A-Za-z0-9_]+)`$/);
      const source = cells[2]?.match(SOURCE_RE);
      if (name && source) defaults.set(name[1], { value: source[1], overrideKey: source[2] });
    }
    documented.set(worker, defaults);
  }

  for (const [worker, defaults] of documented) {
    const expected = EXPECTED[worker];
    if (!expected) {
      failures.push(
        `${RUNBOOK_REL}: documents a worker "${worker}" that has no expectation registered ` +
          'in scripts/ci/check-worker-config.mjs.',
      );
      continue;
    }
    const overridable = WORKER_VAR_OVERRIDES[worker] ?? {};
    for (const [key, { value, overrideKey }] of defaults) {
      if (!(key in expected.vars)) {
        failures.push(
          `${RUNBOOK_REL}: documents ${worker} [vars] ${key} as a shipped default, but the ` +
            'template carries no such key.',
        );
      } else if (expected.vars[key] === '') {
        failures.push(
          `${RUNBOOK_REL}: documents ${worker} [vars] ${key} as "template (\`${value}\`)", but ` +
            'the template ships it empty; it is generated per place, not a framework default.',
        );
      } else if (expected.vars[key] !== value) {
        failures.push(
          `${RUNBOOK_REL}: ${worker} [vars] ${key}\n` +
            `      documented: ${JSON.stringify(value)}\n` +
            `      shipped:    ${JSON.stringify(expected.vars[key])} (workers/${worker}/${TEMPLATE_BASENAME})`,
        );
      }

      const wantKey = overridable[key]?.configKey;
      if (wantKey !== overrideKey) {
        failures.push(
          `${RUNBOOK_REL}: ${worker} [vars] ${key} Source cell\n` +
            `      documents override: ${overrideKey ? `\`workers.${overrideKey}\`` : 'none'}\n` +
            `      registered:         ${wantKey ? `\`workers.${wantKey}\`` : 'none'} ` +
            '(WORKER_VAR_OVERRIDES in scripts/deploy/wrangler-config.mjs)\n' +
            '      The Source cell is where an operator reads whether a value can be retuned ' +
            'and where the answer goes.',
        );
      }
    }
    for (const [key, value] of Object.entries(expected.vars)) {
      if (value !== '' && !defaults.has(key)) {
        failures.push(
          `${RUNBOOK_REL}: the ${worker} table documents no default for [vars] ${key} ` +
            `(the template ships ${JSON.stringify(value)}). An operator tuning it has nowhere ` +
            'to read what it started as.',
        );
      }
    }
  }

  for (const worker of checkedWorkers) {
    if (!documented.has(worker)) {
      failures.push(
        `${RUNBOOK_REL}: no "<!-- worker-vars: ${worker} -->" anchor. Every worker with a ` +
          'committed template documents its shipped constants there, and the anchor is what ' +
          'ties the table to this gate.',
      );
    }
  }
}

/* -- Derived artifacts that must never be tracked ---------------------------
 *
 * Each is written into workers/ by a script, gitignored, and skipped BY NAME in both
 * machine gates. That skip is what makes a committed one dangerous: the gates would
 * walk straight past it. `what` is what a reader needs in order to understand why the
 * file is forbidden rather than merely untidy.
 */
const DERIVED_ARTIFACTS = [
  {
    basename: GENERATED_BASENAME,
    what: 'a generated worker config',
    identity: 'deployment identity (this instance\'s origin, worker name, and database ids)',
  },
  {
    basename: 'vectors.json',
    what: 'a generated corpus embedding index',
    identity: 'place identity (every article title, url, and body chunk it embeds)',
  },
];

for (const artifact of DERIVED_ARTIFACTS) {
  const tracked = spawnSync(
    'git',
    ['-C', root, 'ls-files', `*/${artifact.basename}`, artifact.basename],
    { encoding: 'utf8' },
  );
  if (tracked.status !== 0) continue;
  for (const path of tracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    failures.push(
      `${path}: ${artifact.what} is tracked by git. It is derived, gitignored, and ` +
        `skipped by both machine gates by name -- committing one puts ${artifact.identity} ` +
        `in the repository. Run \`git rm --cached ${path}\`.`,
    );
  }
}

if (failures.length) {
  const runbookFailures = failures.filter((f) => f.startsWith(`${RUNBOOK_REL}:`));
  console.error('FAIL: the committed worker contract does not hold:');
  for (const f of failures) console.error(`  ${f}`);
  if (runbookFailures.length < failures.length) {
    console.error('');
    console.error('  A committed wrangler.toml is a template, never a deploy config. Real names,');
    console.error(`  ids, and origins belong in the generated ${GENERATED_BASENAME} that`);
    console.error('  `npm run worker-config` writes from place.config.ts (docs/runbook/DEPLOY.md).');
  }
  if (runbookFailures.length) {
    console.error('');
    console.error(`  ${RUNBOOK_REL} is where an operator reads a shipped default before tuning`);
    console.error('  it. Changing a template constant means changing that table in the same pass,');
    console.error('  or the number every adopter reads is the one it used to be.');
  }
  process.exit(1);
}

console.log(
  `OK: worker config gate passed -- ${checked} committed ${TEMPLATE_BASENAME} file(s) carry ` +
    'framework placeholders only, no derived worker artifact is tracked, and ' +
    (runbookPresent
      ? `every shipped default matches the one ${RUNBOOK_REL} documents.`
      : `${RUNBOOK_REL} is absent from this root, so no documented default was checked.`),
);
