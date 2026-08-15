#!/usr/bin/env node
// check-upgrade-sequence-docs.mjs -- the upgrade-sequence documentation gate.
//
// Three documents describe what an upgrade does: the skill that performs it
// (.agents/skills/sekai-upgrade/SKILL.md), the engineering spec that summarizes it
// (dev_docs/SPEC.md), and the runbook that hand-drives it (docs/runbook/UPGRADE.md).
// One of them is the source: the skill. This guard DERIVES the sequence from the
// skill's own declaration and fails when either other document describes a different
// upgrade, or when the skill's declaration no longer matches the steps below it.
//
// It exists because prose about this particular sequence has already been believed
// over the code once. The spec said the skill "build-verifies" and the skill wrote the
// version marker in the same breath, so no CI run existed at bump time by
// construction -- and one real adoption recorded a framework version whose merged tree
// was red for hours. This repository is a template, so a stale statement propagates to
// every adopter on the next tag merge (.agent-toolkit/rules/guard-or-explain-prose-drift.md).
//
// Failure modes, all exit 1:
//   - the skill carries no `## The verified sequence` declaration, or it is empty;
//   - a declared stage does not appear in the skill's own body below the declaration
//     (the declaration would be describing an upgrade the skill does not perform);
//   - the stages appear in the skill body in a different order than declared;
//   - dev_docs/SPEC.md does not carry the declared sequence verbatim;
//   - docs/runbook/UPGRADE.md does not name every declared stage;
//   - either adopter-facing document writes FRAMEWORK-VERSION with a raw shell
//     redirect, which is how the bump used to escape verification;
//   - either adopter-facing document fails to invoke the CI-verified bump helper, or
//     invokes it before pushing the merged branch.
//
// Success prints one summary line and exits 0.
//
// Usage:
//   node scripts/ci/check-upgrade-sequence-docs.mjs             the gate
//   node scripts/ci/check-upgrade-sequence-docs.mjs --selftest  non-vacuity proof
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const SKILL = '.agents/skills/sekai-upgrade/SKILL.md';
const SPEC = 'dev_docs/SPEC.md';
const RUNBOOK = 'docs/runbook/UPGRADE.md';

/** The helper the bump must go through, and the push that must precede it. */
const BUMP_HELPER = 'scripts/upgrade/ci-verified-bump.mjs';
const PUSH = /git push /;

/**
 * A raw shell redirect into the marker. This is the retired form: it writes the
 * adoption without reading any conclusion, which is the whole defect. `test "$(cat
 * FRAMEWORK-VERSION)" = ...` read-backs are fine and deliberately not matched here.
 */
const RAW_MARKER_WRITE = /(?:>|>>)\s*FRAMEWORK-VERSION\b/;

const DECLARATION = /##\s*The verified sequence\s*\n+```text\n([\s\S]*?)\n```/;

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The spec is a framework maintainer document, and adoption removes the whole
 * `dev_docs/` tree (ADR 008/009). The two adopter-facing documents are always
 * checked; the spec assertion is required where this repository authors that text --
 * template mode -- and reported as skipped in an adopted instance, the same scope rule
 * `check-scan-root-docs.mjs` and the schema-docs gates apply.
 */
const TEMPLATE_MODE = existsSync(join(ROOT, '.sekai-template'));
const readOptional = (rel) => (existsSync(join(ROOT, rel)) ? read(rel) : null);

const failures = [];
const skippedNotes = [];
const failure = (message) => failures.push(message);

/** The declared stages, plus where the declaration ends in the skill source. */
export function parseDeclaration(skill) {
  const match = DECLARATION.exec(skill);
  if (!match) return null;
  const stages = match[1]
    .replace(/\n/g, ' ')
    .split('→')
    .map((stage) => stage.trim())
    .filter(Boolean);
  return { stages, sequence: stages.join(' → '), endsAt: match.index + match[0].length };
}

/**
 * Every declared stage must appear in the skill's own body BELOW the declaration, in
 * the declared order. Without this the declaration is just another statement that can
 * drift -- it would keep the spec and the runbook in step with a summary that no
 * longer matches the steps it summarizes.
 */
function checkSkillBody(skill, { stages, endsAt }) {
  const body = skill.slice(endsAt).toLowerCase();
  let previous = -1;
  let previousStage = null;
  for (const stage of stages) {
    const at = body.indexOf(stage.toLowerCase());
    if (at === -1) {
      failure(`${SKILL}: the declared stage "${stage}" does not appear in the steps below the declaration`);
      continue;
    }
    if (at < previous) {
      failure(
        `${SKILL}: "${stage}" appears before "${previousStage}" in the steps, `
        + 'but the declaration puts it after',
      );
    }
    previous = at;
    previousStage = stage;
  }
}

function checkAdopterDocument(rel, source, stages) {
  for (const stage of stages) {
    if (!source.toLowerCase().includes(stage.toLowerCase())) {
      failure(`${rel}: does not name the "${stage}" stage the skill performs`);
    }
  }
  if (RAW_MARKER_WRITE.test(source)) {
    failure(
      `${rel}: writes FRAMEWORK-VERSION with a raw redirect. The marker records an `
      + `adoption, so it moves only through ${BUMP_HELPER}, which reads the CI conclusion first`,
    );
  }
  const bumpAt = source.indexOf(BUMP_HELPER);
  if (bumpAt === -1) {
    failure(`${rel}: never invokes ${BUMP_HELPER}, so nothing there gates the bump on CI`);
    return;
  }
  const pushMatch = PUSH.exec(source);
  if (!pushMatch) {
    failure(`${rel}: never pushes the merged branch, so the CI run the bump reads cannot exist`);
    return;
  }
  if (pushMatch.index > bumpAt) {
    failure(`${rel}: invokes ${BUMP_HELPER} before pushing the merged branch`);
  }
}

