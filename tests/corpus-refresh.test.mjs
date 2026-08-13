// corpus-refresh.test.mjs -- run with `npm run test:corpus-refresh`.
//
// LB-98 DoD 2: with no Cloudflare secret configured the corpus-refresh job exits 0,
// deploys nothing, and the CI run stays green. That property is a script rather than a
// workflow expression precisely so a pull request can prove it, so this file is the
// proof: the gate's decision (scripts/deploy/corpus-refresh-gate.mjs) and the deploy
// target derivation (scripts/deploy/corpus-workers.mjs) are both unit-testable, and a
// "not configured" run is asserted to be a supported state rather than a failure.
//
// Written against the published contract of those two modules only; nothing here reads
// their source. Every derivation case runs against a synthetic workers/ tree built under
// node:os tmpdir, so the assertions describe the rule ("a worker whose src/ imports the
// loader module") and not the two workers that happen to satisfy it today.
//
// This file lives under tests/, which both machine gates scan: its source is pure ASCII
// and carries no denylisted place term, so every fixture worker is named alpha/beta/
// gamma/delta and every secret value in it is an obvious placeholder.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED_VARS, evaluateGate } from '../scripts/deploy/corpus-refresh-gate.mjs';
import { artifactLoaderModule, bundlingWorkers, deployTargets } from '../scripts/deploy/corpus-workers.mjs';
import { OUTPUT_PATH } from '../scripts/core/build-embeddings.mjs';

/* ------------------------------------------------------------------ fixtures */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATE_CLI = join(REPO_ROOT, 'scripts/deploy/corpus-refresh-gate.mjs');
const WORKERS_CLI = join(REPO_ROOT, 'scripts/deploy/corpus-workers.mjs');

/** The artifact basename the loader has to import, derived from the builder's own export. */
const ARTIFACT_BASENAME = OUTPUT_PATH.split('/').pop();

/** Values distinctive enough that finding either one in any output proves a leak. */
const ACCOUNT_VALUE = 'account-id-value-must-not-be-printed';
const TOKEN_VALUE = 'ai-token-value-must-not-be-printed';

const tempRoots = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * Materialize a synthetic tree from a { relativePath: contents } map and return its root.
 * The root is registered for cleanup.
 */
function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'corpus-refresh-'));
  tempRoots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

/** A workers/lib module that imports the artifact: this is what makes it the loader. */
const loaderSource = `import artifact from './${ARTIFACT_BASENAME}' with { type: 'json' };
export const loadCorpus = () => artifact;
`;

/** A workers/lib module that only mentions the artifact in prose. Not an import. */
const mentionsArtifactInAComment = `// The corpus lives in ./${ARTIFACT_BASENAME}, decoded by the loader beside this file.
export const helper = () => 'no import here';
`;

/**
 * A module that imports every specifier given, verbatim. Specifiers are written out in
 * full at every call site: reachability resolves a relative specifier against the
 * IMPORTING file's own directory, so a fixture whose specifier does not resolve where the
 * case claims it does silently tests nothing.
 */
const importsFrom = (...specifiers) =>
  `${specifiers.map((s, i) => `import * as dep${i} from '${s}';`).join('\n')}
export const deps = [${specifiers.map((_, i) => `dep${i}`).join(', ')}];
export default { fetch: () => new Response(String(deps.length)) };
`;

/**
 * The specifier that reaches workers/lib/<basename> from a file at
 * workers/<dir>/src/<depth nested dirs>/<file>.mjs: two levels to leave src/ and the
 * worker directory, plus one per nested directory.
 */
const loaderSpecifier = (basename = 'vectors.mjs', depth = 0) => `${'../'.repeat(depth + 2)}lib/${basename}`;

/** A worker source file that imports nothing at all. */
const importsNothing = `export default { fetch: () => new Response('ok') };
`;

/**
 * A tree with a loader plus one worker per entry of `spec`, where a true value means the
 * worker's src/index.mjs imports the loader directly.
 */
function treeWith(spec, extra = {}) {
  const files = { 'workers/lib/vectors.mjs': loaderSource };
  for (const [name, bundles] of Object.entries(spec)) {
    files[`workers/${name}/src/index.mjs`] = bundles ? importsFrom(loaderSpecifier()) : importsNothing;
  }
  return makeTree({ ...files, ...extra });
}

