# UPGRADE — Pulling framework releases into an instance

Companion to `DEPLOY.md`. Every command is copy-pasteable. This is the manual git
flow for non-AI users; the `/sekai-upgrade` skill (`.agents/skills/sekai-upgrade/`) drives the
identical steps for an AI CLI. Keep the two in sync.

Instances track the sekai-kb framework by merging **immutable release tags, never
framework `main`** — the tagged-release decision and the repo-topology contract behind
it live with the framework's own decision records in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb), which adoption does not
copy into your instance. A tag is reproducible: everyone
at `sekai-kb-v1.2.3` has byte-identical
framework code, and the merge is deterministic because instance-owned files carry
`.gitattributes merge=ours`.

> A fuller `UPGRADE.md` (edge cases, rollback) is formalized in task 9.3; this is
> the working runbook the release discipline ships with (task 5.4).

---

## Establishing the merge base (one-time, first upgrade only)

**Why this step exists.** A GitHub "Use this template" clone — and the first
instance, whose squash-merge history shares no commits with the framework even
though the template was cut from it — has a git history **unrelated** to
sekai-kb's. Git therefore has no common ancestor to diff against, so the first
merge must be told the histories are unrelated. That first merge creates a real
merge commit with the framework tag as a parent; from then on every
`git merge sekai-kb-vX.Y.Z` is a one-command incremental merge with the previous
tag as the computed base.

**Chosen mechanism: an `--allow-unrelated-histories` merge, not a graft.** A
`git replace --graft` would fake an ancestor without a merge commit, but graft
refs are local — they do not survive a fresh clone or reach CI, so the instance
would build differently for every contributor. A merge commit is permanent,
pushed, and identical for everyone. That determinism is the whole point (§G risk
4), so the merge wins over the graft.

Run once, from the instance repo root (already done for the first instance in task
5.4 — this is the reproducible record):

```bash
# 1. Enable the `ours` merge driver. `.gitattributes merge=ours` names a driver
#    called `ours` that git does NOT ship built-in — without this config line the
#    attribute silently no-ops and a merge overwrites your place content/config.
#    Git config is per-clone (not version-controlled), so every clone of this
#    instance runs this once:
git config merge.ours.driver true

# 2. Instance-owned files must be merge=ours BEFORE the first merge, or the merge
#    will try to overwrite your place content/config. Confirm .gitattributes lists
#    them (see "Instance-owned files" below), then:
git remote add framework https://github.com/wilsonkichoi/sekai-kb.git
git fetch framework --tags
TARGET=sekai-kb-v1.0.9
TARGET_VERSION="${TARGET#sekai-kb-}"

# 3. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Releases before v1.0.5 did not ship the helper, so on a first merge run it
#    from a release that does — any tag >= v1.0.5, even when the base you are
#    establishing is older. The extracted copy lives inside .git, never in your tree.
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show "$TARGET":scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"

# 4. Classify maintainer-doc state BEFORE merging (see "Maintainer-doc state"
#    below). Same extraction pattern for a target that predates the helper.
MDOCS_HELPER=scripts/upgrade/maintainer-docs-state.mjs
test -f "$MDOCS_HELPER" || { MDOCS_HELPER="$(git rev-parse --git-dir)/sekai-maintainer-docs-state.mjs"; \
  git show "$TARGET":scripts/upgrade/maintainer-docs-state.mjs > "$MDOCS_HELPER"; }
node "$MDOCS_HELPER" classify

# 4b. Capture adopter-owned package identity before the mixed-ownership manifests
#     merge. For the first upgrade to a release carrying this helper, extract it
#     from that target tag into .git, as shown for the dev-plugin helper above.
PACKAGE_HELPER=scripts/upgrade/package-state.mjs
test -f "$PACKAGE_HELPER" || { PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs"; \
  git show "$TARGET":scripts/upgrade/package-state.mjs > "$PACKAGE_HELPER"; }
PACKAGE_STATE="$(node "$PACKAGE_HELPER" capture)"
#    Exit 3 = inconsistent state (only one half of the dev workflow present), or a
#    maintainer-doc path set that could not be derived: stop here and repair it
#    deliberately, as the diagnostic says.

# 5. The first merge — the ONLY one that needs --allow-unrelated-histories:
git merge --allow-unrelated-histories "$TARGET"

# 6. Reconcile dev-plugin, maintainer-doc, and package state immediately after the
#    merge command, whether it
#    stopped on conflicts or completed on its own:
node "$HELPER" reconcile --state "$STATE"
node "$MDOCS_HELPER" reconcile
node "$PACKAGE_HELPER" reconcile "$PACKAGE_STATE"
```

