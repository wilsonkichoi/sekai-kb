#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpAdopterVersion, nextVersion } from './bump-version.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'sekai-release-bump-'));
  writeFileSync(join(root, 'VERSION'), 'v1.2.3\n');
  writeFileSync(join(root, 'FRAMEWORK-VERSION'), 'v4.5.6\n');
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.2.3","private":true}\n');
  writeFileSync(
    join(root, 'package-lock.json'),
    '{"name":"fixture","version":"1.2.3","lockfileVersion":3,"packages":{"":{"name":"fixture","version":"1.2.3"}}}\n',
  );
  return root;
};

assert.equal(nextVersion('v1.2.3', 'patch'), 'v1.2.4');
assert.equal(nextVersion('v1.2.3', 'minor'), 'v1.3.0');
assert.equal(nextVersion('v1.2.3', 'major'), 'v2.0.0');
assert.throws(() => nextVersion('v1.2.3', 'latest'), /patch, minor, or major/);

for (const [level, expected] of [['patch', 'v1.2.4'], ['minor', 'v1.3.0'], ['major', 'v2.0.0']]) {
  const root = fixture();
  const result = bumpAdopterVersion(root, level);
  assert.equal(result.next, expected);
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), `${expected}\n`);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, expected.slice(1));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
  assert.equal(lock.version, expected.slice(1));
  assert.equal(lock.packages[''].version, expected.slice(1));
  assert.equal(readFileSync(join(root, 'FRAMEWORK-VERSION'), 'utf8'), 'v4.5.6\n');
}

const dryRunRoot = fixture();
bumpAdopterVersion(dryRunRoot, 'patch', { dryRun: true });
assert.equal(readFileSync(join(dryRunRoot, 'VERSION'), 'utf8'), 'v1.2.3\n');

const templateRoot = fixture();
writeFileSync(join(templateRoot, '.sekai-template'), 'fixture\n');
assert.throws(() => bumpAdopterVersion(templateRoot, 'patch'), /Sekai framework template/);

const driftRoot = fixture();
writeFileSync(join(driftRoot, 'package.json'), '{"name":"fixture","version":"9.9.9","private":true}\n');
assert.throws(() => bumpAdopterVersion(driftRoot, 'patch'), /package.json.version does not match VERSION/);

console.log('release:bump self-test OK');
