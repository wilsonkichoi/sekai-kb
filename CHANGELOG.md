# Changelog

All notable changes to the **sekai-kb** framework are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release discipline (read before cutting a release)

sekai-kb is the framework SSOT; instances track it by merging **immutable release
tags, never framework `main`** (ADR 004, SPEC
§Repo topology). The rules that keep two-repo upgrades deterministic:

1. **Every framework change lands with a CHANGELOG entry.** No entry, no release.
   The entry names what changed in the framework-owned trees (`src/`, `scripts/`,
   `.claude/skills/`, `docs/playbook/`, `docs/runbook/`, config).
2. **Breaking config changes carry an upgrade note.** Any change an instance must
   act on at merge time (a renamed `place.config.ts` key, a new required field, a
   moved file) goes under an explicit **Upgrade note** in that version's entry.
   New `place.config` keys MUST default to feature-off when absent (SPEC
   §place.config.ts absent-safe rule), so an instance that ignores the note still
   builds — the note tells it what it is opting out of.
3. **Instances merge tags only.** The release flow is: land the change on `main`
   with its CHANGELOG entry → bump `package.json` `version` → tag
   `sekai-kb-vX.Y.Z` → push the tag. Instances run `/upgrade` (or the manual git
   flow in `docs/runbook/UPGRADE.md`), which merges the tag, never `main`.
