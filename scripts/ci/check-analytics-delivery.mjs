#!/usr/bin/env node
// check-analytics-delivery.mjs -- the analytics credential-boundary gate.
//
// ADR 012 fetches analytics ephemerally during the production Pages build, in the
// SAME job that builds the site. That job also runs on `pull_request`, because it is
// the build gate every task PR has to pass. So the credential boundary inside that
// job is the whole security property: a step that can receive an analytics secret
// must be unreachable on a pull request, or the workflow hands a Google service
// account key and a Cloudflare API token to anyone who opens one.
//
// Nothing else in the repository fails when that boundary erodes. Dropping an `if:`
// so a step "always runs", adding a secret to a step for convenience, or moving the
// fetch after the build all leave CI green. So the properties are asserted here,
// from .github/workflows/deploy.yml itself, on every pull request:
//
//   1. EVENT GATING. Every analytics step carries the exact push-to-main condition.
//      A pull-request run reaches none of them.
//   2. CREDENTIAL BOUNDARY. Every analytics secret reference lives on a step that
//      carries that condition, and `GOOGLE_SERVICE_ACCOUNT_JSON` in particular
//      appears only on the step that materializes it -- never in the fetch step's
//      environment, and never written to a workspace path.
//   3. RUNNER-TEMPORARY KEY STORAGE. The service-account key is written under
//      `runner.temp` and nowhere else, and a removal step guarded by `always()`
//      deletes exactly that path.
//   4. ORDERING. The fetch step precedes `npm run build` in the build job.
//   5. NON-BLOCKING FAILURE. The fetch step and the incomplete-credentials report
//      both carry `continue-on-error`, so an API outage or a half-configured
//      repository degrades the dashboard rather than blocking a content deploy.
//   6. LEAST PRIVILEGE UNCHANGED. Top-level `permissions: contents: read`, and the
//      build job grants no write scope of its own (rules/github-actions-least-
//      privilege: a per-job block REPLACES the top-level one, so a write scope added
//      to this job would be invisible at the top of the file).
//   7. IGNORED OUTPUTS. `src/data/` stays gitignored and the Pages artifact path is
//      `./dist`, so no fetched analytics file can enter git or ship as a separate
//      artifact.
//
// It also holds the prose to the code: the runbook's statement of the Actions secret
// set and of what a repository with no credentials gets must name the same five
// variables the gate script exports, and must describe all three credential states.
//
// Registry scopes, matching scripts/ci/check-corpus-refresh.mjs:
//   - `framework` -- present in every checkout; a missing file or anchor fails in
//     both modes.
//   - `instance`  -- a file the adopter owns. Required in template mode, reported as
//     skipped in an adopted instance, where the adopter owns that prose.
//
// Failure modes, all exit 1. Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-analytics-delivery.mjs [--root <dir>]
//        node scripts/ci/check-analytics-delivery.mjs --selftest
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { REQUIRED_VARS } from '../deploy/analytics-gate.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const WORKFLOW = '.github/workflows/deploy.yml';
const GATE_SCRIPT = 'scripts/deploy/analytics-gate.mjs';
const GITIGNORE = '.gitignore';
const PACKAGE_JSON = 'package.json';
const RUNBOOK = 'docs/runbook/DEPLOY.md';
const TEMPLATE_MARKER = '.sekai-template';

/** The exact `if:` condition every analytics step must carry, as a substring. */
const PUSH_MAIN_CONDITION = "github.event_name == 'push' && github.ref == 'refs/heads/main'";

/** Where the service-account key may be materialized. Anything else is a workspace write. */
const KEY_PATH_EXPRESSION = '${{ runner.temp }}/analytics-service-account.json';

/** The npm script the fetch step must invoke -- the same one the runbook documents. */
const FETCH_COMMAND = 'npm run fetch:analytics';

/** The build command the fetch has to precede. */
const BUILD_COMMAND = 'npm run build';