/** Every .mjs file under a directory, recursively. Returns [] when the directory is absent. */
function mjsFilesUnder(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...mjsFilesUnder(path));
    else if (entry.name.endsWith('.mjs')) found.push(path);
  }
  return found;
}

/* ============================================================ evaluateGate ============ */

describe('DoD 2: evaluateGate decides configured vs not configured', () => {
  test('REQUIRED_VARS is the two Cloudflare variables, in report order', () => {
    assert.deepEqual(REQUIRED_VARS, ['CF_ACCOUNT_ID', 'CF_AI_TOKEN']);
  });

  test('both variables set is the only configured state', () => {
    const result = evaluateGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE });
    assert.equal(result.configured, true);
    assert.deepEqual(result.missing, []);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0, 'a configured result still carries a reason');
  });

  test('CF_ACCOUNT_ID missing on its own is not configured, and is the only name reported', () => {
    const result = evaluateGate({ CF_AI_TOKEN: TOKEN_VALUE });
    assert.equal(result.configured, false);
    assert.deepEqual(result.missing, ['CF_ACCOUNT_ID']);
    assert.ok(
      result.reason.includes('CF_ACCOUNT_ID'),
      `the reason must name the missing variable, got: ${result.reason}`,
    );
  });

  test('CF_AI_TOKEN missing on its own is not configured, and is the only name reported', () => {
    const result = evaluateGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE });
    assert.equal(result.configured, false);
    assert.deepEqual(result.missing, ['CF_AI_TOKEN']);
    assert.ok(
      result.reason.includes('CF_AI_TOKEN'),
      `the reason must name the missing variable, got: ${result.reason}`,
    );
  });

  test('both missing reports both, in REQUIRED_VARS order', () => {
    const result = evaluateGate({});
    assert.equal(result.configured, false);
    assert.deepEqual(result.missing, REQUIRED_VARS);
    for (const name of REQUIRED_VARS) {
      assert.ok(result.reason.includes(name), `the reason must name ${name}, got: ${result.reason}`);
    }
  });

  test('missing keeps REQUIRED_VARS order regardless of the order the env object declares', () => {
    // An object literal that lists the two names in the opposite order must not flip the
    // report: the order is the contract's, not the caller's.
    const result = evaluateGate({ CF_AI_TOKEN: '', CF_ACCOUNT_ID: '' });
    assert.deepEqual(result.missing, REQUIRED_VARS);
  });

  for (const [what, value] of [
    ['an empty string', ''],
    ['a single space', ' '],
    ['whitespace only', '   \t  '],
    ['a newline only', '\n'],
  ]) {
    test(`${what} counts as absent: that is what an empty repository secret expands to`, () => {
      const missingToken = evaluateGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: value });
      assert.equal(missingToken.configured, false);
      assert.deepEqual(missingToken.missing, ['CF_AI_TOKEN']);

      const missingAccount = evaluateGate({ CF_ACCOUNT_ID: value, CF_AI_TOKEN: TOKEN_VALUE });
      assert.equal(missingAccount.configured, false);
      assert.deepEqual(missingAccount.missing, ['CF_ACCOUNT_ID']);
    });
  }

  test('configured is never true on a partial configuration', () => {
    const partials = [
      {},
      { CF_ACCOUNT_ID: ACCOUNT_VALUE },
      { CF_AI_TOKEN: TOKEN_VALUE },
      { CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: '' },
      { CF_ACCOUNT_ID: '  ', CF_AI_TOKEN: TOKEN_VALUE },
      { CF_ACCOUNT_ID: '', CF_AI_TOKEN: '' },
    ];
    for (const env of partials) {
      const result = evaluateGate(env);
      assert.equal(result.configured, false, `expected not configured for ${JSON.stringify(env)}`);
      assert.ok(result.missing.length > 0, 'a not-configured result names at least one variable');
    }
  });

  test('a value with surrounding whitespace still counts as present', () => {
    const result = evaluateGate({ CF_ACCOUNT_ID: `  ${ACCOUNT_VALUE}  `, CF_AI_TOKEN: `\t${TOKEN_VALUE}\n` });
    assert.equal(result.configured, true);
    assert.deepEqual(result.missing, []);
  });

  test('neither the result nor the reason ever carries a variable value', () => {
    for (const env of [
      { CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE },
      { CF_ACCOUNT_ID: ACCOUNT_VALUE },
      { CF_AI_TOKEN: TOKEN_VALUE },
    ]) {
      const result = evaluateGate(env);
      const serialized = JSON.stringify(result);
      for (const value of [ACCOUNT_VALUE, TOKEN_VALUE]) {
        assert.ok(!serialized.includes(value), `the result leaked a variable value: ${serialized}`);
        assert.ok(!result.reason.includes(value), `the reason leaked a variable value: ${result.reason}`);
      }
    }
  });

  test('extra keys on the env object are ignored', () => {
    const result = evaluateGate({
      CF_ACCOUNT_ID: ACCOUNT_VALUE,
      CF_AI_TOKEN: TOKEN_VALUE,
      PATH: '/usr/bin',
      GITHUB_REF: 'refs/heads/main',
    });
    assert.equal(result.configured, true);
  });

  test('the decision reads the passed object, never process.env', () => {
    const saved = { id: process.env.CF_ACCOUNT_ID, token: process.env.CF_AI_TOKEN };
    process.env.CF_ACCOUNT_ID = 'account-from-process-env';
    process.env.CF_AI_TOKEN = 'token-from-process-env';
    try {
      assert.equal(evaluateGate({}).configured, false);
      assert.deepEqual(evaluateGate({}).missing, REQUIRED_VARS);
    } finally {
      if (saved.id === undefined) delete process.env.CF_ACCOUNT_ID;
      else process.env.CF_ACCOUNT_ID = saved.id;
      if (saved.token === undefined) delete process.env.CF_AI_TOKEN;
      else process.env.CF_AI_TOKEN = saved.token;
    }
  });
});

