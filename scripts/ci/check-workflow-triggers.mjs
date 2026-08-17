#!/usr/bin/env node
// check-workflow-triggers.mjs -- the pull_request_target guard.
//
// `pull_request_target` runs a workflow with the BASE repository's secrets and a
// write-capable token, and unlike `pull_request` it does not withhold them from
// forks. That is safe on its own: the trigger exists so a workflow can label or
// comment on a fork's pull request, and its default checkout is the base branch,
// which is repository-owned code.
//
// It becomes a full repository compromise the moment the workflow checks out the
// PR head. Then attacker-authored code executes with those secrets and that token
// -- `npm ci` postinstall alone is enough, no malicious step required. The pattern
// is one added `ref:` line away from any workflow that already uses the trigger,
// and nothing else in this repository fails when it appears.
//
// So the gate is the COMBINATION, not the trigger:
//
//   1. A workflow using `pull_request_target` must not check out PR-authored code.
//      Fatal, in template mode and in an adopted instance alike: this is a security
//      boundary, the one class AGENTS.md iron rule 3 keeps fatal in an instance
//      because it harms someone other than the person editing.
//
// The safe use passes untouched. A workflow that uses `pull_request_target` and
// checks out its own base is not flagged, and neither is `pull_request` with any
// ref at all -- that trigger withholds secrets from forks and gets no write token.
//
// PR-head references, all of which resolve to attacker-authored code:
//   github.event.pull_request.head.sha / .ref / .repo.*
//   github.head_ref
//   github.event.pull_request.merge_commit_sha (a merge OF the PR's code)
//   github.event.pull_request.head.label
//   refs/pull/<n>/head or /merge
//
// Failure modes exit 1. Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-workflow-triggers.mjs [--root <dir>]
//        node scripts/ci/check-workflow-triggers.mjs --selftest
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const WORKFLOW_DIR = '.github/workflows';
const TRIGGER = 'pull_request_target';

/** Expressions that resolve to the pull request's own head, i.e. untrusted code. */
const PR_HEAD_REFERENCES = [
  'github.event.pull_request.head.sha',
  'github.event.pull_request.head.ref',
  'github.event.pull_request.head.repo',
  'github.head_ref',
  'github.event.pull_request.merge_commit_sha',
  'github.event.pull_request.head.label',
  'refs/pull/',
];

const errors = [];
const fail = (message) => errors.push(message);

/**
 * The `on:` block of a workflow: everything from the `on:` key to the next
 * top-level key. Read as text rather than parsed, so this file needs no YAML
 * dependency -- consistent with the other gates under scripts/ci/.
 */
function triggerBlock(source) {
  // `\Z` does NOT exist in JavaScript: written that way it is a literal `Z`, and the
  // lazy quantifier then ends the block at the first capital Z in the trigger body --
  // a comment, a branch glob, a cron note. check-analytics-delivery.mjs carries the
  // same trap and the same fix; `$(?![\s\S])` is true end-of-input.
  const match = source.match(/^on:\s*$\n([\s\S]*?)(?=^[a-zA-Z][\w-]*:|$(?![\s\S]))/m);
  if (match) return match[0];
  // `on: [push, pull_request]` and `on: push` inline forms.
  const inline = source.match(/^on:.*$/m);
  return inline ? inline[0] : '';
}

/** Every `- ` step in a workflow, with its body. Mirrors check-analytics-delivery. */
function parseSteps(source) {
  const lines = source.split('\n');
  const steps = [];
  let current = null;
  for (const line of lines) {
    if (/^\s{2,}- /.test(line)) {
      if (current) steps.push(current);
      current = { text: line };
      continue;
    }
    if (current) {
      if (line.trim() === '' || /^\s{2,}/.test(line)) {
        current.text += `\n${line}`;
        continue;
      }
      steps.push(current);
      current = null;
    }
  }
  if (current) steps.push(current);
  for (const step of steps) {
    const named = step.text.match(/^\s*-?\s*name:\s*(.+)$/m);
    const uses = step.text.match(/^\s*-?\s*uses:\s*(.+)$/m);
    const run = step.text.match(/^\s*-?\s*run:\s*(.+)$/m);
    step.name = (named?.[1] ?? uses?.[1] ?? run?.[1] ?? '(unnamed step)').trim();
  }
  return steps;
}