/** Scopes that must never appear in a `permissions:` block reachable by this workflow's build job. */
const WRITE_SCOPES = [
  'contents: write',
  'packages: write',
  'actions: write',
  'deployments: write',
  'issues: write',
  'pull-requests: write',
  'security-events: write',
  'statuses: write',
  'checks: write',
];

/* -- Prose registry ---------------------------------------------------------- */

const REQUIRED_STATEMENTS = [
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'Actions secret table heading',
    anchor: /\*\*GitHub Actions secrets\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'credential state: none configured is a green skip',
    anchor: /With \*\*no\*\* analytics secret set/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'credential state: an incomplete set is a visible failure',
    anchor: /With an \*\*incomplete\*\* set/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'credential state: a provider failure stays visible',
    anchor: /When a \*\*provider fails\*\*/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'the service-account key lives in runner-temporary storage',
    anchor: /runner-temporary storage/,
  },
  {
    file: RUNBOOK,
    scope: 'framework',
    label: 'the credentialed step never runs on a pull request',
    anchor: /never runs on a pull request/,
  },
];

/* -- Helpers ----------------------------------------------------------------- */

const errors = [];
const skipped = [];

function fail(message) {
  errors.push(message);
}

function readIfPresent(root, relative) {
  const path = join(root, relative);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/**
 * Split a workflow file into its steps, cheaply and without a YAML dependency.
 *
 * A step starts at a line matching `      - ` (six spaces, the step indent used
 * throughout this workflow) and runs until the next such line or the next line that
 * is less indented and non-blank. Every assertion below is a presence or absence
 * check over a step's text, which this shape supports exactly; nothing here needs
 * the parsed value of a key.
 *
 * @returns {{ name: string, text: string, index: number }[]}
 */
function parseSteps(source) {
  const lines = source.split('\n');
  const steps = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {6}- /.test(line)) {
      if (current) steps.push(current);
      current = { name: '', text: line, index: steps.length, line: i + 1 };
      continue;
    }
    if (current) {
      // A line that is blank, a comment, or indented at least as far as the step's
      // body still belongs to the step.
      if (line.trim() === '' || /^ {6,}/.test(line)) {
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
    const run = step.text.match(/^\s*-?\s*run:\s*(.+)$/m);
    const uses = step.text.match(/^\s*-?\s*uses:\s*(.+)$/m);
    step.name = (named?.[1] ?? run?.[1] ?? uses?.[1] ?? '(unnamed step)').trim();
  }
  return steps;
}

/**
 * The `jobs:` block for one job name, from its header to the next top-level job.
 *
 * The terminating lookahead is the next two-space job key, or true end of input
 * written as `$(?![\s\S])`. JavaScript has no `\Z`: written that way it is a literal
 * `Z`, and the lazy quantifier then ends the block at the first capital Z in the job
 * body -- which in this file is `CF_ZONE_ID`, four lines into the analytics gate.
 */
function jobBlock(source, jobName) {
  const pattern = new RegExp(
    `^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:\\n|$(?![\\s\\S]))`,
    'm',
  );
  const match = source.match(pattern);
  return match ? match[0] : null;
}

/* -- Checks ------------------------------------------------------------------ */

function checkWorkflow(root) {
  const source = readIfPresent(root, WORKFLOW);
  if (source === null) {
    fail(`${WORKFLOW} does not exist; the analytics delivery path has no workflow to gate`);
    return;
  }

  /* 6. Least privilege, checked before anything else: the top-level block is what
   *    every job inherits, and a per-job block replaces it entirely. */
  if (!/^permissions:\n  contents: read\n/m.test(source)) {
    fail(
      `${WORKFLOW} no longer declares the top-level 'permissions:\\n  contents: read' block; ` +
        'every job in this workflow runs pull-request-authored code and must inherit read-only access',
    );
  }

  const build = jobBlock(source, 'build');
  if (build === null) {
    fail(`${WORKFLOW} has no 'build:' job; the analytics fetch has nowhere to run`);
    return;
  }
  for (const scope of WRITE_SCOPES) {
    if (build.includes(scope)) {
      fail(
        `${WORKFLOW} build job grants '${scope}'. That job runs pull-request-authored code ` +
          'and executes the analytics credential path; a per-job permissions block replaces ' +
          'the top-level one, so this scope would not be visible at the top of the file',
      );
    }
  }
  if (/^\s+pages:\s*write/m.test(build) || /^\s+id-token:\s*write/m.test(build)) {
    fail(
      `${WORKFLOW} build job grants a Pages write or OIDC scope; those belong to the deploy job only`,
    );
  }

  const steps = parseSteps(build);
  const analyticsSteps = steps.filter(
    (step) =>
      step.text.includes(GATE_SCRIPT) ||
      step.text.includes(FETCH_COMMAND) ||
      step.text.includes(KEY_PATH_EXPRESSION) ||
      REQUIRED_VARS.some((name) => step.text.includes(`secrets.${name}`)) ||
      /steps\.analytics\.outputs\.state/.test(step.text),
  );

  if (analyticsSteps.length === 0) {
    fail(
      `${WORKFLOW} build job contains no analytics step. ADR 012 delivers analytics by fetching ` +
        `into ignored src/data/ during this job, immediately before '${BUILD_COMMAND}'`,
    );
    return;
  }

  /* 1 + 2. Event gating and the credential boundary. The removal step is the one
   *        analytics step that must NOT carry the push-main condition: it runs under
   *        `always()` so a cancelled or failed run still deletes the key, and it
   *        receives no secret. */
  const removalSteps = [];
  for (const step of analyticsSteps) {
    const isRemoval = /rm -f/.test(step.text) && step.text.includes(KEY_PATH_EXPRESSION);
    if (isRemoval) {
      removalSteps.push(step);
      if (REQUIRED_VARS.some((name) => step.text.includes(`secrets.${name}`))) {
        fail(
          `${WORKFLOW} build job step '${step.name}' removes the service-account key but also ` +
            'receives an analytics secret; the cleanup step runs unconditionally and must carry none',
        );
      }
      continue;
    }
    if (!step.text.includes(PUSH_MAIN_CONDITION)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' touches the analytics credential path but ` +
          `does not carry the condition "${PUSH_MAIN_CONDITION}". This job runs on pull_request, ` +
          'so a pull request would reach it',
      );
    }
  }

  /* 3. The key is materialized only under runner.temp, and always removed. */
  const materializeSteps = analyticsSteps.filter(
    (step) =>
      step.text.includes('secrets.GOOGLE_SERVICE_ACCOUNT_JSON') &&
      !/rm -f/.test(step.text) &&
      !step.text.includes(GATE_SCRIPT),
  );
  if (materializeSteps.length !== 1) {
    fail(
      `${WORKFLOW} build job has ${materializeSteps.length} steps that materialize ` +
        'GOOGLE_SERVICE_ACCOUNT_JSON, expected exactly 1 (the runner.temp write)',
    );
  }
  for (const step of materializeSteps) {
    if (!step.text.includes(KEY_PATH_EXPRESSION)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' writes the service-account key somewhere other ` +
          `than '${KEY_PATH_EXPRESSION}'. Anything under the workspace can be read by the Astro ` +
          'build and uploaded with the Pages artifact',
      );
    }
    for (const line of step.text.split('\n')) {
      if (!line.includes('GOOGLE_SERVICE_ACCOUNT_JSON')) continue;
      if (/>\s*(?!"?\$\{\{ runner\.temp \}\})/.test(line) && !line.includes('runner.temp')) {
        fail(
          `${WORKFLOW} build job step '${step.name}' redirects the service-account key to a path ` +
            `outside runner-temporary storage: ${line.trim()}`,
        );
      }
    }
  }
  if (removalSteps.length !== 1) {
    fail(
      `${WORKFLOW} build job has ${removalSteps.length} steps removing the service-account key, ` +
        'expected exactly 1',
    );
  }
  for (const step of removalSteps) {
    if (!/if:\s*always\(\)/.test(step.text)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' removes the service-account key but is not ` +
          "guarded by 'if: always()'; a cancelled or failed fetch would leave the key on the runner",
      );
    }
  }

  /* The fetch step must not receive the raw JSON: it gets a path instead. */
  const fetchSteps = analyticsSteps.filter((step) => step.text.includes(FETCH_COMMAND));
  if (fetchSteps.length !== 1) {
    fail(
      `${WORKFLOW} build job has ${fetchSteps.length} steps running '${FETCH_COMMAND}', expected exactly 1`,
    );
  }
  for (const step of fetchSteps) {
    if (step.text.includes('secrets.GOOGLE_SERVICE_ACCOUNT_JSON')) {
      fail(
        `${WORKFLOW} build job step '${step.name}' puts the raw GOOGLE_SERVICE_ACCOUNT_JSON in the ` +
          'fetch environment; the fetch receives GOOGLE_APPLICATION_CREDENTIALS pointing at ' +
          'runner-temporary storage instead',
      );
    }
    if (!step.text.includes('GOOGLE_APPLICATION_CREDENTIALS')) {
      fail(
        `${WORKFLOW} build job step '${step.name}' does not set GOOGLE_APPLICATION_CREDENTIALS; ` +
          'the fetchers would find no service-account key',
      );
    }
    /* 5. Non-blocking failure. */
    if (!/continue-on-error:\s*true/.test(step.text)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' is not 'continue-on-error: true'. A provider ` +
          'outage would then block a content deploy, instead of degrading the dashboard panel ' +
          '(ADR 012)',
      );
    }
  }

  /* The incomplete-credentials report: visible, and non-blocking. */
  const incompleteSteps = steps.filter((step) =>
    /steps\.analytics\.outputs\.state\s*==\s*'incomplete'/.test(step.text),
  );
  if (incompleteSteps.length !== 1) {
    fail(
      `${WORKFLOW} build job has ${incompleteSteps.length} steps reporting the incomplete ` +
        'credential state, expected exactly 1. An adopter with a partial secret set would ' +
        'otherwise get a silent green build and an empty dashboard',
    );
  }
  for (const step of incompleteSteps) {
    if (!/continue-on-error:\s*true/.test(step.text)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' is not 'continue-on-error: true'; a ` +
          'misconfigured secret set would block the site build',
      );
    }
  }

  /* The gate is the opt-in decision, and the fetch/materialize steps gate on it. */
  const gateSteps = analyticsSteps.filter((step) => step.text.includes(GATE_SCRIPT));
  if (gateSteps.length !== 1) {
    fail(
      `${WORKFLOW} build job has ${gateSteps.length} steps running ${GATE_SCRIPT}, expected exactly 1`,
    );
  }
  for (const step of gateSteps) {
    for (const name of REQUIRED_VARS) {
      if (!step.text.includes(`secrets.${name}`)) {
        fail(
          `${WORKFLOW} build job step '${step.name}' does not read secrets.${name}; the gate ` +
            'cannot classify a credential set it cannot see, and a missing variable would read as absent',
        );
      }
    }
    if (!/id:\s*analytics\b/.test(step.text)) {
      fail(`${WORKFLOW} build job step '${step.name}' has no 'id: analytics'; nothing can gate on its output`);
    }
  }
  for (const step of [...fetchSteps, ...materializeSteps]) {
    if (!/steps\.analytics\.outputs\.state\s*==\s*'complete'/.test(step.text)) {
      fail(
        `${WORKFLOW} build job step '${step.name}' does not gate on the analytics gate reporting ` +
          "state 'complete'; a partial credential set would send credentialed requests",
      );
    }
  }

  /* 4. Ordering: the fetch precedes the build. */
  const buildStepIndex = steps.findIndex(
    (step) => new RegExp(`run:\\s*${BUILD_COMMAND}\\s*$`, 'm').test(step.text),
  );
  if (buildStepIndex === -1) {
    fail(`${WORKFLOW} build job has no '${BUILD_COMMAND}' step`);
  } else {
    for (const step of fetchSteps) {
      if (step.index >= buildStepIndex) {
        fail(
          `${WORKFLOW} build job runs '${FETCH_COMMAND}' at or after '${BUILD_COMMAND}'. Astro reads ` +
            'the source files at build time, so a fetch that follows the build changes nothing ' +
            'that ships',
        );
      }
    }
  }

  /* 7. The Pages artifact carries the built site and nothing else. */
  const uploadStep = steps.find((step) => step.text.includes('upload-pages-artifact'));
  if (!uploadStep) {
    fail(`${WORKFLOW} build job has no Pages artifact upload step`);
  } else if (!/path:\s*\.\/dist\s*$/m.test(uploadStep.text)) {
    fail(
      `${WORKFLOW} build job uploads a Pages artifact from a path other than './dist'; the fetched ` +
        'analytics source files must never ship as a separate artifact',
    );
  }
}