/* ========================================================= the gate CLI ============== */

/** Run the gate CLI with a controlled env. `env` replaces the inherited environment. */
function runGate(env = {}) {
  const outputFile = join(mkdtempSync(join(tmpdir(), 'corpus-gate-out-')), 'github-output');
  tempRoots.push(dirname(outputFile));
  writeFileSync(outputFile, '');
  const result = spawnSync(process.execPath, [GATE_CLI], {
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile, ...env },
    encoding: 'utf8',
  });
  return { ...result, outputFile, output: readFileSync(outputFile, 'utf8') };
}

/** The non-empty lines of a GITHUB_OUTPUT file. */
const outputLines = (contents) => contents.split('\n').map((line) => line.trim()).filter(Boolean);

describe('DoD 2: the gate CLI exits 0 in both states and reports through GITHUB_OUTPUT', () => {
  test('configured: exit 0, configured=true, and an ENABLED line on stdout', () => {
    const run = runGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE });
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.deepEqual(outputLines(run.output), ['configured=true']);
    assert.match(run.stdout, /ENABLED/i, `expected an ENABLED line, got: ${run.stdout}`);
  });

  test('no secret configured: exit 0, configured=false, and a SKIPPED line on stdout', () => {
    // This is DoD 2 in one assertion: an unconfigured fork or a fresh adopter runs the
    // job, the job says it is skipping, and the CI run stays green.
    const run = runGate({});
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.deepEqual(outputLines(run.output), ['configured=false']);
    assert.match(run.stdout, /SKIPPED/i, `expected a SKIPPED line, got: ${run.stdout}`);
  });

  test('a partial configuration also exits 0 with configured=false, never a failure', () => {
    for (const env of [
      { CF_ACCOUNT_ID: ACCOUNT_VALUE },
      { CF_AI_TOKEN: TOKEN_VALUE },
      { CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: '   ' },
    ]) {
      const run = runGate(env);
      assert.equal(run.status, 0, `expected exit 0 for ${Object.keys(env)}, got ${run.status}: ${run.stderr}`);
      assert.deepEqual(outputLines(run.output), ['configured=false']);
    }
  });

  test('the configured line is appended, leaving whatever the file already carried', () => {
    const directory = mkdtempSync(join(tmpdir(), 'corpus-gate-out-'));
    tempRoots.push(directory);
    const outputFile = join(directory, 'github-output');
    writeFileSync(outputFile, 'existing-key=existing-value\n');

    const run = spawnSync(process.execPath, [GATE_CLI], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.deepEqual(outputLines(readFileSync(outputFile, 'utf8')), [
      'existing-key=existing-value',
      'configured=false',
    ]);
  });

  test('no GITHUB_OUTPUT in the environment is still exit 0, in both states', () => {
    for (const env of [
      { PATH: process.env.PATH },
      { PATH: process.env.PATH, CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE },
    ]) {
      const run = spawnSync(process.execPath, [GATE_CLI], { env, encoding: 'utf8' });
      assert.equal(run.status, 0, `expected exit 0 without GITHUB_OUTPUT, got ${run.status}: ${run.stderr}`);
    }
  });

  test('neither run prints a value it was given, on stdout or stderr', () => {
    const runs = [
      runGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE }),
      runGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE }),
      runGate({ CF_AI_TOKEN: TOKEN_VALUE }),
    ];
    for (const run of runs) {
      const printed = `${run.stdout}${run.stderr}`;
      for (const value of [ACCOUNT_VALUE, TOKEN_VALUE]) {
        assert.ok(!printed.includes(value), `the gate printed a secret value: ${printed}`);
      }
      assert.ok(!run.output.includes(ACCOUNT_VALUE) && !run.output.includes(TOKEN_VALUE),
        `the gate wrote a secret value into GITHUB_OUTPUT: ${run.output}`);
    }
  });

  test('the two states are distinguishable on stdout', () => {
    const configured = runGate({ CF_ACCOUNT_ID: ACCOUNT_VALUE, CF_AI_TOKEN: TOKEN_VALUE });
    const skipped = runGate({});
    assert.notEqual(configured.stdout, skipped.stdout);
  });
});

