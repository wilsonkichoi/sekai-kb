#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_RE = /^v\d+\.\d+\.\d+$/;

const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const gitPath = (root, name) => {
  const path = git(root, ['rev-parse', '--git-path', name]).trim();
  return resolve(root, path);
};

const validateAdopter = (root) => {
  if (existsSync(resolve(root, '.sekai-template'))) {
    throw new Error('package-state is an adopter upgrade helper, not a framework release tool');
  }
  const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
  if (!VERSION_RE.test(version)) throw new Error('VERSION is not a v-prefixed semantic version');
  const pkg = readJson(resolve(root, 'package.json'));
  const lock = readJson(resolve(root, 'package-lock.json'));
  const npmVersion = version.slice(1);
  const legacyVersionless = pkg.version === undefined
    && lock.version === undefined
    && lock.packages?.['']?.version === undefined;
  if (!legacyVersionless && pkg.version !== npmVersion) {
    throw new Error('package.json.version does not match VERSION');
  }
  if (!legacyVersionless && (lock.version !== npmVersion || lock.packages?.['']?.version !== npmVersion)) {
    throw new Error('package-lock.json root versions do not match VERSION');
  }
  return { version, pkg, lock };
};

export const capturePackageState = (root, output = gitPath(root, 'sekai-package-state.json')) => {
  const base = resolve(root);
  const { version, pkg } = validateAdopter(base);
  const state = {
    name: pkg.name,
    description: pkg.description,
    private: pkg.private,
    version,
  };
  writeFileSync(output, `${JSON.stringify(state, null, 2)}\n`);
  return output;
};

const incomingRef = (root) => {
  try {
    return git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).trim();
  } catch {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length < 3) throw new Error('no framework merge is in progress and HEAD is not a merge commit');
    return 'HEAD^2';
  }
};

const readIncomingJson = (root, ref, path) => JSON.parse(git(root, ['show', `${ref}:${path}`]));

const writeJsonAtomic = (path, value) => {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

export const reconcilePackageState = (root, statePath = gitPath(root, 'sekai-package-state.json')) => {
  const base = resolve(root);
  if (!existsSync(statePath)) throw new Error(`captured package state is missing: ${statePath}`);
  const state = readJson(statePath);
  if (!VERSION_RE.test(state.version)) throw new Error('captured VERSION is invalid');

  const ref = incomingRef(base);
  const pkg = readIncomingJson(base, ref, 'package.json');
  const lock = readIncomingJson(base, ref, 'package-lock.json');
  const npmVersion = state.version.slice(1);

  pkg.name = state.name;
  pkg.version = npmVersion;
  pkg.private = state.private;
  if (state.description === undefined) delete pkg.description;
  else pkg.description = state.description;
  lock.name = state.name;
  lock.version = npmVersion;
  lock.packages[''].name = state.name;
  lock.packages[''].version = npmVersion;

  writeJsonAtomic(resolve(base, 'package.json'), pkg);
  writeJsonAtomic(resolve(base, 'package-lock.json'), lock);
  git(base, ['add', '--', 'package.json', 'package-lock.json']);

  let mergeInProgress = true;
  try {
    git(base, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  } catch {
    mergeInProgress = false;
  }
  if (!mergeInProgress) git(base, ['commit', '--amend', '--no-edit'], { stdio: 'ignore' });
  unlinkSync(statePath);
  return { name: state.name, version: state.version, amended: !mergeInProgress };
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'capture' && args.length <= 1) {
      console.log(capturePackageState(process.cwd(), args[0]));
    } else if (command === 'reconcile' && args.length <= 1) {
      const result = reconcilePackageState(process.cwd(), args[0]);
      console.log(`package-state: restored ${result.name} ${result.version}${result.amended ? ' and amended the merge commit' : ''}`);
    } else {
      console.error('usage: node scripts/upgrade/package-state.mjs <capture|reconcile> [state-file]');
      process.exit(2);
    }
  } catch (error) {
    console.error(`package-state FAILED: ${error.message}`);
    process.exit(1);
  }
}