function checkGitignore(root) {
  const source = readIfPresent(root, GITIGNORE);
  if (source === null) {
    fail(`${GITIGNORE} does not exist; the fetched analytics files would be committable`);
    return;
  }
  if (!/^src\/data\/\s*$/m.test(source)) {
    fail(
      `${GITIGNORE} no longer ignores 'src/data/'. ADR 012 fetches analytics into that directory ` +
        'during the production build precisely so no snapshot, and no account-scoped identifier ' +
        'inside one, enters git',
    );
  }
}

function checkPackageScripts(root) {
  const source = readIfPresent(root, PACKAGE_JSON);
  if (source === null) {
    fail(`${PACKAGE_JSON} does not exist`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    fail(`${PACKAGE_JSON} is not valid JSON: ${error.message}`);
    return;
  }
  const scripts = manifest.scripts ?? {};
  if (typeof scripts['fetch:analytics'] !== 'string') {
    fail(
      `${PACKAGE_JSON} has no 'fetch:analytics' script; the workflow step and the runbook both ` +
        'name that command',
    );
  }
}

function checkGateScript(root) {
  const source = readIfPresent(root, GATE_SCRIPT);
  if (source === null) {
    fail(`${GATE_SCRIPT} does not exist; the workflow has no opt-in decision to gate on`);
    return;
  }
  for (const name of REQUIRED_VARS) {
    if (!source.includes(name)) {
      fail(`${GATE_SCRIPT} no longer names ${name}, which the workflow passes to it`);
    }
  }
}

function checkProse(root, templateMode) {
  for (const statement of REQUIRED_STATEMENTS) {
    const source = readIfPresent(root, statement.file);
    if (source === null) {
      if (statement.scope === 'instance' && !templateMode) {
        skipped.push(`${statement.file} (${statement.label}): absent in an adopted instance`);
        continue;
      }
      fail(`${statement.file} does not exist, so the statement "${statement.label}" cannot be checked`);
      continue;
    }
    if (!statement.anchor.test(source)) {
      if (statement.scope === 'instance' && !templateMode) {
        skipped.push(`${statement.file} (${statement.label}): reworded by the adopter`);
        continue;
      }
      fail(
        `${statement.file} no longer states "${statement.label}" (expected ${statement.anchor}). ` +
          'An adopter reading this runbook would not learn what a partial or absent credential ' +
          'set does to their build',
      );
    }
  }

  /* The runbook's Actions secret table must name every variable the gate reads. A
   * variable added to REQUIRED_VARS without a runbook row is a secret an adopter is
   * never told to set, whose absence silently degrades their dashboard. */
  const runbook = readIfPresent(root, RUNBOOK);
  if (runbook !== null) {
    for (const name of REQUIRED_VARS) {
      if (!runbook.includes(`\`${name}\``)) {
        fail(
          `${RUNBOOK} does not document the Actions secret ${name}, which ${GATE_SCRIPT} requires ` +
            'for a complete credential set',
        );
      }
    }
  }
}

/* -- Runner ------------------------------------------------------------------ */

function run(root) {
  errors.length = 0;
  skipped.length = 0;
  const templateMode = existsSync(join(root, TEMPLATE_MARKER));

  checkWorkflow(root);
  checkGitignore(root);
  checkPackageScripts(root);
  checkGateScript(root);
  checkProse(root, templateMode);

  return { errors: [...errors], skipped: [...skipped], templateMode };
}

/* -- Self-test --------------------------------------------------------------- */

/**
 * Each case plants one defect class into a copy of this repository and requires the
 * check to fail on it. A guard whose failure paths are never exercised is a guard
 * nobody knows still works.
 */
const SELFTEST_CASES = [
  {
    label: 'the fetch step loses its push-to-main condition',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          `        if: ${PUSH_MAIN_CONDITION} && steps.analytics.outputs.state == 'complete'\n        continue-on-error: true\n        env:\n          GA4_PROPERTY_ID:`,
          `        if: steps.analytics.outputs.state == 'complete'\n        continue-on-error: true\n        env:\n          GA4_PROPERTY_ID:`,
        ),
      );
    },
    expect: /does not carry the condition/,
  },
  {
    label: 'the service-account key is written into the workspace',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          `printf '%s' "$GOOGLE_SERVICE_ACCOUNT_JSON" > "${KEY_PATH_EXPRESSION}"`,
          `printf '%s' "$GOOGLE_SERVICE_ACCOUNT_JSON" > "analytics-service-account.json"`,
        ),
      );
    },
    expect: /writes the service-account key somewhere other than/,
  },
  {
    label: 'the key removal step loses its always() guard',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          `      - name: Remove the service-account key\n        if: always()\n`,
          `      - name: Remove the service-account key\n        if: ${PUSH_MAIN_CONDITION}\n`,
        ),
      );
    },
    expect: /not guarded by 'if: always\(\)'/,
  },
  {
    label: 'the raw service-account JSON is handed to the fetch step',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          '          GOOGLE_APPLICATION_CREDENTIALS: ${{ runner.temp }}/analytics-service-account.json',
          '          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}',
        ),
      );
    },
    expect: /puts the raw GOOGLE_SERVICE_ACCOUNT_JSON in the fetch environment/,
  },
  {
    label: 'the fetch step becomes able to fail the build',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          `      - name: Fetch analytics\n        if: ${PUSH_MAIN_CONDITION} && steps.analytics.outputs.state == 'complete'\n        continue-on-error: true\n`,
          `      - name: Fetch analytics\n        if: ${PUSH_MAIN_CONDITION} && steps.analytics.outputs.state == 'complete'\n`,
        ),
      );
    },
    expect: /is not 'continue-on-error: true'/,
  },
  {
    label: 'the fetch moves after the site build',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      const fetchBlock = source.match(
        /      - name: Fetch analytics\n[\s\S]*?run: npm run fetch:analytics\n/,
      );
      if (!fetchBlock) throw new Error('self-test fixture: could not locate the fetch step');
      const without = source.replace(fetchBlock[0], '');
      writeFileSync(
        path,
        without.replace('      - run: npm run build\n', `      - run: npm run build\n${fetchBlock[0]}`),
      );
    },
    expect: /at or after 'npm run build'/,
  },
  {
    label: 'the build job grants itself a write scope',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          '  build:\n    name: Build\n    needs: [genericity, test]\n    runs-on: ubuntu-latest\n',
          '  build:\n    name: Build\n    needs: [genericity, test]\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n',
        ),
      );
    },
    expect: /build job grants 'contents: write'/,
  },
  {
    label: 'the top-level read-only permissions block is removed',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('permissions:\n  contents: read\n', ''));
    },
    expect: /no longer declares the top-level/,
  },
  {
    label: 'src/data/ stops being gitignored',
    apply: (root) => {
      const path = join(root, GITIGNORE);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace(/^src\/data\/$/m, '# src/data/'));
    },
    expect: /no longer ignores 'src\/data\/'/,
  },
  {
    label: 'the incomplete-credentials report is deleted',
    apply: (root) => {
      const path = join(root, WORKFLOW);
      const source = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        source.replace(
          /      - name: Analytics credentials incomplete\n[\s\S]*?          exit 1\n/,
          '',
        ),
      );
    },
    expect: /steps reporting the incomplete credential state/,
  },
  {
    label: 'the runbook drops an Actions secret an adopter has to set',
    apply: (root) => {
      const path = join(root, RUNBOOK);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.split('`CF_ZONE_ID`').join('CF-ZONE-ID'));
    },
    expect: /does not document the Actions secret CF_ZONE_ID/,
  },
  {
    label: 'the runbook stops telling an adopter what an incomplete set does',
    apply: (root) => {
      const path = join(root, RUNBOOK);
      const source = readFileSync(path, 'utf8');
      writeFileSync(path, source.replace('With an **incomplete** set', 'With a partial set'));
    },
    expect: /no longer states "credential state: an incomplete set is a visible failure"/,
  },
];

