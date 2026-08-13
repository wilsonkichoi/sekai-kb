#!/usr/bin/env node
// check-corpus-refresh.mjs -- the CI-deploy exception gate.
//
// One workflow in this repository deploys a Cloudflare Worker: .github/workflows/
// corpus-refresh.yml. Every other worker deploy is an operator action with credentials
// on their own machine. That exception was granted on four properties, and three of
// them are one edit away from being lost silently -- a `pull_request:` trigger added
// for convenience, a `permissions:` write scope added to make some later step work, an
// `if:` dropped from a step so it "always runs". None of those fail a build on their
// own. The first one hands a Cloudflare deploy credential to anyone who opens a pull
// request.
//
// So the properties are asserted here, from the workflow file itself, on every pull
// request:
//
//   1. Triggers: push to `main` with a knowledge/** path filter, plus manual dispatch,
//      and NO pull-request trigger. The absence is what is checked -- a guard that only
//      confirms the triggers it expects would pass a file that also carries
//      `pull_request:`.
//   2. Opt-in: every step that touches a secret, builds the corpus, or deploys is
//      gated on the opt-in gate step's output, so an adopter who configured nothing
//      gets a green run that does nothing.
//   3. Least privilege: no `permissions:` block in the file grants a write scope.
//   4. The deploy step additionally runs only on `main`, so a manual dispatch from a
//      branch cannot publish that branch's code.
//
// It also holds the prose to the code. Two documents used to state that CI never
// deploys a worker; both were amended when this workflow landed, and a re-introduced
// sentence would leave an adopter reading a rule the repository does not follow. The
// registered statements are required, the retired ones are forbidden, and the
// package.json entries the deploy-time index verification cites must still exist.
//
// Registry scopes, matching scripts/ci/check-scan-root-docs.mjs:
//   - `framework` -- present in every checkout; a missing file or anchor fails in both
//     modes.
//   - `instance`  -- a file the adopter owns (AGENTS.md carries `merge=ours`). Required
//     in template mode, where this repository authors the text; in an adopted instance
//     an absent file or reworded anchor is reported as skipped, because the adopter
//     owns that prose. A FORBIDDEN statement is still fatal there: an adopter may
//     reword the rule, but a sentence promising that CI never deploys a worker is
//     false in any checkout carrying this workflow.
//
// Failure modes, all exit 1. Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-corpus-refresh.mjs [--root <dir>]
//        node scripts/ci/check-corpus-refresh.mjs --selftest
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const WORKFLOW = '.github/workflows/corpus-refresh.yml';
const WORKFLOWS_DIR = '.github/workflows';
const GATE_SCRIPT = 'scripts/deploy/corpus-refresh-gate.mjs';
const TARGETS_SCRIPT = 'scripts/deploy/corpus-workers.mjs';
const PACKAGE_JSON = 'package.json';
const RUNBOOK = 'docs/runbook/DEPLOY.md';
const AGENTS = 'AGENTS.md';

/* -- Build-pipeline entries the deploy-time index verification cites ---------
 *
 * The runbook tells an adopter that the search index, the /kb/ protocol files, and the
 * graph are rebuilt by every deploy and therefore need no refresh job of their own.
 * That claim rests on these npm scripts staying in the two chains. A rename that left
 * the sentence behind would make the runbook promise a refresh nothing performs.
 */
const CITED_PIPELINE_JOBS = {
  prebuild: ['prebuild:sync', 'prebuild:kb-index', 'prebuild:search'],
  postbuild: ['postbuild:graph'],
};

/* -- Prose registry ---------------------------------------------------------- */

const REQUIRED_STATEMENTS = [
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh bound 1 (push to main only)',
    anchor: /\*\*1\. Push to `main` only\.\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh bound 2 (opt-in, absent-safe)',
    anchor: /\*\*2\. Opt-in, and absent-safe\.\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh bound 3 (least privilege)',
    anchor: /\*\*3\. Least privilege\.\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh bound 4 (documented blast radius)',
    anchor: /\*\*4\. A documented blast radius\.\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh token scope, Workers Scripts: Edit',
    anchor: /Account \| Workers Scripts \| Edit/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh token scope, Workers AI: Edit',
    anchor: /Account \| Workers AI \| Edit/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'CI refresh revocation path',
    anchor: /### Revoking the CI refresh/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'deploy-time index verification',
    anchor: /### What a deploy already refreshes/,
  },
  {
    file: AGENTS,
    scope: 'instance',
    label: 'iron rule restatement, the one CI-deploy exception',
    anchor: /deployed\s+by\s+hand,\s+with\s+one\s+narrow\s+exception/i,
  },
];

