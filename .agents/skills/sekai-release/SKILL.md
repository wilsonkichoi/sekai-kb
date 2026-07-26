---
name: sekai-release
description: Explicitly prepare a patch, minor, or major release of an adopted sekai-kb instance. Use when an adopter maintainer says "/sekai-release", "bump the instance version", "prepare a patch release", "prepare a minor release", or "prepare a major release". Never use for the Sekai framework release train or for routine article pull requests.
---

# Release an adopter instance

Update the adopter release only when a maintainer explicitly requests it. Routine
content merges do not change the release version. `VERSION` is the adopter SSOT;
`package.json` and `package-lock.json` mirror it without the leading `v`.
`docs/runbook/RELEASE.md` is the copy-pasteable human flow; keep this orchestration
in sync with it.

## 1. Preflight

Run from the repository root:

```bash
test ! -f .sekai-template
git status --short
npm run version:check
```

Stop if `.sekai-template` exists. Framework releases update
`FRAMEWORK-VERSION` through the Sekai release flow, not this skill.

Stop if the working tree is dirty. A release-version change must remain isolated
from article and framework-upgrade changes.

## 2. Select and confirm the release level

Accept exactly one of `patch`, `minor`, or `major`. If the user did not provide
one, ask. Do not infer the level from commit messages or the contents of
`CHANGELOG.md`.

Preview the result without writing:

```bash
npm run release:bump -- patch --dry-run
```

Replace `patch` with the selected level. Show the current and proposed versions.
An explicit request such as `/sekai-release minor` is approval; otherwise obtain
confirmation before writing.

## 3. Update synchronized version fields

```bash
npm run release:bump -- patch
```

The command must change only:

- `VERSION`, using the `vX.Y.Z` form.
- `package.json.version`, using `X.Y.Z`.
- The two root `package-lock.json` version fields, using `X.Y.Z`.

It must not change `FRAMEWORK-VERSION`, article content, or the changelog.

## 4. Verify

```bash
git diff -- VERSION package.json package-lock.json
npm run version:check
npm run test
npm run build
```

Hard-stop on any failure. Confirm the diff contains the same semantic version in
all three files and no dependency or lockfile churn.

## 5. Report

Report the old version, new version, selected level, unchanged
`FRAMEWORK-VERSION`, and verification results. Leave the verified changes
uncommitted. Commit, tag, push, or merge only when the maintainer explicitly asks
for those separate operations.
