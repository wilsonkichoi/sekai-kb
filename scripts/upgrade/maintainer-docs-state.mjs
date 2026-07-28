#!/usr/bin/env node
//
// maintainer-docs-state.mjs — classify and preserve an instance's maintainer-doc
// state across a framework tag merge (ADR 008 addendum, SPEC "Repo topology").
//
//   node scripts/upgrade/maintainer-docs-state.mjs classify  [--repo <dir>] [--state <file>]
//   node scripts/upgrade/maintainer-docs-state.mjs reconcile [--repo <dir>] [--state <file>]
//   node scripts/upgrade/maintainer-docs-state.mjs paths     [--repo <dir>]
//
// Why this exists: `.gitattributes merge=ours` protects the CONTENT of a path that
// exists on both merge sides. It does not preserve an intentionally ABSENT path.
// The framework's own maintainer documents are removed by `npm run init`, so an
// adopted instance has none of them — git therefore applies no merge driver there
// and re-adds the framework's copies on every tag merge that touched them (a
// modify/delete conflict on shared history, a theirs-only addition on an
// unrelated-history first merge). This is the dev-plugin failure of ADR 006's
// addendum in a second location, and `dev-plugin-state.mjs` is its sibling.
//
// The path set is NEVER hardcoded here. It is derived at runtime from the init
// wizard's exported MAINTAINER_DOCS — the same single source the CI gate
// `scripts/ci/check-framework-docs.mjs` derives from, which imports the parser
// below and asserts both agree. A hardcoded copy in the upgrade path would drift
// from the strip it exists to preserve.
//
// Classification is PER PATH, not whole-set (ADR 008 addendum (a)): these paths
// carry no activation signal and are mutually independent, so an instance may
// legitimately own some and not others. A partial set is a normal state, never a
// stop.
//
//   owned    = present before the merge -> never deleted, asserted unchanged
//   stripped = absent  before the merge -> whatever the merge introduced is removed
//
// `classify` runs in preflight, BEFORE the merge, on a clean working tree, and
// writes its answer into the git directory (never the working tree). `reconcile`
// reads that answer immediately AFTER the merge command, whether the merge stopped
// on conflicts or completed on its own — after the merge the tree no longer shows
// what the instance owned.
//
// Exit codes: 0 = ok, 1 = reconcile failed / postcondition violated,
// 2 = usage error, 3 = the maintainer-doc contract could not be derived.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WIZARD = 'scripts/init/writer.mjs';
const STATE_FILE = 'sekai-maintainer-docs-state.json';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_UNDERIVABLE = 3;

class UpgradeStateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * The init wizard declares the strip list as one array literal:
 *   export const MAINTAINER_DOCS = ['docs/...', ...];
 * Returns null when the literal is absent or empty — never a silent empty list,
 * which would classify every path as absent and delete nothing while reporting
 * success. It lives here, rather than in the CI gate that also needs it, because
 * this helper must run standalone when it is extracted from a release tag into the
 * git directory and so cannot import it; `scripts/ci/check-framework-docs.mjs`
 * imports THIS function, so there is one derivation rather than two.
 */
export function deriveMaintainerDocs(src) {
  const m = /export\s+const\s+MAINTAINER_DOCS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  const docs = m[1]
    .split(',')
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return docs.length > 0 ? docs : null;
}

function git(repo, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  } catch (err) {
    if (allowFailure) return null;
    const detail = (err.stderr ?? '').toString().trim() || err.message;
    throw new UpgradeStateError(`git ${args.join(' ')} failed: ${detail}`, EXIT_FAILURE);
  }
}

function gitLines(repo, args, options) {
  const out = git(repo, args, options);
  if (!out) return [];
  return out.split('\n').filter((line) => line !== '');
}

/**
 * Distinct paths from a `git ls-files` listing. `git ls-files -u` prefixes each
 * line with `<mode> <sha> <stage>\t` and repeats a conflicted path once per stage,
 * so counting raw lines overstates how many paths are involved.
 */
