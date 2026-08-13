#!/usr/bin/env node
// corpus-workers.mjs -- which workers a corpus rebuild obliges you to redeploy.
//
// The corpus artifact is bundled into a Worker at `wrangler deploy` time, so a rebuilt
// artifact reaches production only through a redeploy of every worker that imports it.
// One worker skipped keeps answering out of the older index, which is the exact defect
// the CI refresh exists to remove -- so the list is DERIVED from the source tree here
// rather than written down, and a third consumer added later is picked up with no edit
// to this file and no edit to the workflow.
//
// The derivation is three steps, each one regex over a file that already exists:
//
//   1. The artifact path comes from `OUTPUT_PATH` in scripts/core/build-embeddings.mjs,
//      which is exported for exactly this class of use.
//   2. The module that imports it is whichever file under workers/lib/ carries an
//      import of that artifact (today: vectors.mjs, the single loader).
//   3. A worker bundles the artifact when its import graph, starting at
//      workers/<dir>/src/ and following relative imports wherever they lead, reaches
//      that module. The walk is transitive because bundling is: wrangler pulls in the
//      whole graph, so a worker that reaches the loader through an intermediate module
//      carries the artifact just as surely as one importing it directly. A
//      direct-imports-only rule would silently drop such a worker from the redeploy
//      list, which is the same stale-corpus defect this job exists to remove.
//
// Deploy targets are the bundling workers this instance has actually deployed: the
// capability's `features` flag is on AND its `workers` endpoint is non-empty, the same
// pair every worker-backed capability requires (place.config.ts). Both conditions are
// absent-safe -- a config written before a flag existed reads as off -- so a
// half-configured instance deploys nothing rather than publishing a worker whose
// database, secrets, and route were never set up.
//
// Usage: node scripts/deploy/corpus-workers.mjs [--root <dir>] [--all]
//        --all lists the bundling workers without the enabled filter.
//
// Prints one worker directory name per line, and exits 0 on an empty list: "no worker
// needs redeploying" is a valid answer, not an error.
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { OUTPUT_PATH } from '../core/build-embeddings.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The shared retrieval tree. Not a worker: it has no wrangler config of its own. */
const LIB_DIR = 'workers/lib';

/** Everything under a worker directory that wrangler bundles from. */
const SOURCE_DIR = 'src';

const ARTIFACT_BASENAME = basename(OUTPUT_PATH);

/**
 * Every module specifier a file pulls in, across all three forms a bundler follows:
 * a static import, a re-export, and a dynamic import. The re-export form is not
 * hypothetical here -- `workers/chat/src/models.mjs` reaches the shared retrieval code
 * through `export { EMBED_MODEL } from '../../lib/corpus.mjs'` -- and a scanner that
 * missed it would drop a worker from the redeploy list while its bundle carried the
 * corpus, which is the stale-index defect this job exists to remove.
 */
function moduleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * A relative specifier as a path on disk: the specifier itself, else `<path>.mjs`, else
 * `<path>/index.mjs`. When none of the three is a file it returns the bare path, which
 * the caller's own existence check then rejects.
 *
 * Everything in `workers/` writes explicit `.mjs` specifiers, which is what the deployed
 * bundler needs; the two fallbacks cost a stat each and mean an extension-less or
 * directory specifier added later is followed rather than silently ending the walk.
 */
