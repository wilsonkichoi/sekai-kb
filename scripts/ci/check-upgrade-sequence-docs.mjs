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
//   - the skill's step 0 preflight stops on a dirty tree with no exception for an
//     untracked artifact at a retired path, or carries the exception without naming the
//     step that removes it -- the preflight would then stop on the very file a later
//     stage exists to sweep, and it stops before the step that displays the target's
//     Upgrade note, which is the only channel an older skill can be handed a fix on;
//   - dev_docs/SPEC.md does not carry the declared sequence verbatim;
//   - docs/runbook/UPGRADE.md does not name every declared stage;
//   - either adopter-facing document writes FRAMEWORK-VERSION with a raw shell
//     redirect, which is how the bump used to escape verification;
//   - either adopter-facing document fails to invoke the CI-verified bump helper, or
//     invokes it before pushing the merged branch;
//   - the newest CHANGELOG entry introduces an upgrade helper that its own
//     `### Upgrade note` never hands off as a runnable command (see below).
//
// The last one is the release-boundary rule, and it is the subtlest. A release that
// adds a step to the upgrade cannot perform that step on its own adoption: the
// invocation is driven by the skill and runbook that shipped with the release being
// LEFT, the new ones arrive with the merge, and a running invocation does not reload
// itself. The only text of the new release that the old one reads is the target's
// CHANGELOG entry, which every version of the skill and the runbook shows before
// merging. So a release that introduces an upgrade helper must put an executable
// bootstrap-and-invoke block for it in that entry's Upgrade note, or the fix it ships
// first applies one release too late. This gate derives "introduces" from the changelog
// itself -- a helper path the newest entry names and no earlier text does -- so it needs
// no tags and no history.
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
const CHANGELOG = 'CHANGELOG.md';

/** The helper the bump must go through, and the push that must precede it. */
const BUMP_HELPER = 'scripts/upgrade/ci-verified-bump.mjs';
const PUSH = /git push /;

/** The push is conditional on a remote existing, so a no-remote tree still reaches the helper. */
const REMOTE_GUARD = /git remote get-url origin[\s\S]{0,120}git push /;

/** The bump shown with an explicit reason — the only documented way past an unreadable conclusion. */
const OVERRIDE_INVOCATION = /node "\$BUMP_HELPER" bump[^\n]*--override "[^"]+"/;

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

/**
 * The stage that removes a retired artifact and the preflight that stops on a dirty
 * tree have to agree, or the skill blocks on exactly the file it later sweeps.
 *
 * This is the ordering that produced the release-boundary blocker: a retired artifact
 * is untracked, so `git status --porcelain` reports it, so a preflight that stops on
 * any output stops before the step that would remove it -- and before the step that
 * fetches and displays the target's Upgrade note, which is the only place an older
 * skill can be handed the fix. Nothing can repair that in a shipped tag, so the one
 * thing this gate can do is keep every FUTURE release's preflight carrying the
 * exception, and keep it pointing at the step that actually owns the removal.
 */
function checkPreflightExemptsSweptArtifact(skill, { stages }) {
  const sweep = stages.find((stage) => /sweep .*artifact/i.test(stage));
  if (!sweep) return;
  const heading = new RegExp(String.raw`^## (\S+)\. ${sweep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'im')
    .exec(skill);
  if (!heading) {
    failure(`${SKILL}: declares the "${sweep}" stage but carries no numbered step for it, so the preflight has nothing to defer to`);
    return;
  }
  const preflight = /^## 0\.[\s\S]*?(?=^## )/m.exec(skill);
  if (!preflight) {
    failure(`${SKILL}: carries no \`## 0.\` preflight section to check the clean-tree stop in`);
    return;
  }
  const text = preflight[0];
  if (!/untracked[\s\S]{0,200}retired|retired[\s\S]{0,200}untracked/i.test(text)) {
    failure(
      `${SKILL}: the step 0 preflight stops on a dirty tree with no exception for an `
      + `untracked artifact at a retired path. That artifact is what step ${heading[1]} `
      + 'removes, so the preflight would stop on the very file the upgrade exists to sweep',
    );
  }
  if (!text.includes(`step ${heading[1]}`)) {
    failure(
      `${SKILL}: the step 0 preflight does not defer the retired artifact to step `
      + `${heading[1]}, the step that identifies and removes it. Without the pointer the `
      + 'exception reads as permission to delete by hand',
    );
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
  checkNoRemotePathReachesTheHelper(rel, source);
}

