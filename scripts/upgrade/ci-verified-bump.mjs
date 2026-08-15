#!/usr/bin/env node
//
// ci-verified-bump.mjs -- move FRAMEWORK-VERSION only after the instance's own CI has
// reported a green conclusion for the exact head SHA of the merged tree.
//
//   node scripts/upgrade/ci-verified-bump.mjs bump --target <tag|vX.Y.Z> [--repo <dir>]
//     [--remote <name>] [--poll-seconds <n>] [--timeout-seconds <n>] [--override <reason>]
//
// Why this exists: the marker records which framework release this instance has
// ADOPTED, and an adoption is only real once the merged tree passes the instance's own
// gates. The step this helper replaces ran `npm run build` and wrote the file in the
// same breath, so no CI run existed at bump time by construction -- and `npm run build`
// is a strict subset of CI. On one real adoption the merged head failed a CI-only gate
// while the marker already advertised the new release, and a write cannot be moved back
// after its own verification.
//
// So the sequence is: push the merged branch, read the conclusion GitHub recorded for
// that exact commit, and only then write. Resolving BY HEAD SHA rather than by branch
// name is the load-bearing part: a branch can advance between the push and the poll,
// and the marker must describe the tree that was actually verified.
//
// This reaches the network mid-upgrade, which a purely local helper would not. That is
// deliberate and was accepted with the topology in view: an instance has local and
// production, sharing one build, and no staging tier where a merged tree could be
// verified before promotion. Verifying against the tier that exists beats designing
// around one that does not.
//
// What it will NOT do: infer a conclusion. "No run found" is not success, an in-flight
// run is not success, a green PARTIAL set is not success (GitHub creates a job's check
// run only when that job becomes eligible, so an all-completed check list is a snapshot
// until the workflow run itself is completed -- see `fetchWorkflowRuns`), and an
// unreachable API is not success. Each stops with its own diagnostic and leaves the
// marker exactly where the package-state restore put it. A maintainer who knows better
// can pass --override <reason>, which is recorded in the run output and on the commit,
// because an unverified adoption that leaves no trace is the failure this helper exists
// to end.
//
// --override answers ONLY the unreadable case. A conclusion that was read and is red is
// never overridable: "a red or failing run never bumps" is unconditional, and the two
// situations differ in what the operator asserts -- "I verified this another way" versus
// "I know it failed and am recording it as adopted".
//
// Exit codes: 0 = a green conclusion (or a recorded override of an UNREADABLE one) and
// the marker was written and committed; 1 = a conclusion was read and it is not green,
// or the tree is not in a state that can be verified -- marker untouched, and --override
// does not apply; 3 = no conclusion could be read at all -- marker untouched; 2 = usage.
//
// `scripts/upgrade/check-upgrade-state.sh` is the regression gate (case 16); case 12
// pins the other half, that the merge itself never moves the marker.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIX = 'ci-verified-bump';
const FRAMEWORK_VERSION = 'FRAMEWORK-VERSION';
const VERSION_RE = /^v\d+\.\d+\.\d+$/;
const TAG_PREFIX = 'sekai-kb-';

const EXIT_NOT_GREEN = 1;
const EXIT_USAGE = 2;
const EXIT_UNREADABLE = 3;

/**
 * Conclusions that are not a failure. `skipped` and `neutral` are how a workflow job
 * reports "this did not apply to this run" -- an opt-in job whose secret is unset, a
 * path filter that did not match -- and treating either as red would make the bump
 * unreachable on a correctly configured instance.
 */
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

class BumpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const usageError = (message) => new BumpError(message, EXIT_USAGE);
const unreadable = (message) => new BumpError(
  `${message}\n`
  + `  no CI conclusion could be read, so ${FRAMEWORK_VERSION} is left unchanged.\n`
  + '  read the conclusion yourself and re-run this step, or pass\n'
  + '  --override "<reason>" to record an adoption you are vouching for by hand.',
  EXIT_UNREADABLE,
);

function git(repo, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (allowFailure) return null;
    const detail = (err.stderr ?? '').toString().trim() || err.message;
    throw new BumpError(`git ${args.join(' ')} failed: ${detail}`, EXIT_NOT_GREEN);
  }
}