/*
 * Retired statements. Each was true before this workflow existed and is false now.
 * They are matched as prose, so the check is deliberately narrow: these exact claims,
 * in the two documents that made them.
 */
const FORBIDDEN_STATEMENTS = [
  {
    label: 'the retired "never by CI" rule',
    pattern: /never by CI/i,
  },
  {
    label: 'the retired "CI never deploys a worker" rule',
    pattern: /CI never deploys a worker/i,
  },
  {
    label: 'the retired "nothing in CI produces the corpus" rule',
    pattern: /Nothing in the site build or in CI produces it/i,
  },
];

const FORBIDDEN_FILES = [
  { file: RUNBOOK, scope: 'framework' },
  { file: AGENTS, scope: 'instance' },
];

/* -- Minimal workflow reading ------------------------------------------------
 *
 * This repository has no YAML dependency, and adding one to read four structural
 * properties out of one file would be a larger change than the guard. These read the
 * document by indentation, which is enough for the shapes asserted here and fails
 * loudly (rather than silently passing) when it cannot find what it is looking for.
 */

/** Drop a trailing `# comment`, so a comment mentioning a trigger is never a trigger. */
function stripComment(line) {
  return line.replace(/(^|\s)#.*$/, '$1').replace(/\s+$/, '');
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The lines of a block introduced by `key:` at top level, comments stripped.
 * Returns null when the key is absent.
 */
function topLevelBlock(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line));
  if (start === -1) return null;
  const block = [stripComment(lines[start])];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (indentOf(line) === 0) break;
    block.push(stripComment(line));
  }
  return block;
}

/** Every `permissions:` block in the file (top level and per job), by indentation. */
function permissionsBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    if (!/^\s*permissions:\s*$/.test(line)) continue;
    const base = indentOf(line);
    const entries = [];
    for (let j = i + 1; j < lines.length; j++) {
      const child = stripComment(lines[j]);
      if (child.trim() === '') continue;
      if (indentOf(child) <= base) break;
      entries.push({ line: j + 1, text: child.trim() });
    }
    blocks.push({ line: i + 1, entries });
  }
  return blocks;
}

/**
 * Step blocks under every `steps:` key: each is the `- ...` list item and its
 * continuation lines, joined.
 */
function stepBlocks(text) {
  const lines = text.split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*steps:\s*$/.test(stripComment(lines[i]))) continue;
    const base = indentOf(lines[i]);
    let current = null;
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j];
      if (raw.trim() === '') {
        if (current) current.lines.push('');
        continue;
      }
      const indent = indentOf(raw);
      if (indent <= base) break;
      if (/^\s*-\s/.test(raw) && (current === null || indent <= current.indent)) {
        current = { indent, line: j + 1, lines: [stripComment(raw)] };
        steps.push(current);
      } else if (current) {
        current.lines.push(stripComment(raw));
      }
    }
  }
  return steps.map((step) => ({ line: step.line, text: step.lines.join('\n') }));
}

/* -- The check --------------------------------------------------------------- */

