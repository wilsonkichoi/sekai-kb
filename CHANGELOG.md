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
   `README.md`, `docs/baselines/**`, `scripts/ci/genericity-denylist.local.txt`)
   carry `.gitattributes merge=ours` on the instance, so a tag merge keeps the
   instance's copy. Framework changes to those paths are therefore inert on
   instances by design — do not rely on them propagating.

## [Unreleased]

### Fixed

- Template `.gitattributes` now ships the full 8-path `merge=ours` baseline the
  docs promise: added `CNAME`, `docs/baselines/**`, and
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

[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/sekai-kb-v1.0.1...HEAD
[1.0.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.0