/** Synchronous sleep: this helper is sync end to end, and a poll is a wait, not a race. */
function sleepSeconds(seconds) {
  if (seconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/* -- Repository identity ---------------------------------------------------- */

/**
 * The GitHub `owner/repo` behind a remote URL, or null when the URL is not GitHub.
 * Accepts the HTTPS and SSH forms git writes; a trailing `.git` is optional.
 */
export function parseGitHubRepo(url) {
  if (!url) return null;
  const patterns = [
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^ssh:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^(?:[^@]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url.trim());
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

function resolveRepository(root, remote) {
  const url = git(root, ['remote', 'get-url', remote], { allowFailure: true });
  if (!url) {
    const remotes = git(root, ['remote'], { allowFailure: true }) || '';
    throw unreadable(
      `no remote named \`${remote}\` is configured in this clone`
      + `${remotes ? ` (it has: ${remotes.split('\n').join(', ')})` : ' (it has no remotes at all)'}.\n`
      + '  a CI conclusion lives on the remote this instance pushes to; without one there\n'
      + `  is nothing to read. Configure it, push the merge, and re-run, or pass --remote <name>.`,
    );
  }
  const repository = parseGitHubRepo(url);
  if (!repository) {
    throw unreadable(
      `the \`${remote}\` remote is not a GitHub repository: ${url}\n`
      + '  this step reads the conclusion GitHub recorded for the pushed head.',
    );
  }
  return repository;
}

/* -- The conclusion --------------------------------------------------------- */

/**
 * Classify a failed `gh` invocation. The three shapes worth naming separately are the
 * ones an operator acts on differently: gh is not installed or not authenticated, the
 * network is unreachable, and GitHub has never seen this commit (the merge was not
 * pushed). Anything else is reported verbatim rather than guessed at.
 */
function classifyGhFailure(err) {
  if (err.code === 'ENOENT') {
    return 'the `gh` CLI is not on PATH, so no conclusion can be read.\n'
      + '  install it (https://cli.github.com) and run `gh auth login`, then re-run this step.';
  }
  const detail = `${(err.stderr ?? '').toString()}${(err.stdout ?? '').toString()}`.trim()
    || err.message;
  if (/no commit found|HTTP 422|HTTP 404|Not Found/i.test(detail)) {
    return `GitHub has no record of this commit, so the merge was never pushed:\n  ${detail}\n`
      + '  push the merged branch first -- the conclusion this step reads is produced by that push.';
  }
  if (/dial tcp|no such host|could not resolve host|network is unreachable|connection refused|i\/o timeout|TLS handshake/i.test(detail)) {
    return `the GitHub API could not be reached, so this is a network failure, not a verdict:\n  ${detail}`;
  }
  if (/auth|token|credential|401|403/i.test(detail)) {
    return `\`gh\` could not authenticate against GitHub:\n  ${detail}\n`
      + '  run `gh auth login`, then re-run this step.';
  }
  return `\`gh\` failed and this step will not guess what that means:\n  ${detail}`;
}

function ghJson(repository, path) {
  let raw;
  try {
    raw = execFileSync(
      'gh',
      ['api', path],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    throw unreadable(classifyGhFailure(err));
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw unreadable('the GitHub API answered with something this step could not parse as JSON.');
  }
}

/**
 * The workflow runs GitHub has for one exact commit.
 *
 * This is the completeness signal, and it is why the check-run list alone cannot be
 * trusted. GitHub creates a job's check run only when that job becomes ELIGIBLE, so in
 * a chained workflow the list is built up as the run proceeds: at the moment the first
 * job finishes, `commits/<sha>/check-runs` holds exactly one entry, completed and
 * green, while every job that could still fail has no check run yet. Measured on this
 * repository's own `deploy.yml`, one run produced three such windows -- each job's
 * `created_at` equal to its predecessor's `completed_at`. A poll landing in one of them
 * would read an all-green partial set as a final verdict and write the marker on a tree
 * whose remaining jobs had not started.
 *
 * A workflow run, by contrast, exists from the moment the workflow is triggered and
 * reaches `completed` only when every one of its jobs has. So the rule is: every
 * workflow run for this SHA must be completed BEFORE any check-run conclusion is read.
 */
function fetchWorkflowRuns(repository, sha) {
  const payload = ghJson(repository, `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`);
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  return runs.map((run) => ({
    name: typeof run?.name === 'string' ? run.name : '(unnamed workflow)',
    status: run?.status ?? null,
    conclusion: run?.conclusion ?? null,
    url: run?.html_url ?? null,
  }));
}

function fetchCheckRuns(repository, sha) {
  let raw;
  try {
    raw = execFileSync(
      'gh',
      ['api', `repos/${repository}/commits/${sha}/check-runs?per_page=100`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    throw unreadable(classifyGhFailure(err));
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw unreadable('the GitHub API answered with something this step could not parse as JSON.');
  }
  const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return runs.map((run) => ({
    name: typeof run?.name === 'string' ? run.name : '(unnamed check)',
    status: run?.status ?? null,
    conclusion: run?.conclusion ?? null,
    url: run?.html_url ?? null,
  }));
}

/**
 * The conclusion for one exact commit, polled until it exists or the deadline passes.
 *
 * Two conditions, and the first one is what makes the second meaningful:
 *
 *   1. At least one workflow run for this SHA, and EVERY workflow run completed. This
 *      establishes that the check-run list is finished being built (see
 *      `fetchWorkflowRuns`). Without it an all-completed check-run list is only a
 *      snapshot, and a green snapshot taken between two jobs is not a green run.
 *   2. Every check run completed. This catches a check that is not backed by an Actions
 *      workflow run at all, which condition 1 cannot see.
 *
 * The verdict is then read from BOTH lists, because neither is a superset of the other:
 * a check run can exist with no workflow run behind it, and a workflow run can fail
 * with no check run behind it.
 *
 * An empty answer is deliberately NOT success: it is what a repository with Actions
 * disabled looks like, what a push that triggered no workflow looks like, and what a
 * run GitHub has not created yet looks like. The first two are terminal and the third
 * resolves within seconds, so polling first and stopping second distinguishes them
 * without ever reading absence as approval.
 */
function resolveConclusion(repository, sha, { pollSeconds, timeoutSeconds }) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const workflows = fetchWorkflowRuns(repository, sha);
    const workflowsPending = workflows.filter((run) => run.status !== 'completed');
    const runs = fetchCheckRuns(repository, sha);
    const pending = runs.filter((run) => run.status !== 'completed');
    const settled = workflows.length > 0 && workflowsPending.length === 0
      && runs.length > 0 && pending.length === 0;
    if (settled) {
      // Both lists carry conclusions, and both are authoritative. A workflow run that
      // failed at STARTUP -- invalid workflow YAML, which is what a badly resolved
      // conflict under `.github/workflows/` produces on exactly this merge -- is
      // completed with a failing conclusion and never created a job, so no check run
      // represents it. It is visible here and nowhere else. A run that failed because
      // one of its jobs failed is named twice; that is noise, not a wrong answer.
      const failing = [
        ...workflows.filter((run) => !PASSING_CONCLUSIONS.has(run.conclusion)),
        ...runs.filter((run) => !PASSING_CONCLUSIONS.has(run.conclusion)),
      ];
      return { runs, workflows, failing };
    }
    if (Date.now() >= deadline) {
      if (workflows.length === 0 && runs.length === 0) {
        throw unreadable(
          `GitHub reports no workflow run and no check run at all for ${sha} in ${repository}.\n`
          + '  that is what Actions disabled on the repository looks like, and what a push\n'
          + '  that triggered no workflow looks like. It is never what success looks like.',
        );
      }
      if (workflows.length === 0) {
        throw unreadable(
          `GitHub reports check runs for ${sha} in ${repository} but no workflow run:\n`
          + `    ${runs.map((run) => run.name).join(', ')}\n`
          + '  without a workflow run there is nothing that says the check list is complete, so\n'
          + '  a green reading here could be a partial one. This step will not guess; if you\n'
          + '  verified the tree another way, record that with --override "<reason>".',
        );
      }
      if (workflowsPending.length > 0) {
        throw unreadable(
          `CI has not completed for ${sha} in ${repository}: `
          + `${workflowsPending.map((run) => `${run.name} (${run.status})`).join(', ')} still running.\n`
          + '  a workflow run that is not completed can still create jobs that fail, so the\n'
          + '  checks it has produced so far are not a verdict.\n'
          + '  raise --timeout-seconds, or wait for the run and re-run this step.',
        );
      }
      throw unreadable(
        `CI has not completed for ${sha} in ${repository}: `
        + `${pending.map((run) => `${run.name} (${run.status})`).join(', ')} still running.\n`
        + '  raise --timeout-seconds, or wait for the run and re-run this step.',
      );
    }
    sleepSeconds(pollSeconds);
  }
}

/* -- The bump --------------------------------------------------------------- */

function assertVerifiableTree(root) {
  if (existsSync(resolve(root, '.sekai-template'))) {
    throw usageError('this is the framework template, not an adopted instance: nothing to bump.');
  }
  if (git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFailure: true })) {
    throw new BumpError(
      'a merge is still in progress, so there is no finalized tree for CI to have verified.\n'
      + '  finish the merge (`git commit --no-edit`), push it, then re-run this step.',
      EXIT_NOT_GREEN,
    );
  }
  const unmerged = git(root, ['diff', '--name-only', '--diff-filter=U']);
  if (unmerged) {
    throw new BumpError(
      `unmerged paths remain: ${unmerged.split('\n').join(', ')}\n`
      + '  resolve them, finalize the merge, and push before verifying.',
      EXIT_NOT_GREEN,
    );
  }
}

/**
 * The marker's current value, for a diagnostic that quotes what the tree was left at.
 * An unreadable file is not an error here: this runs only inside the not-green message,
 * where an ENOENT thrown outside `BumpError` would replace the failing check's name with
 * a stack trace -- losing the one thing the operator needs.
 */
function readMarker(root) {
  try {
    return readFileSync(resolve(root, FRAMEWORK_VERSION), 'utf8').trim();
  } catch {
    return '(unreadable)';
  }
}

function writeMarker(root, version, { sha, summary, override }) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== sha) {
    throw new BumpError(
      `HEAD moved from ${sha} to ${head} while the conclusion was being read.\n`
      + `  ${FRAMEWORK_VERSION} must describe the tree that was verified, so nothing was written.\n`
      + '  push the new head and re-run this step against it.',
      EXIT_NOT_GREEN,
    );
  }
  const path = resolve(root, FRAMEWORK_VERSION);
  writeFileSync(path, `${version}\n`);
  if (readFileSync(path, 'utf8').trim() !== version) {
    throw new BumpError(`${FRAMEWORK_VERSION} is not ${version} after the write`, EXIT_NOT_GREEN);
  }
  git(root, ['add', '--', FRAMEWORK_VERSION]);
  const body = override
    ? `Verified: overridden by hand on ${sha}\nOverride: ${override}\n\n${summary}`
    : `Verified: CI green on ${sha}\n\n${summary}`;
  git(root, ['commit', '-m', `chore: ${FRAMEWORK_VERSION} -> ${version}`, '-m', body]);
}

function bump(root, options) {
  assertVerifiableTree(root);
  const version = options.target.startsWith(TAG_PREFIX)
    ? options.target.slice(TAG_PREFIX.length)
    : options.target;
  if (!VERSION_RE.test(version)) {
    throw usageError(
      `--target must be a release tag or its v-prefixed version, got: ${options.target}`,
    );
  }

  const sha = git(root, ['rev-parse', 'HEAD']);

  // Resolving the repository is INSIDE the try, not before it. "No remote configured"
  // and "the remote is not GitHub" are unreadable-CI shapes like any other, so the
  // override has to reach them too. Resolving first would make `--override` unreachable
  // on exactly the instance that most needs it: one with nowhere to push, where no
  // conclusion can ever exist.
  let outcome;
  try {
    const repository = resolveRepository(root, options.remote);
    outcome = { repository, ...resolveConclusion(repository, sha, options) };
  } catch (err) {
    if (options.override && err instanceof BumpError && err.code === EXIT_UNREADABLE) {
      const summary = `${PREFIX}: no conclusion was readable for ${sha}; adopted on an explicit`
        + ` override: ${options.override}`;
      writeMarker(root, version, { sha, summary, override: options.override });
      return [summary, `${PREFIX}: ${FRAMEWORK_VERSION} -> ${version}`];
    }
    throw err;
  }

  const { repository, runs, failing } = outcome;
  const checks = `${runs.length} check${runs.length === 1 ? '' : 's'}: `
    + runs.map((run) => run.name).join(', ');

  // A conclusion that WAS read and is red is not overridable, and that asymmetry is the
  // contract rather than an oversight: "a red or failing run never bumps" is
  // unconditional, while the override exists for CI that could not be read at all. The
  // two cases differ in what the operator would be asserting. Overriding an unreadable
  // conclusion says "I verified this another way"; overriding a red one says "I know it
  // failed and I am recording it as adopted anyway", which is the exact claim the marker
  // must never carry. The fix for red is to fix the failure.
  if (failing.length > 0) {
    const named = failing
      .map((run) => `${run.name} (${run.conclusion ?? 'no conclusion'})${run.url ? ` -- ${run.url}` : ''}`)
      .join('\n    ');
    throw new BumpError(
      `CI is not green on ${sha} in ${repository}:\n    ${named}\n`
      + `  ${FRAMEWORK_VERSION} is left at ${readMarker(root)},`
      + ' the value captured before the merge.\n'
      + '  fix the failure, push again, and re-run this step against the new head.'
      + (options.override
        ? '\n  --override does NOT apply here: it records an adoption whose CI could not be\n'
          + '  READ, and this one was read. A failing run never bumps.'
        : ''),
      EXIT_NOT_GREEN,
    );
  }

  const summary = `${PREFIX}: CI is green on ${sha} in ${repository} (${checks})`;
  writeMarker(root, version, { sha, summary, override: null });
  return [
    summary,
    `${PREFIX}: ${FRAMEWORK_VERSION} -> ${version}, committed on the verified head`,
  ];
}

/* -- CLI -------------------------------------------------------------------- */

const COMMAND_OPTIONS = {
  bump: { '--repo': 'repo', '--target': 'target', '--remote': 'remote', '--poll-seconds': 'pollSeconds', '--timeout-seconds': 'timeoutSeconds', '--override': 'override' },
};

const USAGE = 'usage: ci-verified-bump.mjs bump --target <tag|vX.Y.Z> [--repo <dir>] [--remote <name>]\n'
  + '                                  [--poll-seconds <n>] [--timeout-seconds <n>] [--override <reason>]\n'
  + '  bump runs AFTER the merged branch has been pushed. It reads the CI conclusion\n'
  + `  GitHub recorded for the exact head SHA and writes ${FRAMEWORK_VERSION} only on a\n`
  + '  green one. Exit 1 = not green, exit 3 = no conclusion readable; both leave the\n'
  + '  marker untouched.';

function parseCount(flag, value) {
  if (!/^\d+$/.test(value)) throw usageError(`${flag} must be a whole number of seconds, got: ${value}`);
  return Number(value);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const accepted = COMMAND_OPTIONS[command];
  if (!accepted) return { command, options: null };
  const options = {
    repo: process.cwd(),
    target: null,
    remote: 'origin',
    pollSeconds: 20,
    timeoutSeconds: 1800,
    override: null,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    const key = accepted[flag];
    if (!key) {
      const known = Object.values(COMMAND_OPTIONS).some((table) => flag in table);
      throw usageError(known
        ? `${flag} is not an option of \`${command}\`.`
        : `unknown argument: ${flag}`);
    }
    if (value === undefined) throw usageError(`${flag} needs a value`);
    if (key === 'pollSeconds' || key === 'timeoutSeconds') options[key] = parseCount(flag, value);
    else options[key] = value;
    i += 1;
  }
  if (options.override !== null && options.override.trim() === '') {
    throw usageError('--override needs a reason: an unrecorded override is the defect this step exists to end');
  }
  if (!options.target) throw usageError(USAGE);
  return { command, options };
}

function main(argv) {
  const { options } = parseArgs(argv);
  if (options === null) throw usageError(USAGE);
  const root = git(options.repo, ['rev-parse', '--show-toplevel']);
  for (const line of bump(root, options)) process.stdout.write(`${line}\n`);
}

// Run only when executed directly. `realpathSync` is load-bearing, exactly as in the
// sibling helpers: `import.meta.url` is the resolved real path while `process.argv[1]`
// keeps the symlinks it was invoked through (a temp directory under `/var` on macOS is
// really `/private/var`), and comparing the two unresolved makes this file a silent
// no-op when it is run from the copy the upgrade extracts out of a release tag --
// which is the documented way to run it.
const entryPoint = (() => {
  if (!process.argv[1]) return null;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return null;
  }
})();
const invokedDirectly = entryPoint !== null && import.meta.url === entryPoint;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof BumpError) {
      process.stderr.write(`${PREFIX}: ${err.message}\n`);
      process.exit(err.code);
    }
    throw err;
  }
}