export function check({ skill, spec, runbook }) {
  failures.length = 0;
  skippedNotes.length = 0;
  const declaration = parseDeclaration(skill);
  if (!declaration || declaration.stages.length === 0) {
    failure(`${SKILL}: carries no \`## The verified sequence\` declaration to derive from`);
    return { failures: [...failures], stages: [] };
  }
  checkSkillBody(skill, declaration);
  if (spec === null) {
    if (TEMPLATE_MODE) {
      failure(`${SPEC}: missing in a template checkout, where the framework authors it`);
    }
    skippedNotes.push(`${SPEC} (adopted instance: adoption removes the maintainer docs)`);
  } else if (!spec.includes(declaration.sequence)) {
    failure(
      `${SPEC}: does not carry the sequence the skill declares. Expected verbatim:\n`
      + `    ${declaration.sequence}`,
    );
  }
  checkAdopterDocument(RUNBOOK, runbook, declaration.stages);
  checkAdopterDocument(SKILL, skill, declaration.stages);
  return { failures: [...failures], stages: declaration.stages, skipped: [...skippedNotes] };
}

/* -- Non-vacuity: every failure mode above must be reachable ---------------- */

const SELFTEST_DEFECTS = [
  {
    label: 'the declaration is gone from the skill',
    mutate: (docs) => ({ ...docs, skill: docs.skill.replace('## The verified sequence', '## Something else') }),
  },
  {
    label: 'a declared stage is missing from the skill body',
    mutate: (docs) => ({
      ...docs,
      skill: docs.skill.replace(
        /## 3d\. Sweep retired artifact paths[\s\S]*?(?=\n## 4\.)/,
        '## 3d. Removed step\n\n',
      ),
    }),
  },
  {
    label: 'the spec states a different sequence',
    // Only plantable where the spec exists. An adopted instance has no `dev_docs/`,
    // and a defect that cannot be planted there must be skipped rather than reported
    // as undetected -- this selftest ships to adopters in the same workflow.
    requiresSpec: true,
    mutate: (docs) => ({ ...docs, spec: docs.spec.replace(/ → bump FRAMEWORK-VERSION/, '') }),
  },
  {
    label: 'the runbook drops a stage',
    mutate: (docs) => ({
      ...docs,
      runbook: docs.runbook.replaceAll(/sweep retired artifact paths/gi, 'do something else'),
    }),
  },
  {
    label: 'the runbook writes the marker with a raw redirect',
    mutate: (docs) => ({
      ...docs,
      runbook: `${docs.runbook}\n\`\`\`bash\nprintf 'v9.9.9\\n' > FRAMEWORK-VERSION\n\`\`\`\n`,
    }),
  },
  {
    label: 'the runbook stops invoking the CI-verified bump helper',
    mutate: (docs) => ({ ...docs, runbook: docs.runbook.replaceAll(BUMP_HELPER, 'scripts/upgrade/gone.mjs') }),
  },
];

function selftest(docs) {
  const clean = check(docs);
  if (clean.failures.length > 0) {
    process.stderr.write(
      'upgrade-sequence selftest FAILED: the real documents do not pass, so no planted '
      + `defect proves anything:\n  ${clean.failures.join('\n  ')}\n`,
    );
    return 1;
  }
  let status = 0;
  let planted = 0;
  for (const defect of SELFTEST_DEFECTS) {
    if (defect.requiresSpec && docs.spec === null) {
      process.stdout.write(`  skipped (no ${SPEC} in this checkout): ${defect.label}\n`);
      continue;
    }
    planted += 1;
    const { failures: caught } = check(defect.mutate(docs));
    if (caught.length === 0) {
      process.stderr.write(`upgrade-sequence selftest FAILED: undetected defect -- ${defect.label}\n`);
      status = 1;
    } else {
      process.stdout.write(`  detected: ${defect.label}\n`);
    }
  }
  if (status === 0) {
    process.stdout.write(
      `upgrade-sequence selftest OK: all ${planted} planted defect classes fail the gate.\n`,
    );
  }
  return status;
}

/* -- CLI -------------------------------------------------------------------- */

const docs = { skill: read(SKILL), spec: readOptional(SPEC), runbook: read(RUNBOOK) };

if (process.argv[2] === '--selftest') {
  process.exit(selftest(docs));
} else if (process.argv[2] !== undefined) {
  process.stderr.write('usage: node scripts/ci/check-upgrade-sequence-docs.mjs [--selftest]\n');
  process.exit(2);
} else {
  const { failures: found, stages, skipped } = check(docs);
  if (found.length > 0) {
    process.stderr.write(`upgrade-sequence docs FAILED:\n  ${found.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `upgrade-sequence docs OK [${TEMPLATE_MODE ? 'template' : 'instance'} mode]: `
    + `${stages.length} stages derived from ${SKILL}; ${RUNBOOK}`
    + `${skipped.length > 0 ? '' : ` and ${SPEC}`} describe${skipped.length > 0 ? 's' : ''}`
    + ` the same upgrade, and the bump goes through ${BUMP_HELPER} after the push.`
    + `${skipped.length > 0 ? ` Skipped: ${skipped.join('; ')}.` : ''}\n`,
  );
}