/* ================================================== artifactLoaderModule ============= */

describe('artifactLoaderModule finds the workers/lib module that imports the artifact', () => {
  test('the module importing the artifact is the loader, by basename', () => {
    const root = treeWith({ alpha: true });
    assert.equal(artifactLoaderModule(root), 'vectors.mjs');
  });

  test('the loader is found under whatever name it carries', () => {
    const root = makeTree({
      'workers/lib/corpus-loader.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier('corpus-loader.mjs')),
    });
    assert.equal(artifactLoaderModule(root), 'corpus-loader.mjs');
  });

  test('a sibling lib module that only mentions the artifact in a comment is not the loader', () => {
    // The real workers/lib/ has exactly this shape: one module imports the artifact and a
    // second one names it in prose while explaining that it does not.
    const root = makeTree({
      'workers/lib/corpus.mjs': mentionsArtifactInAComment,
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier()),
    });
    assert.equal(artifactLoaderModule(root), 'vectors.mjs');
  });

  test('no module imports the artifact: null, not a throw', () => {
    const root = makeTree({
      'workers/lib/corpus.mjs': mentionsArtifactInAComment,
      'workers/alpha/src/index.mjs': importsNothing,
    });
    assert.equal(artifactLoaderModule(root), null);
  });

  test('no workers/lib directory at all: null, not a throw', () => {
    const root = makeTree({ 'workers/alpha/src/index.mjs': importsNothing });
    assert.equal(artifactLoaderModule(root), null);
  });

  test('the loader is found without the artifact file itself existing', () => {
    // vectors.json is gitignored and absent from a fresh checkout, which is exactly the
    // state a CI job derives its deploy list in.
    const root = treeWith({ alpha: true });
    assert.equal(artifactLoaderModule(root), 'vectors.mjs');
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });
});

/* ======================================================= bundlingWorkers ============= */

