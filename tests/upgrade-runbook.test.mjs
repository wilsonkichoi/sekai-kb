import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path, encoding = 'utf8') =>
  readFileSync(new URL(`../${path}`, import.meta.url), encoding);

const upgrade = read('docs/runbook/UPGRADE.md');
const agents = read('AGENTS.md');

function assertNear(text, marker, expected, label) {
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, `${label} must name ${marker}`);
  const neighborhood = text.slice(Math.max(0, at - 600), at + marker.length + 600);
  assert.match(neighborhood, expected, `${label} must associate ${marker} with ${expected}`);
}

test('the adopter runbook covers release discovery and upgrade-note reading', () => {
  assert.match(upgrade, /watch/i, 'release discovery must explain which releases to watch');
  assert.match(upgrade, /CHANGELOG\.md/, 'release discovery must name CHANGELOG.md');
  assert.match(upgrade, /git tag -l 'sekai-kb-v\*' \| sort -V/);
  assert.match(upgrade, /git show "\$TARGET":CHANGELOG\.md/);
  assert.match(upgrade, /Upgrade note/);
});

test('the documented changelog extractor accepts dated release headings', () => {
  const changelog = [
    '## [1.2.3] — 2026-08-12',
    '',
    '### Upgrade note',
    '',
    'Enable `features.example` after deployment.',
    '',
    '## [1.2.2] — 2026-08-11',
  ].join('\n');
  const script = "index($0,h)==1{p=1} p&&index($0,h)!=1&&/^## \\[/{exit} p";
  const output = execFileSync('awk', ['-v', 'h=## [1.2.3]', script], {
    encoding: 'utf8',
    input: changelog,
  });

  assert.match(output, /^## \[1\.2\.3\] — 2026-08-12/m);
  assert.match(output, /Enable `features\.example` after deployment\./);
  assert.doesNotMatch(output, /1\.2\.2/);
});

test('the adopter runbook covers the AI and non-AI upgrade paths with literal commands', () => {
  assert.match(upgrade, /\/sekai-upgrade sekai-kb-vX\.Y\.Z/);
  assert.match(upgrade, /git fetch framework --tags/);
  assert.match(upgrade, /git merge --no-ff "\$TARGET"/);
  assert.match(upgrade, /npm run build/);
});

test('the adopter runbook covers conflict reporting and resolution', () => {
  assert.match(upgrade, /node "\$DIVERGENCE_HELPER" report --target "\$TARGET"/);
  assert.match(upgrade, /git diff --name-only --diff-filter=U/);
  assert.match(upgrade, /git diff ":2:<file>" ":3:<file>"/);
});

test('the adopter runbook explains absent-safe feature opt-in', () => {
  assert.match(upgrade, /absent-safe/i);
  assert.match(upgrade, /place\.config\.ts/);
  assert.match(
    upgrade,
    /(?:(?:missing|absent|omit(?:ted)?|skip(?:ped|ping)?)[\s\S]{0,180}(?:off|disabled)|(?:off|disabled)[\s\S]{0,180}(?:missing|absent|omit(?:ted)?|skip(?:ped|ping)?))/i,
    'the runbook must state that skipping a new key leaves its feature off',
  );
});

test('the adopter runbook gates the FRAMEWORK-VERSION bump on CI and verifies it', () => {
  assert.match(
    upgrade,
    /node "\$BUMP_HELPER" bump --target "\$TARGET"/,
    'the bump must go through the CI-verified helper, which reads the conclusion first',
  );
  assert.match(
    upgrade,
    /git show "\$TARGET":scripts\/upgrade\/ci-verified-bump\.mjs > "\$BUMP_HELPER"/,
    'the bump helper is bootstrapped from the target tag like every other upgrade helper',
  );
  assert.doesNotMatch(
    upgrade,
    /(?:>|>>)\s*FRAMEWORK-VERSION\b/,
    'a raw redirect into the marker is the retired form: it records an adoption nothing verified',
  );
  assert.match(
    upgrade,
    /test "\$\(cat FRAMEWORK-VERSION\)" = "\$TARGET_VERSION"/,
    'the runbook must assert the recorded version instead of assuming the write succeeded',
  );
});

test('the worked upgrades associate LB-74 and LB-87 with their added flags', () => {
  assertNear(upgrade, 'LB-74', /features\.feedback/, 'the Phase 6 worked example');
  assertNear(upgrade, 'LB-74', /features\.soundscape/, 'the Phase 6 worked example');
  assertNear(upgrade, 'LB-87', /features\.chat/, 'the Phase 7 worked example');
  assertNear(upgrade, 'LB-87', /features\.og/, 'the Phase 7 worked example');
});

test('AGENTS.md states the absent-safe schema rule for existing instances', () => {
  assert.match(agents, /absent-safe/i);
  assert.match(
    agents,
    /(?:missing[\s\S]{0,160}(?:off|disabled)|(?:off|disabled)[\s\S]{0,160}missing)/i,
    'AGENTS.md must define the missing-key behavior',
  );
  assert.match(
    agents,
    /framework upgrades\s+never require\s+config surgery/i,
    'AGENTS.md must state the no-config-surgery rule exactly',
  );
});

test('CLAUDE.md remains the byte-exact one-line AGENTS.md shim', () => {
  assert.deepEqual(read('CLAUDE.md', null), Buffer.from('@AGENTS.md\n'));
});