> **The `merge.ours.driver true` line is load-bearing and per-clone.** It is not
> stored in the repo. A fresh clone of this instance, or a CI checkout that does a
> tag merge, must set it first or `merge=ours` does nothing. `/sekai-upgrade` sets it in
> its preflight; the wizard-adopted instance's first `/sekai-upgrade` does the same.

The merge outcome, file by file:

- **Instance-owned files** (`place.config.ts`, `knowledge/**`, `CLAUDE.md`, …) —
  kept as yours automatically by `merge=ours`. No conflict. **Caveat:** `merge=ours`
  protects files you *already have* from being overwritten; it does **not** stop a
  theirs-only file under those paths from being *added*, and it does **not**
  preserve a path you deliberately *deleted*. If the template ships demo
  content (`knowledge/` articles for its example place), that content lands in your
  instance on the first merge — strip it in the cleanup step below. The deleted-path
  case is `.agent-toolkit/` on a wizard-adopted instance; step 5's `reconcile` keeps
  it absent.
- **Files only the framework has** (e.g. `.agents/skills/`, `SystemDiagram.astro`)
  — added to your instance.
- **Files only you have** (your docs, research, tracker config) — untouched; a
  merge never deletes a path absent on the incoming side.
- **Framework-owned files you also carry** (`src/`, `scripts/`) — these conflict
  on the first merge, because with unrelated histories git sees both sides as
  having "added" the file. Resolve them to the framework version (the ownership
  rule: `src/` and `scripts/` are framework-owned):

```bash
# v1.0.8 -> v1.0.9 only: keep the adopter's VERSION when the framework deletes
# its mistaken template copy.
git diff --name-only --diff-filter=U | grep -Fxq VERSION \
  && git checkout --ours VERSION && git add VERSION || true

# Take framework for every remaining framework-owned conflict:
for f in $(git diff --name-only --diff-filter=U); do git checkout --theirs "$f" && git add "$f"; done
```

Then remove the template-only marker (an instance is not the template) and any
demo content the merge added. A "Use this template" adopter reseeds via `/sekai-adopt`;
an existing instance re-basing onto the framework strips the template's demo
articles so only its own `knowledge/` remains:

```bash
git rm --ignore-unmatch .sekai-template
# Demo articles added by the merge = present in the tag's knowledge/, absent from
# your pre-merge tree. `git merge` set ORIG_HEAD to that pre-merge tree at merge
# start (correct whether or not the merge is committed yet — unlike HEAD@{1}).
# List and remove them (yours are untouched by merge=ours):
comm -13 <(git ls-tree -r --name-only ORIG_HEAD -- knowledge/ | sort) \
         <(git ls-tree -r --name-only "$TARGET" -- knowledge/ | sort) \
  | while read -r f; do git rm -f -- "$f"; done
```

Build-verify, finalize, record the version:

```bash
npm run build
git commit --no-edit
printf '%s\n' "$TARGET_VERSION" > FRAMEWORK-VERSION
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> $TARGET_VERSION"
```

From here on, upgrades are the routine flow below — no `--allow-unrelated-histories`
ever again.

---

## Routine upgrade (every release after the base is set)