function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.mjs`, join(base, 'index.mjs')]) {
    // isFile, not exists: a directory specifier's own path exists, and accepting it
    // would return the directory and never try the index.mjs inside it.
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base; // reported as unresolved by the caller's existence check
}

function listFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(abs));
    else if (entry.isFile()) files.push(abs);
  }
  return files;
}

/** Step 2, as an absolute path: the shared module that imports the corpus artifact. */
function artifactLoaderPath(root) {
  const libDir = join(root, LIB_DIR);
  for (const file of listFiles(libDir).sort()) {
    if (!/\.mjs$/.test(file)) continue;
    const specifiers = moduleSpecifiers(readFileSync(file, 'utf8'));
    if (specifiers.some((s) => basename(s) === ARTIFACT_BASENAME)) return file;
  }
  return null;
}

/**
 * Step 2: the module under workers/lib/ that imports the corpus artifact.
 *
 * @returns {string | null} its basename (e.g. "vectors.mjs"), or null when no module
 *   imports the artifact -- which means nothing bundles it and there is nothing to
 *   redeploy.
 */
export function artifactLoaderModule(root = DEFAULT_ROOT) {
  const found = artifactLoaderPath(root);
  return found ? basename(found) : null;
}

/**
 * Does this worker's import graph reach `target`?
 *
 * Relative specifiers only: a bare specifier is a package, and no package in this
 * repository re-exports the corpus artifact. Files outside workers/ are not followed,
 * so a stray `../../../` cannot walk the whole repository.
 */
function graphReaches(entryFiles, target, workersDir) {
  const queue = entryFiles.filter((file) => /\.mjs$/.test(file));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === target) return true;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // a specifier that resolves to nothing on disk is not a bundled module
    }
    for (const specifier of moduleSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === target) return true;
      if (!resolved.startsWith(`${workersDir}${sep}`)) continue;
      if (!/\.mjs$/.test(resolved) || seen.has(resolved) || !existsSync(resolved)) continue;
      seen.add(resolved);
      queue.push(resolved);
    }
  }
  return false;
}

/**
 * Step 3: the worker directories whose bundle carries the corpus artifact.
 *
 * @returns {string[]} directory names under workers/, sorted.
 */
export function bundlingWorkers(root = DEFAULT_ROOT) {
  const target = artifactLoaderPath(root);
  if (!target) return [];

  const workersDir = join(root, 'workers');
  if (!existsSync(workersDir)) return [];

  const found = [];
  for (const entry of readdirSync(workersDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === basename(LIB_DIR)) continue;
    const entryFiles = listFiles(join(workersDir, entry.name, SOURCE_DIR));
    if (graphReaches(entryFiles, target, workersDir)) found.push(entry.name);
  }
  return found.sort();
}

/**
 * The bundling workers this instance has deployed, and therefore must redeploy.
 *
 * A worker directory name is also its `features` flag and its `workers` endpoint key;
 * that is the framework's naming rule for every worker-backed capability, and the
 * generated wrangler config derives the deployed script name from the same directory.
 *
 * @param {object} place the imported place.config.ts default export
 * @returns {string[]} directory names under workers/, sorted.
 */
export function deployTargets(root = DEFAULT_ROOT, place = {}) {
  return bundlingWorkers(root).filter((dir) => {
    const enabled = place?.features?.[dir] === true;
    const endpoint = place?.workers?.[dir];
    return enabled && typeof endpoint === 'string' && endpoint.trim() !== '';
  });
}

/* -- CLI ------------------------------------------------------------------- */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let root = DEFAULT_ROOT;
  let all = false;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      root = argv[i + 1];
      i += 1;
      if (!root) {
        console.error('FAIL: --root needs a directory');
        process.exit(1);
      }
    } else if (argv[i] === '--all') {
      all = true;
    } else {
      console.error(`FAIL: unknown argument "${argv[i]}"`);
      process.exit(1);
    }
  }

  let targets;
  if (all) {
    targets = bundlingWorkers(root);
  } else {
    const configPath = join(root, 'place.config.ts');
    if (!existsSync(configPath)) {
      console.error(`FAIL: place.config.ts not found at ${configPath}.`);
      process.exit(1);
    }
    let place;
    try {
      place = (await import(pathToFileURL(configPath).href)).default;
    } catch (err) {
      console.error(
        `FAIL: place.config.ts could not be imported (${err.message}).\n` +
          '  Run this through `npm run corpus-workers`, which passes the type-stripping flag Node needs.',
      );
      process.exit(1);
    }
    targets = deployTargets(root, place);
  }

  for (const target of targets) console.log(target);
  process.exit(0);
}