export function runCheck(root) {
  const failures = [];
  const skipped = [];
  let checked = 0;

  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const templateMode = existsSync(join(root, '.sekai-template'));

  /* 1. The workflow, and its four structural properties. */

  if (!existsSync(join(root, WORKFLOW))) {
    failures.push(
      `${WORKFLOW}: missing. The corpus refresh workflow is what keeps the deployed ` +
        'retrieval index current with knowledge/; without it the documented CI ' +
        'exception describes a job that does not exist.',
    );
    return { failures, skipped, checked, templateMode };
  }

  const workflow = read(WORKFLOW);
  const triggers = topLevelBlock(workflow, 'on');

  if (!triggers) {
    failures.push(`${WORKFLOW}: no top-level \`on:\` block found; the triggers cannot be checked.`);
  } else {
    const body = triggers.join('\n');

    for (const trigger of ['pull_request', 'pull_request_target']) {
      const hit = triggers.find((line) => new RegExp(`^\\s+${trigger}\\s*:`).test(line));
      if (hit) {
        failures.push(
          `${WORKFLOW}: the \`on:\` block carries \`${trigger}\`. This workflow holds a ` +
            'Cloudflare deploy credential, and a pull-request trigger runs code from the ' +
            'pull request with it. Push to `main` and manual dispatch only.',
        );
      } else {
        checked += 1;
      }
    }

    if (!/^\s+push\s*:/m.test(body)) {
      failures.push(`${WORKFLOW}: the \`on:\` block declares no \`push\` trigger, so no article edit refreshes the corpus.`);
    } else if (!/branches:\s*\[\s*main\s*\]/.test(body)) {
      failures.push(
        `${WORKFLOW}: the \`push\` trigger does not restrict branches to exactly \`[main]\`. ` +
          'Any other branch would deploy unreviewed code to production.',
      );
    } else {
      checked += 1;
    }

    if (!/knowledge\/\*\*/.test(body)) {
      failures.push(
        `${WORKFLOW}: the \`push\` trigger has no \`knowledge/**\` path filter, so every ` +
          'push to `main` would spend the embedding allowance rebuilding an unchanged corpus.',
      );
    } else {
      checked += 1;
    }
  }

  /* 2. Least privilege: no write scope anywhere in the file. */

  const blocks = permissionsBlocks(workflow);
  if (blocks.length === 0) {
    failures.push(
      `${WORKFLOW}: no \`permissions:\` block. Without one the workflow inherits the ` +
        "repository default, which may include write scopes it does not need.",
    );
  } else {
    if (!/^permissions:\s*$/m.test(workflow)) {
      failures.push(`${WORKFLOW}: no TOP-LEVEL \`permissions:\` block; a job added later would inherit the repository default.`);
    } else {
      checked += 1;
    }
    for (const block of blocks) {
      for (const entry of block.entries) {
        const [, , value] = /^([\w-]+)\s*:\s*(\S+)/.exec(entry.text) ?? [];
        if (value && value !== 'read' && value !== 'none') {
          failures.push(
            `${WORKFLOW}:${entry.line}: \`${entry.text}\` grants a non-read scope. This ` +
              'workflow writes to Cloudflare with a credential, never to this repository; ' +
              'a write scope here is a privilege it has no use for.',
          );
        } else {
          checked += 1;
        }
      }
    }
  }

  /* 3. Opt-in: every credential-touching step gated on the opt-in gate's output. */

  const steps = stepBlocks(workflow);
  if (steps.length === 0) {
    failures.push(`${WORKFLOW}: no steps found; the opt-in gating cannot be checked.`);
  } else {
    const gateStep = steps.find((step) => step.text.includes(GATE_SCRIPT));
    const gateId = gateStep ? (/^\s*id:\s*(\S+)\s*$/m.exec(gateStep.text)?.[1] ?? null) : null;

    if (!gateStep) {
      failures.push(
        `${WORKFLOW}: no step runs ${GATE_SCRIPT}. That script is the opt-in decision, ` +
          'and it is a script rather than a workflow expression so that its no-op path is ' +
          'unit-tested on every pull request.',
      );
    } else if (!gateId) {
      failures.push(`${WORKFLOW}:${gateStep.line}: the opt-in gate step has no \`id:\`, so no later step can gate on its output.`);
    } else {
      checked += 1;
      const guard = `steps.${gateId}.outputs.configured == 'true'`;
      for (const step of steps) {
        if (step === gateStep) continue;
        const touchesCredentials =
          /secrets\./.test(step.text) || /embeddings:build/.test(step.text) || /wrangler deploy/.test(step.text);
        if (!touchesCredentials) continue;
        if (!step.text.includes(guard)) {
          failures.push(
            `${WORKFLOW}:${step.line}: a step that uses a secret, builds the corpus, or ` +
              `deploys is not gated on \`${guard}\`. Without that condition a repository ` +
              'that configured nothing gets a red build instead of a green no-op.',
          );
        } else {
          checked += 1;
        }
      }

      const deployStep = steps.find((step) => /wrangler deploy/.test(step.text));
      if (!deployStep) {
        failures.push(`${WORKFLOW}: no step deploys a worker, so a rebuilt corpus never reaches production.`);
      } else if (!deployStep.text.includes("github.ref == 'refs/heads/main'")) {
        failures.push(
          `${WORKFLOW}:${deployStep.line}: the deploy step is not restricted to ` +
            "`github.ref == 'refs/heads/main'`. A manual dispatch from a branch would " +
            'publish that branch to production.',
        );
      } else {
        checked += 1;
      }
    }
  }

  /* 4. This is the only workflow that deploys a worker (the prose says so). */

  const workflowsDir = join(root, WORKFLOWS_DIR);
  if (existsSync(workflowsDir)) {
    for (const name of readdirSync(workflowsDir).sort()) {
      const rel = `${WORKFLOWS_DIR}/${name}`;
      if (rel === WORKFLOW || !/\.ya?ml$/.test(name)) continue;
      if (/wrangler deploy/.test(read(rel))) {
        failures.push(
          `${rel}: deploys a worker. The CI-deploy exception covers exactly one workflow ` +
            `(${WORKFLOW}); a second one is a new exception, and the documents an adopter ` +
            'reads still describe one.',
        );
      } else {
        checked += 1;
      }
    }
  }

  /* 5. The scripts the workflow delegates to. */

  for (const rel of [GATE_SCRIPT, TARGETS_SCRIPT]) {
    if (!existsSync(join(root, rel))) {
      failures.push(`${rel}: missing, but ${WORKFLOW} or its npm script depends on it.`);
    } else {
      checked += 1;
    }
  }

  /* 6. The build-pipeline entries the runbook's index verification cites. */

  try {
    const pkg = JSON.parse(read(PACKAGE_JSON));
    for (const [chain, jobs] of Object.entries(CITED_PIPELINE_JOBS)) {
      const command = pkg.scripts?.[chain];
      if (typeof command !== 'string') {
        failures.push(`${PACKAGE_JSON}: no \`${chain}\` script; the runbook's deploy-time refresh claim cannot be verified.`);
        continue;
      }
      for (const job of jobs) {
        if (!command.includes(job)) {
          failures.push(
            `${PACKAGE_JSON}: the \`${chain}\` chain no longer runs \`${job}\`, which ` +
              `${RUNBOOK} cites as evidence that a deploy refreshes that index. Fix the ` +
              'chain or the statement.',
          );
        } else {
          checked += 1;
        }
      }
    }
  } catch (err) {
    failures.push(`${PACKAGE_JSON}: cannot be read or parsed (${err.message}).`);
  }

  /* 7. The prose: required statements present, retired ones gone. */

  for (const statement of REQUIRED_STATEMENTS) {
    const abs = join(root, statement.file);
    const required = statement.scope === 'framework' || templateMode;
    if (!existsSync(abs)) {
      if (required) failures.push(`${statement.file}: registered file is missing (${statement.label}).`);
      else skipped.push(`${statement.file} (absent)`);
      continue;
    }
    if (statement.anchor.test(readFileSync(abs, 'utf8'))) {
      checked += 1;
      continue;
    }
    if (required) {
      failures.push(
        `${statement.file}: anchor NOT FOUND for "${statement.label}". The statement was ` +
          "reworded, moved, or deleted -- re-point this guard's registry entry in the same commit.",
      );
    } else {
      skipped.push(`${statement.file} (${statement.label}: adopter-reworded)`);
    }
  }

  for (const target of FORBIDDEN_FILES) {
    const abs = join(root, target.file);
    if (!existsSync(abs)) {
      if (target.scope === 'framework' || templateMode) {
        failures.push(`${target.file}: missing, so the retired CI rules cannot be checked for.`);
      } else {
        skipped.push(`${target.file} (absent)`);
      }
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    for (const statement of FORBIDDEN_STATEMENTS) {
      const match = statement.pattern.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        failures.push(
          `${target.file}:${line}: carries ${statement.label} ("${match[0]}"). This ` +
            'repository ships a workflow that deploys a worker, so that sentence tells a ' +
            'reader the opposite of what the code does.',
        );
      } else {
        checked += 1;
      }
    }
  }

  return { failures, skipped, checked, templateMode };
}

