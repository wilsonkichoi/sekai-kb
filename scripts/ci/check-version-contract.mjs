#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`version-contract FAILED: ${message}`);
  process.exit(1);
};

const readVersion = (path) => {
  if (!existsSync(path)) fail(`${path} is missing`);
  const value = readFileSync(path, 'utf8').trim();
  if (!/^v\d+\.\d+\.\d+$/.test(value)) {
    fail(`${path} must contain one v-prefixed semantic version, got ${JSON.stringify(value)}`);
  }
  return value;
};

const frameworkVersion = readVersion('FRAMEWORK-VERSION');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const isTemplate = existsSync('.sekai-template');
const releaseVersion = isTemplate ? frameworkVersion : readVersion('VERSION');
const npmVersion = releaseVersion.slice(1);

if (pkg.private !== true) fail('package.json must set "private": true');
if (isTemplate && existsSync('VERSION')) {
  fail('VERSION must not exist in the framework template; use FRAMEWORK-VERSION');
}
if (pkg.version !== npmVersion) {
  fail(`package.json.version must match ${isTemplate ? 'FRAMEWORK-VERSION' : 'VERSION'} without the leading v`);
}
if (lock.version !== npmVersion || lock.packages?.['']?.version !== npmVersion) {
  fail('package-lock.json root versions must match package.json.version');
}
if (lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) {
  fail('package.json and package-lock.json root package names must match');
}

if (isTemplate && process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `sekai-kb-${frameworkVersion}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    fail(`framework tag must match FRAMEWORK-VERSION: expected ${expectedTag}, got ${process.env.GITHUB_REF_NAME}`);
  }
}

console.log(
  `OK: ${isTemplate ? 'framework' : 'adopter'} package ${pkg.name} ${pkg.version}; FRAMEWORK-VERSION ${frameworkVersion}`,
);