/**
 * An instance with no `origin` is one of the unreadable shapes the helper is built to
 * answer, and the only shape whose answer the DOCUMENTED sequence can withhold: the
 * push comes first, so an unguarded `git push origin HEAD` aborts the block before
 * anything reaches the helper, and the override that exists for exactly this case is
 * never offered. A capability reachable only by editing the documented commands is not
 * a capability.
 *
 * Both halves are required. The guard keeps the sequence running to the helper; the
 * override invocation is what the operator does when it gets there.
 */
function checkNoRemotePathReachesTheHelper(rel, source) {
  if (!REMOTE_GUARD.test(source)) {
    failure(
      `${rel}: pushes the merged branch without first testing that a remote exists. On an `
      + `instance with no \`origin\` the push aborts the documented sequence before `
      + `${BUMP_HELPER} runs, so the override built for that case cannot be reached`,
    );
  }
  if (!OVERRIDE_INVOCATION.test(source)) {
    failure(
      `${rel}: never shows the bump invoked with \`--override "<reason>"\`, so a reader `
      + 'whose CI conclusion is unreadable has no documented way to record the adoption '
      + 'and is left to write the marker by hand — the exact defect the helper exists to end',
    );
  }
}

/* -- The release-boundary handoff ------------------------------------------- */

/** Every `scripts/upgrade/<name>.mjs` path a piece of text names. */
const HELPER_PATHS = /scripts\/upgrade\/[a-z0-9-]+\.mjs/g;

/**
 * The newest changelog entry (the first `## [` heading to the next one) and everything
 * else in the file. "Everything else" deliberately includes the preamble, so a helper
 * the release discipline already discusses is not mistaken for a new one.
 */