/** Copy the files this check reads into a scratch tree, so a case can plant a defect. */
function materializeFixture(sourceRoot) {
  const root = mkdtempSync(join(tmpdir(), 'analytics-delivery-selftest-'));
  const paths = [WORKFLOW, GITIGNORE, PACKAGE_JSON, RUNBOOK, GATE_SCRIPT, TEMPLATE_MARKER];
  for (const relative of paths) {
    const from = join(sourceRoot, relative);
    if (!existsSync(from)) continue;
    const to = join(root, relative);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
  }
  return root;
}

function selftest(sourceRoot) {
  const baseline = run(sourceRoot);
  if (baseline.errors.length > 0) {
    console.error(
      'analytics-delivery self-test FAILED: the repository itself does not pass the check, so ' +
        'no planted defect proves anything.\n' +
        baseline.errors.map((e) => `   - ${e}`).join('\n'),
    );
    return 1;
  }

  let failures = 0;
  for (const testCase of SELFTEST_CASES) {
    const root = materializeFixture(sourceRoot);
    try {
      testCase.apply(root);
      const result = run(root);
      const matched = result.errors.some((message) => testCase.expect.test(message));
      if (!matched) {
        failures += 1;
        console.error(
          `   FAIL  ${testCase.label}\n         expected an error matching ${testCase.expect}\n` +
            `         got: ${result.errors.length === 0 ? '(no errors -- the defect passed)' : result.errors.join(' | ')}`,
        );
      } else {
        console.log(`   ok    ${testCase.label}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    console.error(
      `\nanalytics-delivery self-test FAILED: ${failures}/${SELFTEST_CASES.length} planted defects ` +
        'were not caught.',
    );
    return 1;
  }
  console.log(
    `\nanalytics-delivery self-test passed: all ${SELFTEST_CASES.length} planted defect classes are caught.`,
  );
  return 0;
}

/* -- CLI --------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? DEFAULT_ROOT : argv[rootFlag + 1];

if (argv.includes('--selftest')) {
  process.exit(selftest(root));
}

const result = run(root);
if (result.errors.length > 0) {
  console.error(
    `analytics-delivery check FAILED:\n${result.errors.map((e) => `   - ${e}`).join('\n')}`,
  );
  process.exit(1);
}
for (const note of result.skipped) {
  console.log(`   skipped: ${note}`);
}
console.log(
  `analytics-delivery check passed: the analytics credential path is push-to-main only, ` +
    `gated on a complete secret set, non-blocking, and writes its key only to runner-temporary ` +
    `storage (${result.templateMode ? 'template' : 'instance'} mode).`,
);