function checkWorkflow(relativePath, source) {
  if (!triggerBlock(source).includes(TRIGGER)) return;

  // Decide on the FILE, never on the step parse. YAML accepts any sequence indent, so
  // a workflow written 4-space -- a marketplace README copy-paste -- yields zero steps
  // from any fixed-indent parser, and a gate that iterates steps would pass it green.
  // The step parse below only turns a hit into a location for the message.
  const hits = PR_HEAD_REFERENCES.filter((reference) => source.includes(reference));
  if (hits.length === 0) return;

  const steps = parseSteps(source);
  for (const hit of hits) {
    const owner = steps.find((step) => step.text.includes(hit));
    const where = owner ? `step '${owner.name}'` : 'this workflow';
    fail(
      `${relativePath} uses '${TRIGGER}' and ${where} checks out PR-authored code ` +
        `via '${hit}'. That trigger runs with this repository's secrets and a write-capable ` +
        'token, and does not withhold them from forks, so anyone opening a pull request would ' +
        'execute code with them. Check out the base branch instead, or use the ' +
        "'pull_request' trigger, which withholds secrets from forks",
    );
  }
}

function run(root) {
  errors.length = 0;
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    fail(`${WORKFLOW_DIR} does not exist; there are no workflows to check`);
    return { errors: [...errors], scanned: 0 };
  }
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort();
  if (files.length === 0) {
    fail(`${WORKFLOW_DIR} contains no workflow files; the scan would be vacuous`);
    return { errors: [...errors], scanned: 0 };
  }
  for (const name of files) {
    checkWorkflow(join(WORKFLOW_DIR, name), readFileSync(join(dir, name), 'utf8'));
  }
  return { errors: [...errors], scanned: files.length };
}

/* -- Self-test --------------------------------------------------------------- */

/**
 * Two directions. The positive cases plant a defect and require a failure; the
 * negative case plants the SAFE use of the same trigger and requires the gate to
 * stay silent, because a guard that fires on the safe pattern would be removed by
 * the first person who legitimately needs it.
 */