export function splitNewestEntry(changelog) {
  const headings = [...changelog.matchAll(/^## \[/gm)].map((match) => match.index);
  if (headings.length === 0) return null;
  const start = headings[0];
  const end = headings.length > 1 ? headings[1] : changelog.length;
  return {
    entry: changelog.slice(start, end),
    earlier: changelog.slice(0, start) + changelog.slice(end),
  };
}

/** The `### Upgrade note` section of one entry, or null when it carries none. */
function upgradeNote(entry) {
  const at = entry.search(/^### Upgrade note\s*$/m);
  if (at === -1) return null;
  // From the line AFTER the heading, so the heading's own `### ` is not read as the
  // start of the next section.
  const afterHeading = entry.indexOf('\n', at);
  if (afterHeading === -1) return '';
  const rest = entry.slice(afterHeading);
  const next = rest.search(/^#{2,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * The runnable handoffs a note carries, as `{var, path, subcommand}`. The three-line
 * form is the one every upgrade document uses, and matching it as one unit is what
 * makes this a check on an EXECUTABLE block rather than on a mention: a note that
 * extracts into one variable and runs another is caught here, not by the reader.
 */
export function parseHandoffs(note) {
  const form = new RegExp(
    String.raw`(?<var>[A-Z_]+)="\$\(git rev-parse --git-dir\)/[^"]+"\s*\n`
    + String.raw`\s*git show \S+:(?<path>scripts/upgrade/[a-z0-9-]+\.mjs) > "\$\k<var>"\s*\n`
    + String.raw`\s*node "\$\k<var>" (?<subcommand>[a-z][a-z-]*)`,
    'g',
  );
  return [...note.matchAll(form)].map((match) => ({ ...match.groups, at: match.index }));
}

/** The subcommands one helper's own `COMMAND_OPTIONS` table declares. */
function acceptedSubcommands(helperPath) {
  const source = readOptional(helperPath);
  if (source === null) return null;
  const block = /const COMMAND_OPTIONS = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) return null;
  return [...block[1].matchAll(/^ {2}([a-z][a-z-]*):/gm)].map((match) => match[1]);
}

/**
 * A helper the newest entry introduces must be handed to the PREVIOUS release's skill
 * as a command, because that is the skill running the upgrade that adopts this one.
 */
function checkFirstUpgradeHandoff(changelog) {
  // Framework-release scope. `CHANGELOG.md` is this repository's release log only in
  // template mode; adoption replaces it with an instance-owned work history that
  // carries no framework release entries and no upgrade helpers to hand off. Same
  // scope rule the spec assertion above uses.
  if (!TEMPLATE_MODE || changelog === null) {
    skippedNotes.push(`${CHANGELOG} handoff (adopted instance: the changelog is instance work history)`);
    return;
  }
  const split = splitNewestEntry(changelog);
  if (split === null) {
    failure(`${CHANGELOG}: carries no \`## [\` release entry to read the newest release from`);
    return;
  }
  const earlier = new Set(split.earlier.match(HELPER_PATHS) ?? []);
  const introduced = [...new Set(split.entry.match(HELPER_PATHS) ?? [])]
    .filter((path) => !earlier.has(path))
    .sort();
  if (introduced.length === 0) return;

  const note = upgradeNote(split.entry);
  if (note === null) {
    failure(
      `${CHANGELOG}: the newest entry introduces ${introduced.join(', ')} but carries no `
      + '`### Upgrade note`. The skill running the upgrade INTO this release predates that '
      + 'helper, so the note is the only place it can be handed over',
    );
    return;
  }
  const handoffs = parseHandoffs(note);
  for (const path of introduced) {
    const handoff = handoffs.find((candidate) => candidate.path === path);
    if (!handoff) {
      failure(
        `${CHANGELOG}: the newest entry introduces ${path}, but its \`### Upgrade note\` `
        + 'carries no runnable handoff for it (bootstrap the tag\'s copy into a variable, '
        + 'then invoke that same variable). Without one the release cannot apply its own '
        + 'fix on the upgrade that ships it',
      );
      continue;
    }
    const accepted = acceptedSubcommands(path);
    if (accepted !== null && !accepted.includes(handoff.subcommand)) {
      failure(
        `${CHANGELOG}: the \`### Upgrade note\` runs ${path} as \`${handoff.subcommand}\`, `
        + `which its option table does not declare (it accepts: ${accepted.join(', ')})`,
      );
    }
    if (path === BUMP_HELPER) {
      const pushAt = note.search(PUSH);
      if (pushAt === -1) {
        failure(`${CHANGELOG}: the \`### Upgrade note\` hands off ${BUMP_HELPER} without pushing the merged branch first, so the CI run it reads cannot exist`);
      } else if (pushAt > handoff.at) {
        failure(`${CHANGELOG}: the \`### Upgrade note\` invokes ${BUMP_HELPER} before pushing the merged branch`);
      }
    }
  }
}

export function check({ skill, spec, runbook, changelog }) {
  failures.length = 0;
  skippedNotes.length = 0;
  const declaration = parseDeclaration(skill);
  if (!declaration || declaration.stages.length === 0) {
    failure(`${SKILL}: carries no \`## The verified sequence\` declaration to derive from`);
    return { failures: [...failures], stages: [] };
  }
  checkSkillBody(skill, declaration);
  checkPreflightExemptsSweptArtifact(skill, declaration);
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
  checkFirstUpgradeHandoff(changelog);
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
    label: 'the preflight stops on a dirty tree with no exception for the artifact it later sweeps',
    mutate: (docs) => ({
      ...docs,
      skill: docs.skill.replace(
        /One exception, and it is not a[\s\S]*?do not delete anything by hand here\./,
        '',
      ),
    }),
  },
  {
    label: 'the preflight carries the exception but no longer names the step that owns the removal',
    mutate: (docs) => ({
      ...docs,
      skill: docs.skill.replace(/^## 0\.[\s\S]*?(?=^## )/m, (section) => section.replaceAll('step 3d', 'a later step')),
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
    label: 'the runbook pushes unguarded, so a no-remote tree never reaches the helper',
    mutate: (docs) => ({
      ...docs,
      runbook: docs.runbook.replaceAll(/git remote get-url origin[\s\S]*?\|\| echo "no origin[^"]*"/g, 'git push origin HEAD'),
    }),
  },
  {
    label: 'the runbook never shows the bump with an explicit override reason',
    mutate: (docs) => ({
      ...docs,
      runbook: docs.runbook.replaceAll(/--override "[^"]+"/g, ''),
    }),
  },
  {
    label: 'the runbook stops invoking the CI-verified bump helper',
    mutate: (docs) => ({ ...docs, runbook: docs.runbook.replaceAll(BUMP_HELPER, 'scripts/upgrade/gone.mjs') }),
  },
  {
    label: 'the newest changelog entry introduces a helper its Upgrade note never hands off',
    // Same scope as the spec defect: the release log this rule governs exists only in
    // a template checkout, so an adopted instance skips these rather than reporting
    // them undetected.
    requiresTemplate: true,
    mutate: (docs) => ({
      ...docs,
      changelog: docs.changelog.replace(
        /STALE_HELPER="\$\(git rev-parse --git-dir\)[\s\S]*?node "\$STALE_HELPER" sweep/,
        'the upgrade removes it for you',
      ),
    }),
  },
  {
    label: 'the Upgrade note bootstraps one variable and invokes another',
    requiresTemplate: true,
    mutate: (docs) => ({
      ...docs,
      changelog: docs.changelog.replace('node "$STALE_HELPER" sweep', 'node "$SWEEP_HELPER" sweep'),
    }),
  },
  {
    label: 'the Upgrade note runs a helper with a subcommand its option table rejects',
    requiresTemplate: true,
    mutate: (docs) => ({
      ...docs,
      changelog: docs.changelog.replace('node "$STALE_HELPER" sweep', 'node "$STALE_HELPER" clean'),
    }),
  },
  {
    label: 'the Upgrade note hands off the bump without pushing first',
    requiresTemplate: true,
    // The note's push is the guarded form, so strip the whole conditional rather than
    // a bare line -- a mutation that silently matches nothing proves nothing.
    mutate: (docs) => ({
      ...docs,
      changelog: docs.changelog.replace(/git remote get-url origin[\s\S]*?\|\| echo "no origin[^"]*"\n/, ''),
    }),
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
    if (defect.requiresTemplate && !TEMPLATE_MODE) {
      process.stdout.write(`  skipped (adopted instance: ${CHANGELOG} is instance work history): ${defect.label}\n`);
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

const docs = {
  skill: read(SKILL),
  spec: readOptional(SPEC),
  runbook: read(RUNBOOK),
  changelog: readOptional(CHANGELOG),
};

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
  // The summary names only what this checkout actually asserted. A skipped assertion is
  // reported as skipped and never folded into the claim, so a passing line in an
  // adopted instance cannot read as a guarantee the instance never checked.
  const describing = [RUNBOOK, ...(docs.spec === null ? [] : [SPEC])];
  const handoff = skipped.some((note) => note.startsWith(CHANGELOG))
    ? ''
    : `, and every upgrade helper the newest ${CHANGELOG} entry introduces is handed to`
      + ' the previous release\'s skill as a runnable command';
  process.stdout.write(
    `upgrade-sequence docs OK [${TEMPLATE_MODE ? 'template' : 'instance'} mode]: `
    + `${stages.length} stages derived from ${SKILL}; ${describing.join(' and ')} `
    + `describe${describing.length === 1 ? 's' : ''} the same upgrade, the bump goes `
    + `through ${BUMP_HELPER} after the push${handoff}.`
    + `${skipped.length > 0 ? ` Skipped: ${skipped.join('; ')}.` : ''}\n`,
  );
}