/* -- Self-test: every detector must be able to fail -------------------------- */

const COMPLIANT_WORKFLOW = `name: Corpus refresh

# A comment mentioning pull_request must not read as a trigger.
on:
  push:
    branches: [main]
    paths:
      - 'knowledge/**'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
      - name: Corpus refresh opt-in gate
        id: gate
        env:
          CF_ACCOUNT_ID: \${{ secrets.CF_ACCOUNT_ID }}
        run: node ${GATE_SCRIPT}
      - name: Rebuild the corpus embeddings
        if: steps.gate.outputs.configured == 'true'
        env:
          CF_AI_TOKEN: \${{ secrets.CF_AI_TOKEN }}
        run: npm run embeddings:build
      - name: Redeploy the workers that bundle the corpus
        if: steps.gate.outputs.configured == 'true' && github.ref == 'refs/heads/main'
        run: npx wrangler deploy --config workers/chat/wrangler.generated.toml
`;

const COMPLIANT_RUNBOOK = `# DEPLOY

### Corpus embeddings

**1. Push to \`main\` only.** Never on a pull request.
**2. Opt-in, and absent-safe.** No secret, no refresh.
**3. Least privilege.** Read-only on this repository.
**4. A documented blast radius.** The token deploys.

\`\`\`
Account | Workers AI | Read
Account | Workers AI | Edit
Account | Workers Scripts | Edit
\`\`\`

### What a deploy already refreshes

prebuild:sync, prebuild:kb-index, prebuild:search, postbuild:graph.

### Revoking the CI refresh

Delete the secret.
`;