4. **Instance-owned files are never overwritten.** Files an instance owns
   (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`,
   `AGENTS.md`, `README.md`, `docs/baselines/**`,
   `scripts/ci/genericity-denylist.local.txt`, `.agent-toolkit/**`) carry
   `.gitattributes merge=ours` on the instance, so a tag merge keeps the
   instance's copy. Framework changes to those paths are therefore inert on
   instances by design — do not rely on them propagating.

## [Unreleased]

## [1.0.5] — 2026-07-24

Makes framework upgrades preserve an instance's dev-plugin state in both
directions: an adopter who never wanted the dev workflow stops silently
reacquiring it, and an adopter who installed their own keeps it untouched.

### Fixed

- **`/upgrade` preserves a stripped `.agent-toolkit/` tree.** `merge=ours`
  protects the *content* of a path present on both merge sides; it does not
  preserve a path the instance deliberately deleted. A wizard-adopted instance
  therefore hit a `DU .agent-toolkit/dev.md` modify/delete conflict on a
  shared-history upgrade, and had the framework's whole dev-plugin tree added back
  as theirs-only content on an unrelated-history first tag merge. Dev-plugin
  presence is now persistent instance state that the upgrade classifies before
  merging and reconciles after (ADR 006 addendum, SPEC §Repo topology).

### Added

- **`scripts/upgrade/dev-plugin-state.mjs`** — the framework helper `/upgrade` and
  `docs/runbook/UPGRADE.md` both drive. `classify` prints `stripped` (no
  `.agent-toolkit/` and no active `@.agent-toolkit/dev.md` reference in
  `AGENTS.md`/`CLAUDE.md`) or `installed` (the adopter's `.agent-toolkit/dev.md`
  and the active reference both present), and exits 3 with a diagnostic on an
  inconsistent state — half-installed dev-plugin state stops the upgrade rather
  than being guessed at. `reconcile --state stripped` removes every
  `.agent-toolkit/` path the merge brought in (modify/delete conflicts and
  theirs-only additions alike), drops any reference line the merge introduced, and
  amends the merge commit when the merge already completed, so the framework tree
  is never committed into the instance and the user never resolves a dev-plugin
  conflict by hand. `reconcile --state installed` mutates nothing: it asserts the
  adopter's `.agent-toolkit/**` is byte-for-byte unchanged against the pre-merge
  revision and reports framework paths the merge added, for the user to keep or
  remove.
- **`scripts/upgrade/check-upgrade-state.sh`** — disposable-repository regressions
  for all five states (stripped on shared history, stripped on unrelated history,
  installed, and both inconsistent states), plus a `--selftest` mode that proves
  the suite fails when the reconcile step is skipped. Both run in the required CI
  `test` job (`npm run upgrade:check`, `npm run upgrade:selftest`).

### Changed

- **CI `test` job gates the dev-plugin rule registry when dev-plugin state is
  present.** `.github/workflows/deploy.yml` gains a step that runs
  `.agent-toolkit/scripts/check-rule-registry.mjs` and its self-test, guarded by
  `if [ -f .agent-toolkit/dev.md ]`. The checker asserts every promoted rule under
  the configured `rules_dir` declares a valid `tier` (doctrine / gotcha+trigger /
  none) for the dev-plugin project-bootstrap **discovery** contract (dev 0.0.64+),
  and that the `## Rules` section carries no bare `@path` registry line. The init
  wizard strips the entire `.agent-toolkit/` tree from adopter instances, so on a
  stripped adopter the guard makes the step a clean no-op — the workflow never
  depends on a removed path. The rule files and registry format under
  `.agent-toolkit/**` are instance-owned (`.gitattributes merge=ours`) and inert on
  instances; only this guarded `deploy.yml` step propagates on upgrade, and it
  requires no adopter action.

### Upgrade note

Run this upgrade with `/upgrade` (or the updated `docs/runbook/UPGRADE.md` flow):
both now classify dev-plugin state **before** the merge and reconcile it after.
Releases before 1.0.5 did not ship the helper, so on this one upgrade run it from
the tag, as both flows show:

```sh
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show sekai-kb-v1.0.5:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)"
```

If `classify` exits 3, your instance is in an inconsistent state (a
`.agent-toolkit/` tree with no active `@.agent-toolkit/dev.md` reference, or the
reverse). Repair it deliberately before merging — the diagnostic names both
directions. No `place.config.ts` change and no other adopter action is required.

## [1.0.4] — 2026-07-19

Corrects the v1.0.3 AGENTS.md-as-SSOT rollout so framework development and fresh
adopter instances follow the accepted ADR-006 contract without gaps.

### Fixed

- **Operative framework references now agree on the agent-instruction SSOT.**
  `.agent-toolkit/dev.md` names `AGENTS.md` as the content-bearing instruction
  source and `CLAUDE.md` as its one-line shim. The repository-topology diagram
  carries the same labels and includes `AGENTS.md` plus `.agent-toolkit/**` in
  the applicable instance-owned set.
- **The init self-check enforces the `CLAUDE.md` shim byte-for-byte.** The expected
  output is exactly `@AGENTS.md\n`; regression fixtures reject a trailing blank
  line, a missing final newline, added prose, or any changed byte. The existing
  CI init-check job runs this assertion, including its disposable `--build` tier.
- **Fresh adopter instructions retain the full applicable support contract.**
  Wizard-rendered `AGENTS.md` files now include the language-support boundary and
  the absent-safe semiont probe rule. The init self-check asserts both sections
  and continues to reject template-only and dev-plugin-only content.

### Upgrade note

`AGENTS.md`, `CLAUDE.md`, and `.agent-toolkit/**` are instance-owned, so merging
this tag does not overwrite them. Reconcile the improved `AGENTS.md` starter per
`docs/runbook/UPGRADE.md`: carry over the language-support boundary and semiont
probe if they are absent, keep instance-specific instructions intact, and confirm
that `CLAUDE.md` is byte-for-byte `@AGENTS.md\n`.

## [1.0.3] — 2026-07-19

`AGENTS.md` becomes the single source of truth for agent instructions; `CLAUDE.md`
is reduced to a one-line `@AGENTS.md` shim. Claude Code inlines the shim recursively
(`CLAUDE.md` → `AGENTS.md` → `@.agent-toolkit/dev.md` → doctrine rules) and Codex
reads `AGENTS.md` natively, so both CLIs boot from one document with no instructions
duplicated across or diverging between the two files.

### Changed

- **`AGENTS.md` is the agent-instruction SSOT.** The framework `CLAUDE.md` content
  (place identity, where-things-live, how-the-site-builds, iron rules, skill
  ownership, language boundary, semiont probe, template mode) moved into `AGENTS.md`
  above the dev-plugin sentinel block. The `AGENTS.md` "Read CLAUDE.md — it is the
  boot document" pointer is gone; `CLAUDE.md` is now exactly `@AGENTS.md`. The
  dev-plugin sentinel block and its `@.agent-toolkit/dev.md` reference line stay in
  `AGENTS.md`, unchanged.
- **The init wizard writes the new shape.** `scripts/init/writer.mjs` renders
  `AGENTS.md` place-specifically (the former `renderClaudeMd` content plus the
  content working set) and writes `CLAUDE.md` as the one-line `@AGENTS.md` shim; a
  fresh instance's `AGENTS.md` carries no dev-plugin sentinel block, so no separate
  strip is needed. `scripts/init/check-init.sh` now asserts the `AGENTS.md` header
  and the `CLAUDE.md` shim.
- **Starter reconciliation follows the new shape.** `/upgrade` +
  `docs/runbook/UPGRADE.md` treat `AGENTS.md` (and `README.md`) as the
  content-bearing starters to reconcile on upgrade; `CLAUDE.md` is exempt as a fixed
  `@AGENTS.md` shim.

### Upgrade note

**An instance must mirror this consolidation by hand** — `AGENTS.md`, `CLAUDE.md`,
and `.agent-toolkit/**` are `merge=ours`, so the tag's restructured starters do not
land on your instance automatically. On the merge branch, after merging this tag:

1. Move your `CLAUDE.md`'s content into your `AGENTS.md` (above the dev-plugin
   sentinel block if you keep one), delete any "Read CLAUDE.md — boot document"
   pointer, and reduce `CLAUDE.md` to a single `@AGENTS.md` line.
2. Keep your `AGENTS.md` dev-plugin sentinel block and its `@.agent-toolkit/dev.md`
   reference line intact — that line must NOT sit inside an HTML comment, or Claude
   Code will not inline your dev config through the chain.
3. Confirm `CLAUDE.md` is exactly `@AGENTS.md` and every `@` import target still
   resolves.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's agent-instruction plumbing, not the rendered site.

## [1.0.2] — 2026-07-19

Dev-plugin encapsulation (agent-toolkit 0.0.55) and adopter-owned `AGENTS.md`. The
framework's own development state (dev config + engineering rules) moves into
`.agent-toolkit/`, stops shipping to adopters, and `AGENTS.md` becomes instance-owned
from clone time (LB-41).

### Added

- **sekai-kb adopts the dev plugin** — `.agent-toolkit/dev.md` now carries the
  framework repo's own dev-workflow config (tracker, test command, CI workflow,
  merge policy, `context_file: AGENTS.md`, `rules_dir: .agent-toolkit/rules/`) plus a
  tiered `## Rules` index of the 12 engineering rules. `AGENTS.md` gains a
  dev-plugin reference line; `CLAUDE.md` reaches it via an `@AGENTS.md` shim.

### Changed

- **Engineering rules relocated** from `.claude/rules/` to `.agent-toolkit/rules/`
  and reclassified as **dev-plugin state, not framework content**. They are lessons
  from developing the framework's `src/`/`scripts/`; adopters never touch those
  trees, so shipping them was a mistake. Every `.claude/rules/` reference in code
  comments, `CLAUDE.md`, `README.md`, and the wizard was re-pointed or removed.
- **`.gitattributes` `merge=ours` baseline is now 10 paths** — added `AGENTS.md`
  and `.agent-toolkit/**`. `AGENTS.md` is instance-owned from clone time (its
  starter began as framework boilerplate the instance then personalizes);
  `.agent-toolkit/**` is instance-owned because every repo — the framework and each
  instance — carries its own dev config that a tag merge must never overwrite.
- **The init wizard strips dev-plugin state from adopter clones.**
  `scripts/init/writer.mjs` removes the `.agent-toolkit/` tree and the `AGENTS.md`
  dev-plugin reference line on adoption; `scripts/init/check-init.sh` asserts both
  are absent post-init. A fresh instance ships zero dev-plugin state.
- **`/upgrade` + `docs/runbook/UPGRADE.md` gained a starter-file reconciliation
  step.** `merge=ours` silently discards the framework's changes to instance-owned
  starter files (`AGENTS.md` above all); the upgrade flow now diffs each starter
  against the incoming tag and offers framework improvements conversationally
  instead of dropping them.

### Fixed

- Template `.gitattributes` now ships the full `merge=ours` baseline the docs
  promise: added `CNAME`, `docs/baselines/**`, and
  `scripts/ci/genericity-denylist.local.txt` (all wizard-written), so a
  template-cloned adopter's `CNAME` + local denylist are protected without hand
  edits (LB-33 review S1).
- `docs/runbook/UPGRADE.md` demo-article cleanup uses `ORIG_HEAD` (the pre-merge
  tree `git merge` records at merge start) instead of `HEAD@{1}`, which resolved
  to an arbitrary reflog entry while the establishment merge was still uncommitted
  and could `git rm` an instance's own article (LB-33 review S2).
- `/upgrade` skill + `UPGRADE.md` CHANGELOG-excerpt command uses an `awk` range
  that stops before the next `## [` heading instead of a `sed` range that printed
  it as trailing noise (LB-33 review N1).

### Upgrade note

**An instance must migrate its own dev-plugin layout BEFORE merging this tag**, or
the template-side deletion of `.claude/rules/` collides with the rule files the
instance still has there. Do this on the merge branch, in order:

1. Add the two new `merge=ours` lines to your instance `.gitattributes`
   (`AGENTS.md`, `.agent-toolkit/**`) — this must precede the merge, or the tag's
   `.agent-toolkit/dev.md` (the framework's config) would land on your instance.
2. Relocate any rules you keep from `.claude/rules/` into your `rules_dir`
   (`.agent-toolkit/rules/`) and remove `.claude/rules/`. The template-side rule
   deletions then merge clean (both sides removed the path).
3. Run `dev:setup` (agent-toolkit ≥ 0.0.55) so your `.agent-toolkit/dev.md` carries
   `context_file` + `rules_dir` and a `## Rules` index; add the `AGENTS.md`
   reference line and the `CLAUDE.md` `@AGENTS.md` shim.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's dev-workflow plumbing, not the rendered site.

## [1.0.1] — 2026-07-18

### Changed

- **`docs/runbook/UPGRADE.md`** — the merge-base establishment step now covers
  demo-content cleanup: `merge=ours` protects files an instance already has but
  does not stop theirs-only `knowledge/` articles from being *added*, so an
  existing instance re-basing onto the framework must strip the template's demo
  articles. Documents the `comm`-based list-and-remove and clarifies the
  `merge=ours` add-vs-overwrite distinction.

### Upgrade note

Docs only — no config or code contract changes. Nothing to do.

[1.0.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.1

## [1.0.0] — 2026-07-18

First tagged framework release: the complete Phase-5 sekai-kb template, cut from
its origin instance and genericized to ship zero place content. An adopter runs
`/adopt` on a fresh clone and reaches a deployed site; the first instance re-bases
onto this tag.

### Added

- **Adoption path** — `/adopt` AI-interview skill (the primary bootstrap), the
  `npm run init` wizard (single writer of `place.config.ts`, `CNAME`, the
  `CLAUDE.md`/`README.md` headers, `FRAMEWORK-VERSION`, and the instance-owned
  genericity denylist), and `/seed-articles` for first content.
- **Content-lifecycle skills** — `/write`, `/validate`, `/factcheck`, and a
  router skill under `.claude/skills/`, all config- and playbook-driven with no
  place identity baked in.
- **`SystemDiagram.astro`** — config-driven animated architecture diagram
  (`/system` page); renders from `place.config.ts` with a brand-circle fallback
  when no `boundary.geojson` is present, and dims feature loops that are off.
- **Docs** — `docs/playbook/` (ARTICLE / REWRITE-PIPELINE / FACTCHECK-PIPELINE),
  `docs/runbook/DEPLOY.md`, framework `CLAUDE.md` + `AGENTS.md`.
- **Release discipline** — this `CHANGELOG.md`, the `/upgrade` skill, and
  `docs/runbook/UPGRADE.md` (tagged-release upgrade flow + merge-base mechanics).
  The `merge=ours` mechanism requires `git config merge.ours.driver true` per
  clone (the `ours` driver is not built into git); `/upgrade`, the runbook, and
  the `.gitattributes` header all set/document it.

### Changed

- **Genericity + English-only gates** now scan `.claude/skills/` in addition to
  `src/`, `scripts/`, `tests/`, and run whole-tree in template mode (gated on the
  `.sekai-template` marker) vs. code-trees-only in instance mode.
- **`article-health`** editorial linter hardened across Phase 5 (At-a-Glance
  blockquote, chronicle-lead, footnote/cross-reference rules) and its
  `EDITORIAL_REF` strings re-pointed to `docs/playbook/`.
- **`package.json`** `version` set to `1.0.0`; the init wizard now records
  `FRAMEWORK-VERSION` as `v${version}` so wizard-written and `/upgrade`-written
  values share the `vX.Y.Z` form.

### Upgrade note

First release — nothing to upgrade from. The first instance establishes its merge
base against this tag per `docs/runbook/UPGRADE.md` §Establishing the merge base.

[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/sekai-kb-v1.0.5...HEAD
[1.0.5]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.5
[1.0.4]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.4
[1.0.3]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.3
[1.0.2]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.2
[1.0.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.0