const SELFTEST_CASES = [
  {
    // B1 regression: a capital Z anywhere in the `on:` block used to truncate it,
    // so the trigger was never seen and the gate exited 0 on a PR-head checkout.
    label: 'pull_request_target whose on: block contains a capital Z',
    mustFail: true,
    apply: (root) => {
      writeFileSync(
        join(root, WORKFLOW_DIR, 'synthetic-capital-z.yml'),
        'name: Synthetic\n' +
          'on:\n' +
          '  push:\n' +
          '    branches: [main]\n' +
          '  # runs in the AZ and EU regions too\n' +
          '  pull_request_target:\n' +
          'jobs:\n' +
          '  label:\n' +
          '    runs-on: ubuntu-latest\n' +
          '    steps:\n' +
          '      - uses: actions/checkout@v5\n' +
          '        with:\n' +
          '          ref: ${{ github.event.pull_request.head.sha }}\n' +
          '      - run: npm ci\n',
      );
    },
  },
  {
    // B2 regression: YAML accepts any sequence indent. A 4-space workflow yielded
    // zero steps from the fixed 6-space parser, so a step-iterating gate saw nothing.
    label: 'pull_request_target in a 4-space-indented workflow',
    mustFail: true,
    apply: (root) => {
      writeFileSync(
        join(root, WORKFLOW_DIR, 'synthetic-four-space.yml'),
        'name: Synthetic\n' +
          'on:\n' +
          '  pull_request_target:\n' +
          'jobs:\n' +
          '  label:\n' +
          '    runs-on: ubuntu-latest\n' +
          '    steps:\n' +
          '    - uses: actions/checkout@v5\n' +
          '      with:\n' +
          '        ref: ${{ github.event.pull_request.head.sha }}\n' +
          '    - run: npm ci && npm test\n',
      );
    },
  },
  {
    label: 'pull_request_target checking out merge_commit_sha',
    mustFail: true,
    apply: (root) => {
      writeFileSync(
        join(root, WORKFLOW_DIR, 'synthetic-merge-sha.yml'),
        'name: Synthetic\n' +
          'on:\n' +
          '  pull_request_target:\n' +
          'jobs:\n' +
          '  label:\n' +
          '    runs-on: ubuntu-latest\n' +
          '    steps:\n' +
          '      - uses: actions/checkout@v5\n' +
          '        with:\n' +
          '          ref: ${{ github.event.pull_request.merge_commit_sha }}\n',
      );
    },
  },
  {
    label: 'pull_request_target with an explicit PR-head checkout',
    mustFail: true,
    apply: (root) => {
      const path = join(root, WORKFLOW_DIR, 'deploy.yml');
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source
          .replace('  pull_request:\n', '  pull_request:\n  pull_request_target:\n')
          .replace(
            '    steps:\n      - uses: actions/checkout@v5\n',
            '    steps:\n      - uses: actions/checkout@v5\n        with:\n' +
              '          ref: ${{ github.event.pull_request.head.sha }}\n',
          ),
      );
    },
  },
  {
    label: 'pull_request_target with a github.head_ref checkout',
    mustFail: true,
    apply: (root) => {
      const path = join(root, WORKFLOW_DIR, 'deploy.yml');
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source
          .replace('  pull_request:\n', '  pull_request:\n  pull_request_target:\n')
          .replace(
            '    steps:\n      - uses: actions/checkout@v5\n',
            '    steps:\n      - uses: actions/checkout@v5\n        with:\n' +
              '          ref: ${{ github.head_ref }}\n',
          ),
      );
    },
  },
  {
    label: 'a PR-head checkout under plain pull_request stays allowed',
    mustFail: false,
    apply: (root) => {
      const path = join(root, WORKFLOW_DIR, 'deploy.yml');
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          '    steps:\n      - uses: actions/checkout@v5\n',
          '    steps:\n      - uses: actions/checkout@v5\n        with:\n' +
            '          ref: ${{ github.event.pull_request.head.sha }}\n',
        ),
      );
    },
  },
  {
    label: 'pull_request_target checking out the base stays allowed',
    mustFail: false,
    apply: (root) => {
      const path = join(root, WORKFLOW_DIR, 'deploy.yml');
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('  pull_request:\n', '  pull_request:\n  pull_request_target:\n'));
    },
  },
];

function selftest(sourceRoot) {
  const clean = run(sourceRoot);
  if (clean.errors.length > 0) {
    process.stdout.write(
      '\nworkflow-triggers self-test ABORTED: the repository already fails the check, so no ' +
        `planted defect proves anything.\n   - ${clean.errors.join('\n   - ')}\n`,
    );
    return 1;
  }

  let failures = 0;
  for (const testCase of SELFTEST_CASES) {
    const root = mkdtempSync(join(tmpdir(), 'workflow-triggers-selftest-'));
    try {
      cpSync(join(sourceRoot, '.github'), join(root, '.github'), { recursive: true });
      testCase.apply(root);
      const result = run(root);
      const caught = result.errors.length > 0;
      if (caught === testCase.mustFail) {
        process.stdout.write(`   ok    ${testCase.label}\n`);
      } else {
        failures += 1;
        process.stdout.write(
          `   MISS  ${testCase.label} (expected ${testCase.mustFail ? 'a failure' : 'no failure'}, ` +
            `got ${caught ? result.errors.join('; ') : 'none'})\n`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    process.stdout.write(`\nworkflow-triggers self-test FAILED: ${failures}/${SELFTEST_CASES.length} cases wrong.\n`);
    return 1;
  }
  process.stdout.write(
    `\nworkflow-triggers self-test passed: all ${SELFTEST_CASES.length} cases behave, ` +
      'including the two safe patterns the gate must not flag.\n',
  );
  return 0;
}

/* -- Entry point ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag >= 0 ? argv[rootFlag + 1] : process.cwd();

if (argv.includes('--selftest')) {
  process.exit(selftest(root));
}

const result = run(root);
if (result.errors.length > 0) {
  process.stdout.write(`workflow-triggers check FAILED:\n   - ${result.errors.join('\n   - ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `workflow-triggers check passed: ${result.scanned} workflow(s) scanned; no '${TRIGGER}' ` +
    'workflow checks out pull-request-authored code.\n',
);
