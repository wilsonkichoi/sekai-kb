---
name: upgrade
description: |
  Pull a framework release into this instance. Adds/points the `framework`
  remote at sekai-kb, fetches tags, merges a requested `sekai-kb-vX.Y.Z` release
  tag (never framework `main`), build-verifies, walks any conflicts WITH the user
  alongside that version's CHANGELOG entry, and bumps `FRAMEWORK-VERSION`.
  Instance-owned files (`merge=ours` in `.gitattributes`) are kept automatically.
  TRIGGER when: user says "upgrade", "/upgrade", "update the framework", "pull the
  latest sekai-kb release", "bump to vX.Y.Z", or wants framework updates on an
  adopted instance.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# /upgrade — Merge a framework release into this instance

Instances track sekai-kb by merging **immutable release tags, never framework
`main`** (ADR 004, SPEC §Repo topology). This skill wraps the tagged-release
merge flow; it does **not** auto-resolve conflicts — framework-owned code
conflicts are walked with the user, one file at a time, against the CHANGELOG.

The identical flow as copy-pasteable git for non-AI users is
`docs/runbook/UPGRADE.md`. This skill orchestrates that runbook; keep the two in
sync (drift = decay).

## 0. Preflight

Run from the instance repo root:

```bash
test -f .sekai-template && echo "STOP: this is the template, not an instance" || echo "instance: ok"
git config merge.ours.driver true   # load-bearing: see below
git status --porcelain
cat FRAMEWORK-VERSION 2>/dev/null || echo "no FRAMEWORK-VERSION (pre-wizard instance)"
```

- **Set the `ours` merge driver first.** `.gitattributes merge=ours` names a
  driver git does NOT ship built-in; without `merge.ours.driver true` in this
  clone's config the attribute silently no-ops and the merge overwrites the user's
  place content/config. It is per-clone (not version-controlled), so set it every
  run — the command is idempotent. This is the single most common cause of a
  "framework upgrade clobbered my `place.config.ts`" report.
- **`.sekai-template` present** → this is the framework itself, not an instance.
  Stop; `/upgrade` is an instance operation.
- **Working tree not clean** → stop and tell the user to commit or stash first. A
  merge onto a dirty tree is unrecoverable-in-place.
- Note the current `FRAMEWORK-VERSION`; it is the "from" version for the report.

## 1. Point the `framework` remote and fetch tags

```bash
git remote get-url framework 2>/dev/null || git remote add framework https://github.com/wilsonkichoi/sekai-kb.git
git fetch framework --tags
git tag -l 'sekai-kb-v*' | sort -V
```

The last line is the available releases. If the user did not name a target,
propose the highest tag above the current `FRAMEWORK-VERSION` and confirm.

## 2. Show the CHANGELOG for the target before merging

The release's own notes are the map for any conflict. Read the target version's
section from the framework CHANGELOG and show it to the user, in particular the
**Upgrade note** (breaking config changes, new required fields):

```bash
# Prints the target version's entry only (stops before the next `## [` heading):
git show sekai-kb-vX.Y.Z:CHANGELOG.md | awk '/^## \[X\.Y\.Z\]/{p=1;print;next} p&&/^## \[/{exit} p'
```

If the Upgrade note names a new `place.config` key, remember: new keys default to
feature-off when absent (SPEC §place.config.ts absent-safe rule), so the merge
never *requires* config surgery — surface the new flag as an opt-in, do not edit
the user's `place.config.ts` to enable it.

## 3. Merge the tag (never `main`)

```bash
git merge --no-ff sekai-kb-vX.Y.Z -m "chore: upgrade framework to sekai-kb-vX.Y.Z"
```

`.gitattributes merge=ours` keeps every instance-owned file
(`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`,
`README.md`, `docs/baselines/**`, `scripts/ci/genericity-denylist.local.txt`)
automatically — those never conflict.

- **Merge clean** → go to step 5.
- **Conflicts reported** → step 4. Conflicts can only be in framework-owned files
  the instance edited locally against the ownership rule (`src/`, `scripts/`), or
  in a file the instance chose to fork and manage locally.

## 4. Conflict report — walk each file WITH the user

Do **not** blindly take one side. For each conflicted path, present a short
report and a proposal, then let the user decide:

```bash
git diff --name-only --diff-filter=U
```

For each file, show: the path, the relevant CHANGELOG line for this version, and
the two sides (`git diff`). Then propose the resolution and its rationale:

- **Framework-owned file (`src/`, `scripts/`), no intentional local change** →
  propose taking framework (`git checkout --theirs <file>`). This is the ownership
  rule healing an accidental local edit.
- **A change the instance intentionally forked** → propose keeping the local
  edit, and note it should be upstreamed to sekai-kb so it stops conflicting every
  release (SPEC ownership rule).

Apply only what the user approves (`git checkout --theirs/--ours <file>` or a
hand-merge), then `git add <file>`. Never `git checkout -f` the whole tree.

## 5. Build-verify before committing the merge

```bash
npm run build
```

The build must be green before the merge is finalized. If a merged framework
change broke the build (e.g. a config contract the Upgrade note called out),
resolve it now — do not commit a red merge. If the merge is still in progress
(conflicts were resolved in step 4), finalize it:

```bash
git commit --no-edit
```

## 6. Bump FRAMEWORK-VERSION

Record the version just adopted (the tag's `vX.Y.Z`, matching the wizard's
`v`-prefixed form):

```bash
printf 'vX.Y.Z\n' > FRAMEWORK-VERSION
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> vX.Y.Z"
```

## 7. Report

Tell the user: the version moved from → to, which files (if any) conflicted and
how each was resolved, the build result, and any Upgrade-note opt-ins they
declined (new feature flags left off). Push is theirs to make — on an instance,
pushing `main` deploys.