const COMPLIANT_AGENTS = `# Instance

Workers are deployed by hand, with one narrow exception: the corpus refresh.
`;

function selftest() {
  const fixture = mkdtempSync(join(tmpdir(), 'corpus-refresh-selftest-'));
  const write = (rel, content) => {
    mkdirSync(dirname(join(fixture, rel)), { recursive: true });
    writeFileSync(join(fixture, rel), content);
  };
  const build = () => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(fixture, { recursive: true });
    write('.sekai-template', 'marker\n');
    write(WORKFLOW, COMPLIANT_WORKFLOW);
    write(`${WORKFLOWS_DIR}/deploy.yml`, 'name: Deploy\non:\n  pull_request:\njobs: {}\n');
    write(GATE_SCRIPT, '// gate\n');
    write(TARGETS_SCRIPT, '// targets\n');
    write(RUNBOOK, COMPLIANT_RUNBOOK);
    write(AGENTS, COMPLIANT_AGENTS);
    write(
      PACKAGE_JSON,
      `${JSON.stringify(
        {
          scripts: {
            prebuild: 'npm run prebuild:sync && run-p prebuild:kb-index prebuild:search',
            postbuild: 'run-s postbuild:smoke postbuild:graph',
          },
        },
        null,
        2,
      )}\n`,
    );
  };

  const cases = [
    {
      what: 'a pull-request trigger on the credential-carrying workflow',
      plant: () => write(WORKFLOW, COMPLIANT_WORKFLOW.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:')),
      expect: /carries `pull_request`/,
    },
    {
      what: 'a pull_request_target trigger',
      plant: () => write(WORKFLOW, COMPLIANT_WORKFLOW.replace('  workflow_dispatch:', '  pull_request_target:')),
      expect: /carries `pull_request_target`/,
    },
    {
      what: 'a push trigger that is not restricted to main',
      plant: () => write(WORKFLOW, COMPLIANT_WORKFLOW.replace('branches: [main]', 'branches: [main, staging]')),
      expect: /does not restrict branches to exactly/,
    },
    {
      what: 'a missing knowledge path filter',
      plant: () => write(WORKFLOW, COMPLIANT_WORKFLOW.replace(/\n    paths:\n      - 'knowledge\/\*\*'/, '')),
      expect: /no `knowledge\/\*\*` path filter/,
    },
    {
      what: 'a write scope in a permissions block',
      plant: () => write(WORKFLOW, COMPLIANT_WORKFLOW.replace('permissions:\n  contents: read', 'permissions:\n  contents: write')),
      expect: /grants a non-read scope/,
    },
    {
      what: 'a credential step that lost its opt-in condition',
      plant: () =>
        write(
          WORKFLOW,
          COMPLIANT_WORKFLOW.replace("        if: steps.gate.outputs.configured == 'true'\n        env:\n          CF_AI_TOKEN", '        env:\n          CF_AI_TOKEN'),
        ),
      expect: /is not gated on/,
    },
    {
      what: 'a deploy step that lost its main-branch restriction',
      plant: () =>
        write(
          WORKFLOW,
          COMPLIANT_WORKFLOW.replace(
            "        if: steps.gate.outputs.configured == 'true' && github.ref == 'refs/heads/main'",
            "        if: steps.gate.outputs.configured == 'true'",
          ),
        ),
      expect: /not restricted to/,
    },
    {
      what: 'a second workflow that deploys a worker',
      plant: () => write(`${WORKFLOWS_DIR}/deploy.yml`, 'name: Deploy\njobs:\n  x:\n    steps:\n      - run: npx wrangler deploy\n'),
      expect: /deploys a worker\. The CI-deploy exception covers exactly one workflow/,
    },
    {
      what: 'a renamed prebuild job the runbook still cites',
      plant: () =>
        write(
          PACKAGE_JSON,
          `${JSON.stringify(
            {
              scripts: {
                prebuild: 'npm run prebuild:sync && run-p prebuild:kb prebuild:search',
                postbuild: 'run-s postbuild:smoke postbuild:graph',
              },
            },
            null,
            2,
          )}\n`,
        ),
      expect: /no longer runs `prebuild:kb-index`/,
    },
    {
      what: 'a deleted registered statement',
      plant: () => write(RUNBOOK, COMPLIANT_RUNBOOK.replace('### Revoking the CI refresh\n', '### Rolling it back\n')),
      expect: /anchor NOT FOUND/,
    },
    {
      what: 'a re-introduced retired rule in the runbook',
      plant: () => write(RUNBOOK, `${COMPLIANT_RUNBOOK}\nWorkers are deployed by hand, never by CI.\n`),
      expect: /carries the retired "never by CI" rule/,
    },
    {
      what: 'a re-introduced retired rule in the instance-owned context file',
      plant: () => write(AGENTS, `${COMPLIANT_AGENTS}\nCI never deploys a worker.\n`),
      expect: /carries the retired "CI never deploys a worker" rule/,
    },
    {
      what: 'a missing opt-in gate script',
      plant: () => rmSync(join(fixture, GATE_SCRIPT)),
      expect: new RegExp(`${GATE_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: missing`),
    },
    {
      what: 'a missing workflow',
      plant: () => rmSync(join(fixture, WORKFLOW)),
      expect: /missing\. The corpus refresh workflow/,
    },
  ];

  let passed = 0;
  const problems = [];

  build();
  const clean = runCheck(fixture);
  if (clean.failures.length > 0) {
    problems.push(`the compliant fixture FAILED, so no planted case proves anything:\n    ${clean.failures.join('\n    ')}`);
  } else {
    passed += 1;
  }

  for (const testCase of cases) {
    build();
    testCase.plant();
    const { failures } = runCheck(fixture);
    const hit = failures.find((f) => testCase.expect.test(f));
    if (hit) passed += 1;
    else {
      problems.push(
        `NOT DETECTED: ${testCase.what}\n    expected a failure matching ${testCase.expect}\n` +
          `    got: ${failures.length ? failures.join('\n         ') : '(no failures at all)'}`,
      );
    }
  }

  rmSync(fixture, { recursive: true, force: true });

  if (problems.length) {
    console.error('FAIL: the corpus-refresh guard self-test found undetectable defect classes:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`OK: corpus-refresh guard self-test passed -- ${passed} cases (1 compliant + ${cases.length} planted defects).`);
  process.exit(0);
}

/* -- CLI --------------------------------------------------------------------- */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) selftest();

  let root = DEFAULT_ROOT;
  const rootIndex = argv.indexOf('--root');
  if (rootIndex !== -1) {
    root = argv[rootIndex + 1];
    if (!root) {
      console.error('FAIL: --root needs a directory');
      process.exit(1);
    }
  }

  const { failures, skipped, checked, templateMode } = runCheck(root);
  if (failures.length) {
    console.error('FAIL: the CI-deploy exception does not hold:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  const mode = templateMode ? 'template mode' : 'instance mode';
  const skips = skipped.length ? `; ${skipped.length} instance-owned skipped: ${skipped.join(', ')}` : '';
  console.log(`OK: corpus-refresh guard passed [${mode}] -- ${checked} assertions${skips}`);
  process.exit(0);
}