```bash
# 0. The ours driver must be set in THIS clone (see the establishment section —
#    it is per-clone, not version-controlled). Harmless to re-run:
git config merge.ours.driver true

# 1. Working tree clean? (stash or commit first — a merge onto a dirty tree bites.)
git status --porcelain

# 2. VERSION is your instance release and never changes here. Pick a framework
#    target above FRAMEWORK-VERSION.
git fetch framework --tags
git tag -l 'sekai-kb-v*' | sort -V
cat VERSION
cat FRAMEWORK-VERSION
TARGET=sekai-kb-v1.0.9
TARGET_VERSION="${TARGET#sekai-kb-}"

# 3. Read the target's CHANGELOG entry first — especially its Upgrade note.
git show "$TARGET":CHANGELOG.md | awk -v h="## [${TARGET_VERSION#v}]" '$0==h{p=1} p&&$0!=h&&/^## \[/{exit} p'

# 4. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Exit 3 = inconsistent state: stop and repair it deliberately.
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show "$TARGET":scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"

# 4b. Classify maintainer-doc state BEFORE merging (see "Maintainer-doc state"
#     below). Per path, so owning one of those paths and not the others is fine.
#     Exit 3 = the path set could not be derived: stop rather than merge blind.
MDOCS_HELPER=scripts/upgrade/maintainer-docs-state.mjs
test -f "$MDOCS_HELPER" || { MDOCS_HELPER="$(git rev-parse --git-dir)/sekai-maintainer-docs-state.mjs"; \
  git show "$TARGET":scripts/upgrade/maintainer-docs-state.mjs > "$MDOCS_HELPER"; }
node "$MDOCS_HELPER" classify

# 4c. Capture adopter-owned package identity and version before merging.
PACKAGE_HELPER=scripts/upgrade/package-state.mjs
test -f "$PACKAGE_HELPER" || { PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs"; \
  git show "$TARGET":scripts/upgrade/package-state.mjs > "$PACKAGE_HELPER"; }
PACKAGE_STATE="$(node "$PACKAGE_HELPER" capture)"

# 5. Merge the tag (never main). merge=ours keeps your content/config.
git merge --no-ff "$TARGET" -m "chore: upgrade framework to $TARGET"

# 6. Reconcile dev-plugin, maintainer-doc, and package state immediately after the
#    merge command — whether it stopped on conflicts or completed on its own.
#    Stripped: the framework's .agent-toolkit/ is removed again (conflicts and
#    additions alike) so you never resolve a dev-plugin conflict by hand.
#    Installed: nothing is touched; your config and rules are asserted
#    byte-for-byte unchanged, and any framework path the merge ADDED under
#    .agent-toolkit/ is reported for you to keep or remove. The maintainer-doc
#    reconcile applies the same rule per path: absent stays absent, yours stays
#    yours, and it stops if the merge touched a document you own.
node "$HELPER" reconcile --state "$STATE"
node "$MDOCS_HELPER" reconcile
node "$PACKAGE_HELPER" reconcile "$PACKAGE_STATE"

# 7. If conflicts remain: they can only be framework-owned files you edited locally,
#    or the one-time VERSION modify/delete conflict when leaving v1.0.8. Keep the
#    adopter VERSION in that one case. For framework-owned files, read the CHANGELOG.
#    Read the CHANGELOG line for each, then take framework unless you intentionally
#    forked it (in which case: upstream it to sekai-kb so it stops conflicting):
git diff --name-only --diff-filter=U
#    git checkout --theirs <file> && git add <file>     # take framework
#    git commit --no-edit                               # finalize the merge

# 8. Build-verify, then record the newly adopted framework version.
npm run build
printf '%s\n' "$TARGET_VERSION" > FRAMEWORK-VERSION
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> $TARGET_VERSION"
```

**New `place.config` keys never require surgery.** Every new config key defaults
to feature-off when absent (SPEC §place.config.ts absent-safe rule), so a release
that adds `features.newthing` builds on your instance untouched; the CHANGELOG
Upgrade note tells you what you are opting out of. Enable it by editing
`place.config.ts` yourself when you want it — the upgrade never edits your config.