describe('bundlingWorkers derives the workers that bundle the artifact', () => {
  test('one worker importing the loader, one not', () => {
    const root = treeWith({ alpha: true, beta: false });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('lib is never itself a target, even when its own src/ imports the loader', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      // '../../lib/vectors.mjs' from workers/lib/src/ resolves back to the loader.
      'workers/lib/src/index.mjs': importsFrom(loaderSpecifier()),
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('no loader at all: an empty list, not a throw', () => {
    const root = makeTree({
      'workers/alpha/src/index.mjs': importsNothing,
      'workers/beta/src/index.mjs': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), []);
  });

  test('no workers directory at all: an empty list, not a throw', () => {
    const root = makeTree({ 'placeholder.txt': 'no workers here\n' });
    assert.deepEqual(bundlingWorkers(root), []);
  });

  test('a third bundling worker is picked up with no change to any code', () => {
    // The derivation is the contract, not a pair of names. Two trees, same call.
    const two = treeWith({ alpha: true, beta: false, gamma: true });
    assert.deepEqual(bundlingWorkers(two), ['alpha', 'gamma']);

    const three = treeWith({ alpha: true, beta: false, gamma: true, delta: true });
    assert.deepEqual(bundlingWorkers(three), ['alpha', 'delta', 'gamma']);
  });

  test('the list is sorted regardless of directory creation order', () => {
    const root = treeWith({ gamma: true, alpha: true, delta: true });
    assert.deepEqual(bundlingWorkers(root), ['alpha', 'delta', 'gamma']);
  });

  test('a nested file reachable from the entrypoint that imports the loader counts', () => {
    // The nested file sits one directory deeper, so its specifier needs one more '..'.
    // A depth-0 specifier here would resolve to workers/alpha/lib/vectors.mjs, a file
    // that does not exist -- the case would pass for the wrong reason, or not at all.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom('./handlers/retrieve.mjs'),
      'workers/alpha/src/handlers/retrieve.mjs': importsFrom(loaderSpecifier('vectors.mjs', 1)),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('an unreachable file under src/ does not make the worker a target', () => {
    // A dead module that Wrangler never bundles must not cause a deploy. The graph
    // seeds from the configured entrypoint only, not the whole src/ tree.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsNothing,
      'workers/alpha/src/diagnostics.mjs': importsFrom(loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), []);
  });

  test('an import from a worker test/ directory does not make it a deployable bundler', () => {
    // workers/chat/test/ imports the loader to install a fixture artifact; only src/ is
    // what ships in the bundle.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier()),
      'workers/beta/src/index.mjs': importsNothing,
      'workers/beta/test/beta.test.mjs': importsFrom('../../lib/vectors.mjs'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a worker directory with no src/ is not a target', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier()),
      'workers/beta/wrangler.toml': 'name = "beta"\n',
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a worker with a .ts entrypoint declared in wrangler.toml is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/wrangler.toml': 'name = "alpha"\nmain = "src/index.ts"\n',
      'workers/alpha/src/index.ts': importsFrom(loaderSpecifier()),
      'workers/beta/wrangler.toml': 'name = "beta"\nmain = "src/index.ts"\n',
      'workers/beta/src/index.ts': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a worker with a .js entrypoint is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/wrangler.toml': 'name = "alpha"\nmain = "src/index.js"\n',
      'workers/alpha/src/index.js': importsFrom(loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a resolved .ts module in the graph is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/wrangler.toml': 'name = "alpha"\nmain = "src/index.mjs"\n',
      'workers/alpha/src/index.mjs': importsFrom('./retrieve.ts'),
      'workers/alpha/src/retrieve.ts': importsFrom(loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });
});

/* ============================================ bundlingWorkers: reachability ========== */

describe('bundlingWorkers follows the import graph, resolving specifiers', () => {
  test('a worker reaching the loader through an intermediate lib module counts', () => {
    // wrangler bundles the whole graph, so an indirect importer carries the artifact just
    // as surely as a direct one. Dropping it from the redeploy list is the stale-corpus
    // defect this task exists to remove.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.mjs': importsFrom('./vectors.mjs'),
      'workers/lib/ratelimit.mjs': importsNothing,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier('corpus.mjs')),
      'workers/beta/src/index.mjs': importsFrom(loaderSpecifier('ratelimit.mjs')),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a longer chain through the worker own src and then into lib counts', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.mjs': importsFrom('./vectors.mjs'),
      'workers/alpha/src/index.mjs': importsFrom('./retrieve.mjs'),
      'workers/alpha/src/retrieve.mjs': importsFrom('./deep/rank.mjs'),
      'workers/alpha/src/deep/rank.mjs': importsFrom(loaderSpecifier('corpus.mjs', 1)),
      'workers/beta/src/index.mjs': importsFrom('./helper.mjs'),
      'workers/beta/src/helper.mjs': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a worker-local module sharing the loader basename does not count', () => {
    // Resolution, not basename matching: beta imports its OWN ./lib/vectors.mjs, which
    // never touches the artifact, so a corpus rebuild has no bearing on it.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier()),
      'workers/beta/src/index.mjs': importsFrom('./lib/vectors.mjs'),
      'workers/beta/src/lib/vectors.mjs': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a specifier resolving to a file that does not exist is not followed and does not throw', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier('does-not-exist.mjs')),
      // A broken import beside a real one must not abort the walk of the real one.
      'workers/beta/src/index.mjs': importsFrom('./gone.mjs', loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['beta']);
  });

  test('a bare package specifier is never followed and does not throw', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom('node:assert', 'some-package/deep/entry.mjs'),
      'workers/beta/src/index.mjs': importsFrom('node:assert', loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['beta']);
  });

  test('a resolved path outside workers/ is not followed', () => {
    // outside/mod.mjs does import the loader, but the graph does not leave workers/, so
    // alpha is not a target.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'outside/mod.mjs': importsFrom('../workers/lib/vectors.mjs'),
      'workers/alpha/src/index.mjs': importsFrom('../../../outside/mod.mjs'),
      'workers/beta/src/index.mjs': importsFrom(loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['beta']);
  });

  test('a cycle in the graph terminates, and the loader behind it is still found', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      // alpha: index -> a <-> b, and b also reaches the loader.
      'workers/alpha/src/index.mjs': importsFrom('./a.mjs'),
      'workers/alpha/src/a.mjs': importsFrom('./b.mjs'),
      'workers/alpha/src/b.mjs': importsFrom('./a.mjs', loaderSpecifier()),
      // beta: the same cycle with no loader anywhere in it.
      'workers/beta/src/index.mjs': importsFrom('./a.mjs'),
      'workers/beta/src/a.mjs': importsFrom('./b.mjs'),
      'workers/beta/src/b.mjs': importsFrom('./a.mjs'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a cycle that passes through a lib module also terminates', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.mjs': importsFrom('./vectors.mjs', './ranking.mjs'),
      'workers/lib/ranking.mjs': importsFrom('./corpus.mjs'),
      'workers/alpha/src/index.mjs': importsFrom(loaderSpecifier('ranking.mjs')),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });
});

/* ================================================ specifier forms and resolution ==== */

/** A module that re-exports a binding from each specifier given, verbatim. */
const reExportsFrom = (...specifiers) =>
  `${specifiers.map((s, i) => `export { loadCorpus as dep${i} } from '${s}';`).join('\n')}
`;

/** `export * from '<specifier>'`, the whole-namespace re-export form. */
const starExportsFrom = (specifier) => `export * from '${specifier}';
`;

/** `export * as ns from '<specifier>'`, the named-namespace re-export form. */
const starAsExportsFrom = (specifier) => `export * as bundled from '${specifier}';
`;

/** A module that pulls a specifier in through a dynamic `import()`. */
const dynamicallyImports = (specifier) => `export default {
  fetch: async () => new Response(String(typeof (await import('${specifier}')))),
};
`;

describe('bundlingWorkers follows every specifier form a bundler follows', () => {
  test('a re-export chain reaching the loader counts', () => {
    // Not hypothetical: workers/chat/src/models.mjs reaches the shared retrieval code
    // through `export { EMBED_MODEL } from '../../lib/corpus.mjs'`. A scanner that read
    // only `import` would drop such a worker from the redeploy list while its bundle
    // carried the corpus.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.mjs': importsFrom('./vectors.mjs'),
      'workers/lib/ratelimit.mjs': importsNothing,
      'workers/alpha/src/index.mjs': reExportsFrom(loaderSpecifier('corpus.mjs')),
      'workers/beta/src/index.mjs': reExportsFrom(loaderSpecifier('ratelimit.mjs')),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('export * from is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.mjs': starExportsFrom('./vectors.mjs'),
      'workers/alpha/src/index.mjs': starExportsFrom(loaderSpecifier('corpus.mjs')),
      'workers/beta/src/index.mjs': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('export * as ns from is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': starAsExportsFrom(loaderSpecifier()),
      'workers/beta/src/index.mjs': importsNothing,
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a dynamic import() specifier is followed', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': dynamicallyImports(loaderSpecifier()),
      'workers/beta/src/index.mjs': dynamicallyImports('./absent.mjs'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  // Both resolution cases hop OUT of src/ and into workers/lib/. An extension-less hop
  // between two files that are both under src/ proves nothing: every .mjs there is
  // already a graph entry point, so the walk reaches the second file whether or not the
  // specifier resolved.
  test('an extension-less specifier resolves to the .mjs file beside it', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/other.mjs': importsNothing,
      'workers/alpha/src/index.mjs': importsFrom('../../lib/vectors'),
      'workers/beta/src/index.mjs': importsFrom('../../lib/other'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('an extension-less specifier resolves to a .ts file when no .mjs exists', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus.ts': importsFrom('./vectors.mjs'),
      'workers/alpha/src/index.mjs': importsFrom('../../lib/corpus'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a directory specifier resolves to its index.mjs', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus/index.mjs': importsFrom('../vectors.mjs'),
      'workers/lib/plain/index.mjs': importsNothing,
      'workers/alpha/src/index.mjs': importsFrom('../../lib/corpus'),
      'workers/beta/src/index.mjs': importsFrom('../../lib/plain'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a directory specifier resolves to its index.ts when no index.mjs exists', () => {
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/lib/corpus/index.ts': importsFrom('../vectors.mjs'),
      'workers/alpha/src/index.mjs': importsFrom('../../lib/corpus'),
    });
    assert.deepEqual(bundlingWorkers(root), ['alpha']);
  });

  test('a specifier matching none of the three resolutions is still not followed', () => {
    // Neither ./missing, ./missing.mjs, nor ./missing/index.mjs exists.
    const root = makeTree({
      'workers/lib/vectors.mjs': loaderSource,
      'workers/alpha/src/index.mjs': importsFrom('./missing'),
      'workers/beta/src/index.mjs': importsFrom('./missing', loaderSpecifier()),
    });
    assert.deepEqual(bundlingWorkers(root), ['beta']);
  });

  test("this repository's own workers really do use the re-export form", () => {
    // The reason the form is in the contract at all. If these two files stop carrying it,
    // the case above stops describing this repository -- but it still describes what
    // wrangler bundles, so the assertion here is about provenance, not behavior.
    const reExport = /export\s*\{[^}]*\}\s*from\s*['"]\.\.\/\.\.\/lib\//;
    for (const rel of ['workers/chat/src/models.mjs', 'workers/mcp/src/sql.mjs']) {
      assert.match(readFileSync(join(REPO_ROOT, rel), 'utf8'), reExport, `${rel} re-exports from workers/lib/`);
    }
  });
});

/* ========================================================== deployTargets ============ */

describe('deployTargets narrows the bundling workers to the ones this instance deployed', () => {
  const ENDPOINT = 'https://alpha.example.invalid';
  const OTHER_ENDPOINT = 'https://gamma.example.invalid';
  const root = treeWith({ alpha: true, beta: false, gamma: true });

  test('flag on and endpoint set is the only deploy state', () => {
    const place = { features: { alpha: true, gamma: false }, workers: { alpha: ENDPOINT } };
    assert.deepEqual(deployTargets(root, place), ['alpha']);
  });

  test('flag off with an endpoint set is not a target', () => {
    const place = { features: { alpha: false }, workers: { alpha: ENDPOINT } };
    assert.deepEqual(deployTargets(root, place), []);
  });

  test('flag on with the endpoint key absent is not a target', () => {
    const place = { features: { alpha: true }, workers: { gamma: OTHER_ENDPOINT } };
    assert.deepEqual(deployTargets(root, place), []);
  });

  test('flag on with an empty endpoint is not a target', () => {
    const place = { features: { alpha: true }, workers: { alpha: '' } };
    assert.deepEqual(deployTargets(root, place), []);
  });

  test('flag on with a whitespace-only endpoint is not a target', () => {
    for (const endpoint of [' ', '   \t ', '\n']) {
      const place = { features: { alpha: true }, workers: { alpha: endpoint } };
      assert.deepEqual(deployTargets(root, place), [], `endpoint ${JSON.stringify(endpoint)}`);
    }
  });

  test('a missing workers block reads as no targets rather than throwing', () => {
    assert.deepEqual(deployTargets(root, { features: { alpha: true, gamma: true } }), []);
  });

  test('a missing features block reads as no targets rather than throwing', () => {
    assert.deepEqual(deployTargets(root, { workers: { alpha: ENDPOINT, gamma: OTHER_ENDPOINT } }), []);
  });

  test('a config predating both keys reads as no targets rather than throwing', () => {
    // Absent-safe schema evolution: an instance upgrades without editing place.config.ts.
    assert.deepEqual(deployTargets(root, {}), []);
    assert.deepEqual(deployTargets(root, { features: {}, workers: {} }), []);
  });

  test('a flag that is truthy but not true is not a target', () => {
    for (const flag of ['true', 1, {}, 'yes']) {
      const place = { features: { alpha: flag }, workers: { alpha: ENDPOINT } };
      assert.deepEqual(deployTargets(root, place), [], `flag ${JSON.stringify(flag)}`);
    }
  });

  test('a configured worker that does not bundle the artifact is never a target', () => {
    // beta is deployed and enabled, but its src/ never imports the loader, so a corpus
    // rebuild has no bearing on it.
    const place = {
      features: { alpha: true, beta: true },
      workers: { alpha: ENDPOINT, beta: 'https://beta.example.invalid' },
    };
    assert.deepEqual(deployTargets(root, place), ['alpha']);
  });

  test('the target list is sorted', () => {
    const wide = treeWith({ gamma: true, alpha: true, delta: true });
    const place = {
      features: { alpha: true, gamma: true, delta: true },
      workers: { alpha: ENDPOINT, gamma: OTHER_ENDPOINT, delta: 'https://delta.example.invalid' },
    };
    assert.deepEqual(deployTargets(wide, place), ['alpha', 'delta', 'gamma']);
  });

  test('targets are always a subset of the bundling workers', () => {
    const place = {
      features: { alpha: true, beta: true, gamma: true },
      workers: { alpha: ENDPOINT, beta: 'https://beta.example.invalid', gamma: OTHER_ENDPOINT },
    };
    const bundling = bundlingWorkers(root);
    for (const target of deployTargets(root, place)) {
      assert.ok(bundling.includes(target), `${target} is a deploy target but does not bundle the artifact`);
    }
  });
});

/* ============================================================== the CLI ============== */

describe('the corpus-workers CLI prints one worker directory per line', () => {
  const runWorkersCli = (args) =>
    spawnSync(process.execPath, ['--experimental-strip-types', WORKERS_CLI, ...args], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });

  test('--all --root prints the bundling workers of that tree', () => {
    const root = treeWith({ gamma: true, alpha: true, beta: false });
    const run = runWorkersCli(['--root', root, '--all']);
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.deepEqual(run.stdout.split('\n').filter(Boolean), ['alpha', 'gamma']);
  });

  test('an empty list exits 0 with no worker names on stdout', () => {
    const root = makeTree({ 'workers/alpha/src/index.mjs': importsNothing });
    const run = runWorkersCli(['--root', root, '--all']);
    assert.equal(run.status, 0, `expected exit 0 on an empty list, got ${run.status}; stderr: ${run.stderr}`);
    assert.deepEqual(run.stdout.split('\n').filter(Boolean), []);
  });
});

/* ================================================= the repository's own tree ========= */

describe("the derivation against this repository's workers tree", () => {
  test('the loader is workers/lib/vectors.mjs, the one module importing the artifact', () => {
    assert.equal(artifactLoaderModule(REPO_ROOT), 'vectors.mjs');
  });

  test('the bundling workers are exactly the ones that reach the loader today', () => {
    // Two bounds derived from the tree on every run, plus one pin. The bounds are what
    // keep this case honest without re-implementing specifier resolution in the test:
    //
    //   lower bound -- a worker whose src/ imports the loader directly MUST appear;
    //   upper bound -- a worker whose src/ never names workers/lib/ at all CANNOT
    //                  appear, since every path to the loader enters that directory.
    //
    // The pin between them is the change detector. It is safe to pin because workers/ is
    // framework-owned: a new bundling worker is a framework change that has to update
    // this line, and the bounds above say which direction it moved.
    const loader = artifactLoaderModule(REPO_ROOT);
    assert.ok(loader, 'the repository must have a loader module for this case to mean anything');

    const workerDirs = readdirSync(join(REPO_ROOT, 'workers'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'lib')
      .map((entry) => entry.name);
    const sourcesOf = (name) =>
      mjsFilesUnder(join(REPO_ROOT, 'workers', name, 'src')).map((file) => readFileSync(file, 'utf8'));

    const importsLoaderDirectly = workerDirs.filter((name) =>
      sourcesOf(name).some((source) => source.includes(`../../lib/${loader}`)),
    );
    const neverReachesLib = workerDirs.filter((name) => !sourcesOf(name).some((source) => source.includes('lib/')));

    const actual = bundlingWorkers(REPO_ROOT);
    for (const name of importsLoaderDirectly) {
      assert.ok(actual.includes(name), `${name} imports the loader directly but is not in the deploy list`);
    }
    for (const name of neverReachesLib) {
      assert.ok(!actual.includes(name), `${name} never imports from workers/lib/ but is in the deploy list`);
    }
    assert.deepEqual(actual, ['chat', 'mcp'], 'the bundling workers changed: update this expectation');
    assert.ok(!actual.includes('lib'), 'workers/lib is never a deploy target');
  });

  test("the artifact path the derivation starts from is the builder's own export", () => {
    assert.equal(OUTPUT_PATH, 'workers/lib/vectors.json');
    assert.equal(ARTIFACT_BASENAME, 'vectors.json');
  });
});