function distinctPaths(lines) {
  return [...new Set(lines.map((line) => (line.includes('\t') ? line.split('\t').pop() : line)))];
}

/** Maintainer-doc paths, derived from the wizard in the given tree. */
function maintainerDocs(repo) {
  const wizard = join(repo, WIZARD);
  if (!existsSync(wizard)) {
    throw new UpgradeStateError(
      [
        `cannot derive the maintainer-doc contract: ${WIZARD} is missing.`,
        '  This helper never hardcodes the path set; it reads the init wizard so the upgrade',
        '  and the adoption strip cannot disagree.',
        '  remedy: run this from an instance repository that carries the framework scripts,',
        '          or pass --repo pointing at one.',
      ].join('\n'),
      EXIT_UNDERIVABLE,
    );
  }
  const docs = deriveMaintainerDocs(readFileSync(wizard, 'utf8'));
  if (!docs) {
    throw new UpgradeStateError(
      [
        `cannot derive the maintainer-doc contract: no MAINTAINER_DOCS array literal in ${WIZARD}.`,
        '  Treating that as an empty set would classify every path as absent, delete nothing,',
        '  and report success — so this stops instead.',
        '  remedy: re-point the derivation in the same commit that moved or renamed the list.',
      ].join('\n'),
      EXIT_UNDERIVABLE,
    );
  }
  return docs;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Where the captured classification lives: inside the git directory, never the working tree. */
function statePath(repo, override) {
  if (override) return resolve(override);
  // `--git-path` answers relative to the repo root in a standard clone but
  // ABSOLUTE in a linked worktree; `resolve` handles both.
  return resolve(repo, git(repo, ['rev-parse', '--git-path', STATE_FILE]));
}

function mergeIsInProgress(repo) {
  // Same absolute-vs-relative `--git-path` case as above: `join` would prefix the
  // repo onto the absolute form, miss the file, and take the already-committed
  // branch mid-merge — where `git commit --amend` refuses.
  return existsSync(resolve(repo, git(repo, ['rev-parse', '--git-path', 'MERGE_HEAD'])));
}

/**
 * The instance commit the merge started from. During an in-progress merge that is
 * still `HEAD`; once the merge auto-committed it is `ORIG_HEAD` (git sets it at
 * merge start).
 */
function preMergeRevision(repo, mergeInProgress) {
  if (mergeInProgress) return 'HEAD';
  const origHead = git(repo, ['rev-parse', '--verify', '--quiet', 'ORIG_HEAD'], {
    allowFailure: true,
  });
  if (!origHead) {
    throw new UpgradeStateError(
      'no merge in progress and no ORIG_HEAD: run reconcile immediately after the merge command.',
      EXIT_FAILURE,
    );
  }
  return 'ORIG_HEAD';
}

/** Working-tree presence, the whole classification for a maintainer-doc path. */
function classify(repo) {
  const paths = maintainerDocs(repo);
  const owned = [];
  const stripped = [];
  for (const rel of paths) {
    if (existsSync(join(repo, rel))) owned.push(rel);
    else stripped.push(rel);
  }
  return { owned, stripped };
}

function writeState(repo, override) {
  const state = classify(repo);
  const file = statePath(repo, override);
  writeFileSync(file, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
  return { ...state, file };
}

function readState(repo, override) {
  const file = statePath(repo, override);
  if (!existsSync(file)) {
    throw new UpgradeStateError(
      [
        `no captured maintainer-doc state at ${file}.`,
        '  reconcile consumes the answer `classify` recorded BEFORE the merge; after the merge',
        '  the tree no longer shows what the instance owned.',
        '  remedy: abort the merge, run `classify`, then merge and re-run `reconcile`.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }
  const state = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(state.owned) || !Array.isArray(state.stripped)) {
    throw new UpgradeStateError(`captured maintainer-doc state at ${file} is malformed`, EXIT_FAILURE);
  }
  return { ...state, file };
}

/** Did this path exist in the pre-merge tree? Answers for a file or a directory. */
function existedAt(repo, rev, rel) {
  return gitLines(repo, ['ls-tree', '-r', '--name-only', rev, '--', rel]).length > 0;
}

function reconcile(repo, override) {
  const notes = [];
  const failures = [];
  const captured = readState(repo, override);
  const mergeInProgress = mergeIsInProgress(repo);
  const rev = preMergeRevision(repo, mergeInProgress);

  // Re-derive from the MERGED tree: a path the incoming release newly declares
  // maintainer-owned is handled on the upgrade that introduces it, rather than one
  // release later. Anything the capture did not classify is decided from the
  // pre-merge revision directly.
  const declared = maintainerDocs(repo);
  const all = [...new Set([...captured.owned, ...captured.stripped, ...declared])].sort();

  let staged = false;
  const removed = [];
  const kept = [];
  const added = [];

  for (const rel of all) {
    const owned = captured.owned.includes(rel)
      || (!captured.stripped.includes(rel) && existedAt(repo, rev, rel));

    if (!owned) {
      const tracked = distinctPaths(gitLines(repo, ['ls-files', '--', rel]));
      const unmerged = distinctPaths(gitLines(repo, ['ls-files', '-u', '--', rel]));
      if (tracked.length > 0 || unmerged.length > 0) {
        // Resolves both shapes in one step: the modify/delete conflict on shared
        // history and the clean theirs-only addition on an unrelated-history merge.
        git(repo, ['rm', '-r', '-f', '-q', '--ignore-unmatch', '--', rel]);
        staged = true;
        removed.push(`${rel} (${tracked.length} path(s), ${unmerged.length} conflicted)`);
      }
      const abs = join(repo, rel);
      if (isDirectory(abs)) {
        rmSync(abs, { recursive: true, force: true });
        removed.push(`${rel} (untracked leftovers)`);
      } else if (existsSync(abs)) {
        rmSync(abs, { force: true });
        removed.push(`${rel} (untracked leftover file)`);
      }
      continue;
    }

    // Owned: `merge=ours` must have kept it byte-for-byte. A conflict or any
    // non-addition change means the attribute or the driver is missing — the
    // framework's copy must never win over a document the instance wrote.
    const unmerged = distinctPaths(gitLines(repo, ['ls-files', '-u', '--', rel]));
    if (unmerged.length > 0) {
      failures.push(`${rel} conflicted: ${unmerged.join(', ')}`);
      continue;
    }
    for (const line of gitLines(repo, ['diff', '--name-status', rev, '--', rel])) {
      const [status, ...pathParts] = line.split('\t');
      const path = pathParts.join('\t');
      if (status.startsWith('A')) added.push(path);
      else failures.push(`${path} changed (${status}) against the pre-merge tree`);
    }
    kept.push(rel);
  }

  if (failures.length > 0) {
    throw new UpgradeStateError(
      [
        'maintainer-doc state was not preserved:',
        ...failures.map((f) => `  - ${f}`),
        '  These paths hold documents this instance owns, so the merge must not have touched',
        '  them. Either `.gitattributes` does not mark them `merge=ours`, or the `ours` driver',
        '  is not configured in this clone (it is per-clone and not version-controlled).',
        '  remedy: `git merge --abort`, add the paths to `.gitattributes` as `merge=ours`, run',
        '          `git config merge.ours.driver true`, then re-run the upgrade.',
      ].join('\n'),
      EXIT_FAILURE,
    );
  }

  // The merge already committed (nothing conflicted to stop it), so the framework
  // copies are in the merge commit. Amend it — both parents are preserved, and the
  // finalized merge never carries maintainer docs the instance does not own.
  if (!mergeInProgress && staged) {
    git(repo, ['commit', '--amend', '--no-edit', '--quiet']);
    notes.push('amended the merge commit so no framework maintainer doc is committed');
  }

  const postconditions = [];
  for (const rel of all) {
    if (captured.owned.includes(rel)) continue;
    if (kept.includes(rel)) continue;
    if (gitLines(repo, ['ls-files', '--', rel]).length > 0) postconditions.push(`${rel} is still tracked in the index`);
    if (gitLines(repo, ['ls-files', '-u', '--', rel]).length > 0) postconditions.push(`${rel} still has unmerged entries`);
    if (existsSync(join(repo, rel))) postconditions.push(`${rel} still exists in the working tree`);
    if (!mergeInProgress && gitLines(repo, ['ls-tree', '-r', '--name-only', 'HEAD', '--', rel]).length > 0) {
      postconditions.push(`${rel} is committed in ${git(repo, ['rev-parse', '--short', 'HEAD'])}`);
    }
  }
  if (postconditions.length > 0) {
    throw new UpgradeStateError(
      ['stripped maintainer-doc state was not preserved:', ...postconditions.map((f) => `  - ${f}`)].join('\n'),
      EXIT_FAILURE,
    );
  }

  if (removed.length > 0) {
    notes.push(`removed framework maintainer docs this instance does not own: ${removed.join(', ')}`);
  }
  if (kept.length > 0) {
    notes.push(`instance-owned and unchanged against ${rev}: ${kept.join(', ')}`);
  }
  if (added.length > 0) {
    notes.push(
      `the merge ADDED ${added.length} framework file(s) under paths you own: ${added.join(', ')}.`,
      'These are framework-development documents, not your content — decide per file: keep it, or',
      `\`git rm -f -- <path>\`${
        mergeInProgress ? ' before finalizing the merge' : ' followed by `git commit --amend --no-edit`'
      }. The upgrade does not decide for you.`,
    );
  }
  if (notes.length === 0) notes.push('nothing to reconcile: the merge carried no maintainer-doc change');

  unlinkSync(captured.file);
  return notes;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { repo: process.cwd(), state: null };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--repo' || flag === '--state') {
      if (value === undefined) throw new UpgradeStateError(`${flag} needs a value`, EXIT_USAGE);
      options[flag === '--repo' ? 'repo' : 'state'] = value;
      i += 1;
    } else {
      throw new UpgradeStateError(`unknown argument: ${flag}`, EXIT_USAGE);
    }
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  const repoRoot = git(options.repo, ['rev-parse', '--show-toplevel']);

  if (command === 'paths') {
    for (const rel of maintainerDocs(repoRoot)) process.stdout.write(`${rel}\n`);
    return;
  }

  if (command === 'classify') {
    const state = writeState(repoRoot, options.state);
    process.stdout.write(`maintainer-docs-state: owned: ${state.owned.join(', ') || 'none'}\n`);
    process.stdout.write(`maintainer-docs-state: stripped: ${state.stripped.join(', ') || 'none'}\n`);
    process.stdout.write(`maintainer-docs-state: recorded ${state.file}\n`);
    return;
  }

  if (command === 'reconcile') {
    for (const note of reconcile(repoRoot, options.state)) {
      process.stdout.write(`maintainer-docs-state: ${note}\n`);
    }
    process.stdout.write('maintainer-docs-state: maintainer-doc state preserved\n');
    return;
  }

  throw new UpgradeStateError(
    'usage: maintainer-docs-state.mjs classify  [--repo <dir>] [--state <file>]\n' +
      '       maintainer-docs-state.mjs reconcile [--repo <dir>] [--state <file>]\n' +
      '       maintainer-docs-state.mjs paths     [--repo <dir>]',
    EXIT_USAGE,
  );
}

// Run only when executed directly: `check-framework-docs.mjs` imports the parser
// above so there is one derivation, not two. `realpathSync` is load-bearing —
// `import.meta.url` is the resolved real path, while `process.argv[1]` keeps the
// symlinks it was invoked through (a temp directory under `/var` on macOS is
// really `/private/var`), and comparing the two unresolved makes this file a
// silent no-op when it is run from an extracted copy.
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
    if (err instanceof UpgradeStateError) {
      process.stderr.write(`maintainer-docs-state: ${err.message}\n`);
      process.exit(err.code);
    }
    throw err;
  }
}