Pushing `main` deploys (see `DEPLOY.md` §CI) — that step is yours to make.

---

## Instance-owned files (`merge=ours`)

These paths carry `merge=ours` in the instance `.gitattributes`, so framework tag
merges keep the instance's version:

| Path | Why instance-owned |
| ---- | ------------------ |
| `place.config.ts` | the place's identity and feature flags |
| `knowledge/**` | the place's articles (the content SSOT) |
| `public/media/**` | the place's images and media |
| `CNAME` | the instance's custom domain |
| `CLAUDE.md` | one-line `@AGENTS.md` shim (written by the wizard) |
| `AGENTS.md` | instance-owned agent-instruction SSOT (rendered by the wizard) |
| `README.md` | instance repo front page (rendered by the wizard) |
| `CHANGELOG.md` | instance work history; framework notes are read from the target tag |
| `VERSION` | the instance's own release version; framework upgrades never change it |
| `FRAMEWORK-VERSION` | adopted framework tag; bumped explicitly after upgrade verification |
| `docs/baselines/**` | instance-captured health/visual baselines |
| `scripts/ci/genericity-denylist.local.txt` | the place's own denylisted terms |
| `.agent-toolkit/**` | dev-plugin state (config + promoted rules) — each repo owns its own |

Adopters add their own instance-specific files to `.gitattributes` the same way.
The list is append-only from the framework baseline; the framework never removes a
`merge=ours` entry, so an upgrade cannot start overwriting a file you own.

`package.json` and `package-lock.json` are mixed-ownership files, so they do not
use `merge=ours`. Sekai owns scripts, dependencies, and lock resolution. The
adopter owns package name, description, privacy, and the version mirrored from
`VERSION`. Every upgrade captures those adopter fields before merging, takes the
incoming framework manifests, then restores the captured fields with
`scripts/upgrade/package-state.mjs`. This deterministic reconciliation prevents
recurring framework/adopter version conflicts while still delivering dependency
updates.

