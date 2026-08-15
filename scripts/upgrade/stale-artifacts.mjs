#!/usr/bin/env node
//
// stale-artifacts.mjs -- clear the derived artifacts a framework release stranded at a
// path it no longer writes.
//
//   node scripts/upgrade/stale-artifacts.mjs report [--repo <dir>]
//   node scripts/upgrade/stale-artifacts.mjs sweep  [--repo <dir>]
//
// Why this exists: when a derived artifact moves, its `.gitignore` line moves with it.
// An instance that produced the artifact BEFORE the upgrade is then left with an
// untracked copy at the old path that nothing ignores, nothing reads, and nothing
// regenerates. That is worse than clutter on two counts. The corpus artifact carries
// every article's title, URL, and body text, and both machine gates skip it by
// BASENAME -- so at the retired path it is unignored, unreviewed content sitting in a
// code tree. And an untracked file makes `git status --porcelain` non-empty, which is
// exactly what the NEXT upgrade's clean-tree preflight stops on.
//
// What it will NOT do: delete a file it has not identified. A sweep removes a path only
// when the file is untracked AND its bytes really are the artifact the release retired.
// A tracked file at that path is a different defect (`npm run worker-config:check` owns
// it, and committing a corpus is a review blocker, not something to quietly undo), and
// a file whose bytes are something else is somebody's work. Both are reported by path
// and left alone: an upgrade that deletes what it cannot name is a worse failure than
// the one it is fixing.
//
// Exit codes: 0 = the tree was inspected, whatever was found (including nothing);
// 1 = the inspection could not be performed; 2 = usage.
//
// `scripts/upgrade/check-upgrade-state.sh` is the regression gate (case 17).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIX = 'stale-artifacts';
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/**
 * Every path a framework release retired, with what identifies the file that belongs
 * there. `recognize` is what makes a sweep a removal of a KNOWN artifact rather than a
 * deletion of whatever happens to sit at a path.
 *
 * The corpus artifact is the shape `scripts/core/build-embeddings.mjs` writes:
 * `{schema, model, dim, quant, builtAt, count, chunks, vectors}`. This helper runs as a
 * lone file extracted from a release tag, so it cannot import that module; it checks
 * the three fields that make the file unmistakably that artifact and would be absurd in
 * anything else parked at the same name.
 */
export const STALE_ARTIFACTS = [
  {
    path: 'workers/chat/vectors.json',
    movedTo: 'workers/lib/vectors.json',
    retiredIn: 'v1.1.5',
    what: 'the corpus embedding artifact',
    recognize: (bytes) => {
      let value;
      try {
        value = JSON.parse(bytes);
      } catch {
        return false;
      }
      return Boolean(value)
        && typeof value === 'object'
        && Object.hasOwn(value, 'schema')
        && Array.isArray(value.chunks)
        && Array.isArray(value.vectors);
    },
  },
];

class StaleArtifactError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

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
    throw new StaleArtifactError(`git ${args.join(' ')} failed: ${detail}`, EXIT_FAILURE);
  }
}

const isTracked = (root, rel) => Boolean(git(root, ['ls-files', '--', rel]));

/**
 * One disposition per retired path present in the tree:
 *   removable   -- untracked and recognized: a sweep deletes it
 *   tracked     -- committed at that path: reported, never touched
 *   unrecognized-- present but not the artifact: reported, never touched
 */
export function inspect(root) {
  const findings = [];
  for (const artifact of STALE_ARTIFACTS) {
    const absolute = resolve(root, artifact.path);
    if (!existsSync(absolute)) continue;
    if (isTracked(root, artifact.path)) {
      findings.push({ artifact, disposition: 'tracked' });
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(absolute, 'utf8');
    } catch {
      findings.push({ artifact, disposition: 'unrecognized' });
      continue;
    }
    findings.push({
      artifact,
      disposition: artifact.recognize(bytes) ? 'removable' : 'unrecognized',
    });
  }
  return findings;
}

function describe({ artifact, disposition }, removed) {
  const where = `${artifact.path} (${artifact.what}, retired in ${artifact.retiredIn},`
    + ` now written to ${artifact.movedTo})`;
  if (disposition === 'tracked') {
    return `${PREFIX}: TRACKED at a retired path and left alone: ${where}\n`
      + '  a committed derived artifact is a separate defect; `npm run worker-config:check`\n'
      + '  reports it, and removing it from git is a deliberate commit, not an upgrade step.';
  }
  if (disposition === 'unrecognized') {
    return `${PREFIX}: present at a retired path but NOT ${artifact.what}, so it was left alone: ${where}\n`
      + '  nothing reads this path any more; delete it yourself if it is not yours.';
  }
  return removed
    ? `${PREFIX}: removed ${where}`
    : `${PREFIX}: stale and removable, run \`sweep\` to remove it: ${where}`;
}

function run(root, command) {
  const findings = inspect(root);
  if (findings.length === 0) {
    return [`${PREFIX}: no retired artifact path carries a file in this tree.`];
  }
  const lines = [];
  for (const finding of findings) {
    const removing = command === 'sweep' && finding.disposition === 'removable';
    if (removing) unlinkSync(resolve(root, finding.artifact.path));
    lines.push(describe(finding, removing));
  }
  return lines;
}

/* -- CLI -------------------------------------------------------------------- */

const COMMAND_OPTIONS = {
  report: { '--repo': 'repo' },
  sweep: { '--repo': 'repo' },
};

const USAGE = 'usage: stale-artifacts.mjs report [--repo <dir>]\n'
  + '       stale-artifacts.mjs sweep  [--repo <dir>]\n'
  + '  report writes nothing. sweep removes a retired-path file only when it is\n'
  + '  untracked AND its bytes are the artifact that release retired; anything else\n'
  + '  is reported by path and left alone.';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const accepted = COMMAND_OPTIONS[command];
  if (!accepted) return { command, options: null };
  const options = { repo: process.cwd() };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    const key = accepted[flag];
    if (!key) throw new StaleArtifactError(`unknown argument: ${flag}`, EXIT_USAGE);
    if (value === undefined) throw new StaleArtifactError(`${flag} needs a value`, EXIT_USAGE);
    options[key] = value;
    i += 1;
  }
  return { command, options };
}

function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options === null) throw new StaleArtifactError(USAGE, EXIT_USAGE);
  const root = git(options.repo, ['rev-parse', '--show-toplevel']);
  for (const line of run(root, command)) process.stdout.write(`${line}\n`);
}

// Run only when executed directly, for the reason the sibling helpers document:
// `import.meta.url` is the resolved real path while `process.argv[1]` keeps the
// symlinks it was invoked through, so comparing them unresolved makes this file a
// silent no-op when run from the copy the upgrade extracts out of a release tag.
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
    if (err instanceof StaleArtifactError) {
      process.stderr.write(`${PREFIX}: ${err.message}\n`);
      process.exit(err.code);
    }
    throw err;
  }
}