Sekai v1.0.8 mistakenly carried a template `VERSION`. The first later upgrade
deletes that framework path, which can produce a modify/delete conflict against
the adopter's copy. Resolve that one path with `git checkout --ours VERSION &&
git add VERSION`. Subsequent Sekai releases do not track `VERSION`, so the conflict
does not recur.

**`merge=ours` protects content, not absence.** It applies to a path that exists on
both sides of the merge. A path you deliberately deleted gets no merge driver at
all: on shared history the framework's change to it becomes a modify/delete
conflict, and on an unrelated-history first merge the framework's whole tree is
added back as theirs-only content. That is exactly the `.agent-toolkit/` case, and
it is why the flows above carry a classify step and a reconcile step.

## Dev-plugin state (`.agent-toolkit/`) — classified on every upgrade

`AGENTS.md` and `.agent-toolkit/**` are the dev-plugin's own files, and whether the
dev workflow is installed is **persistent instance state** the upgrade preserves in
either direction (recorded in the framework's decision records upstream).
`/sekai-upgrade` and the flows
above classify it before merging with
`node scripts/upgrade/dev-plugin-state.mjs classify`:

| State | Means | The upgrade does |
| ----- | ----- | ---------------- |
| `stripped` | `.agent-toolkit/` absent **and** no active `@.agent-toolkit/dev.md` reference in `AGENTS.md`/`CLAUDE.md` | Keeps both absent. `reconcile --state stripped` removes every `.agent-toolkit/` path the merge brought in — conflicted or cleanly added — and amends the merge commit if the merge already committed, so the framework tree is never committed into your instance. You never resolve a dev-plugin conflict by hand. |
| `installed` | your own `.agent-toolkit/dev.md` **and** the active reference are both present | Keeps your config and rules. `merge=ours` does the work; `reconcile --state installed` mutates nothing and asserts your `.agent-toolkit/**` is byte-for-byte unchanged, then reports any framework path the merge *added* under it for you to keep or `git rm -f`. |
| inconsistent | only one half present (a tree with no active reference, or a reference with no tree) | **Stops before merging**, exit 3, with a diagnostic naming both deliberate repairs. The upgrade never guesses whether to delete or install dev-plugin state. |

A wizard-adopted instance is `stripped`: `npm run init` removes `.agent-toolkit/`
and regenerates `AGENTS.md` without the framework's dev-plugin sentinel block, both
being framework-development state rather than adopter content. Framework dev-plugin
state is never reacquired implicitly — running `dev:setup`, which writes your own
config and reference, is the only way in. A framework or first-instance checkout
that keeps its own `.agent-toolkit/` is `installed` and relies on `merge=ours` so a
framework tag never replaces its dev config with the framework's.

## Maintainer-doc state — classified on every upgrade

The framework keeps its own maintainer documents — its product, architecture,
delivery, and decision records — beside the code they govern, and `npm run init`
removes them from your clone: they describe how the framework is built, never how
your instance is operated. Your editorial playbook and this runbook are adopter
docs and always stay.

Their absence has the same problem as an absent `.agent-toolkit/`: `merge=ours`
cannot protect a path you do not have, so without a reconcile step every release
that touched those documents would put the framework's copies back in your tree.
`node scripts/upgrade/maintainer-docs-state.mjs classify` records the split before
the merge, **per path** — the paths are independent, and there is no inconsistent
state to stop on:

| Per-path state | Means | The upgrade does |
| -------------- | ----- | ---------------- |
| `stripped` | you have no document at that path (every wizard-adopted instance, for every path) | Keeps it absent. `reconcile` removes whatever the merge introduced there — conflicted or cleanly added — and amends the merge commit if the merge already committed. You never resolve one of these conflicts by hand. |
| `owned` | you keep your own document at that path | Keeps yours. `reconcile` asserts it came through byte-for-byte and never deletes it, then reports any framework file the merge *added* underneath it for you to keep or `git rm -f`. |

Owning some of these paths and not others is a normal state and never stops the
upgrade. What does stop it is an owned path the merge **changed or conflicted**:
that means the path is not marked `merge=ours` in your `.gitattributes`, or
`merge.ours.driver` is not set in this clone. Both repairs are named in the
diagnostic. The upgrade never lets the framework's copy overwrite a document you
wrote.

The path set is derived from the init wizard's own strip list at runtime rather
than restated, so the upgrade cannot disagree with what adoption removed; if that
list cannot be read, the helper stops instead of assuming there is nothing to
protect.

## Reconciling instance-owned starter files (every upgrade)

`merge=ours` keeps your version of an instance-owned file and **silently drops the
framework's changes** to it. That is what you want for `place.config.ts`,
`knowledge/**`, media, `CHANGELOG.md`, and `VERSION`. But the *content-bearing starter* files the wizard seeded
— `AGENTS.md` above all, and `README.md` — started as framework boilerplate; a
release that improves that boilerplate would vanish with no signal. `CLAUDE.md` is
exempt: it is a pure one-line `@AGENTS.md` shim carrying no content that can diverge,
so if yours is anything but that single line, reset it to the shim rather than
reconciling it. After a merge, diff each content-bearing starter against the tag and
decide, file by file, whether to pull any framework improvement in (the `/sekai-upgrade`
skill does this conversationally):

`FRAMEWORK-VERSION` is merge-protected for a different reason: the merge keeps the old
value, then the final upgrade step bumps it only after verification succeeds.

```bash
# Show where your AGENTS.md diverges from the tag you just merged, then read both
# sides and hand-pick improvements — never a blind overwrite (your edits win by
# default; that is the point of merge=ours).
git diff --no-index -- AGENTS.md <(git show sekai-kb-v1.0.2:AGENTS.md)
# Apply only the lines you want, then: git add AGENTS.md
```
