# UPGRADE — Pulling framework releases into an instance

Companion to `DEPLOY.md`. Every command is copy-pasteable. This is the manual git
flow for non-AI users; the `/upgrade` skill (`.claude/skills/upgrade/`) drives the
identical steps for an AI CLI. Keep the two in sync.

Instances track the sekai-kb framework by merging **immutable release tags, never
framework `main`** (ADR 004, SPEC §Repo topology). A tag is reproducible: everyone
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

# 3. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Releases before v1.0.5 did not ship the helper, so on a first merge run it
#    from a release that does — any tag >= v1.0.5, even when the base you are
#    establishing is older. The extracted copy lives inside .git, never in your tree.
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show sekai-kb-v1.0.5:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"
#    Exit 3 = inconsistent state (only one half of the dev workflow present):
#    stop here and repair it deliberately, as the diagnostic says.

# 4. The first merge — the ONLY one that needs --allow-unrelated-histories:
git merge --allow-unrelated-histories sekai-kb-v1.0.0

# 5. Reconcile dev-plugin state, immediately after the merge command — whether it
#    stopped on conflicts or completed on its own:
node "$HELPER" reconcile --state "$STATE"
```

> **The `merge.ours.driver true` line is load-bearing and per-clone.** It is not
> stored in the repo. A fresh clone of this instance, or a CI checkout that does a
> tag merge, must set it first or `merge=ours` does nothing. `/upgrade` sets it in
> its preflight; the wizard-adopted instance's first `/upgrade` does the same.

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
- **Files only the framework has** (e.g. `.claude/skills/`, `SystemDiagram.astro`)
  — added to your instance.
- **Files only you have** (your docs, research, tracker config) — untouched; a
  merge never deletes a path absent on the incoming side.
- **Framework-owned files you also carry** (`src/`, `scripts/`) — these conflict
  on the first merge, because with unrelated histories git sees both sides as
  having "added" the file. Resolve them to the framework version (the ownership
  rule: `src/` and `scripts/` are framework-owned):

```bash
# Take framework for every remaining (framework-owned) conflict:
for f in $(git diff --name-only --diff-filter=U); do git checkout --theirs "$f" && git add "$f"; done
```

Then remove the template-only marker (an instance is not the template) and any
demo content the merge added. A "Use this template" adopter reseeds via `/adopt`;
an existing instance re-basing onto the framework strips the template's demo
articles so only its own `knowledge/` remains:

```bash
git rm --ignore-unmatch .sekai-template
# Demo articles added by the merge = present in the tag's knowledge/, absent from
# your pre-merge tree. `git merge` set ORIG_HEAD to that pre-merge tree at merge
# start (correct whether or not the merge is committed yet — unlike HEAD@{1}).
# List and remove them (yours are untouched by merge=ours):
comm -13 <(git ls-tree -r --name-only ORIG_HEAD -- knowledge/ | sort) \
         <(git ls-tree -r --name-only sekai-kb-v1.0.0 -- knowledge/ | sort) \
  | while read -r f; do git rm -f -- "$f"; done
```

Build-verify, finalize, record the version:

```bash
npm run build
git commit --no-edit
printf 'v1.0.0\n' > FRAMEWORK-VERSION
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> v1.0.0"
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

# 2. Fetch tags and list releases; pick the target above your FRAMEWORK-VERSION.
git fetch framework --tags
git tag -l 'sekai-kb-v*' | sort -V
cat FRAMEWORK-VERSION

# 3. Read the target's CHANGELOG entry first — especially its Upgrade note.
git show sekai-kb-v1.0.1:CHANGELOG.md | awk '/^## \[1\.0\.1\]/{p=1;print;next} p&&/^## \[/{exit} p'

# 4. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Exit 3 = inconsistent state: stop and repair it deliberately.
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show sekai-kb-v1.0.1:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"

# 5. Merge the tag (never main). merge=ours keeps your content/config.
git merge --no-ff sekai-kb-v1.0.1 -m "chore: upgrade framework to sekai-kb-v1.0.1"

# 6. Reconcile dev-plugin state, immediately after the merge command — whether it
#    stopped on conflicts or completed on its own. Stripped: the framework's
#    .agent-toolkit/ is removed again (conflicts and additions alike) so you never
#    resolve a dev-plugin conflict by hand. Installed: nothing is touched; your
#    config and rules are asserted byte-for-byte unchanged, and any framework path
#    the merge ADDED under .agent-toolkit/ is reported for you to keep or remove.
node "$HELPER" reconcile --state "$STATE"

# 7. If conflicts remain: they can only be framework-owned files you edited locally.
#    Read the CHANGELOG line for each, then take framework unless you intentionally
#    forked it (in which case: upstream it to sekai-kb so it stops conflicting):
git diff --name-only --diff-filter=U
#    git checkout --theirs <file> && git add <file>     # take framework
#    git commit --no-edit                               # finalize the merge

# 8. Build-verify, then record the new version.
npm run build
printf 'v1.0.1\n' > FRAMEWORK-VERSION
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> v1.0.1"
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
| `docs/baselines/**` | instance-captured health/visual baselines |
| `scripts/ci/genericity-denylist.local.txt` | the place's own denylisted terms |
| `.agent-toolkit/**` | dev-plugin state (config + promoted rules) — each repo owns its own |

Adopters add their own instance-specific files to `.gitattributes` the same way.
The list is append-only from the framework baseline; the framework never removes a
`merge=ours` entry, so an upgrade cannot start overwriting a file you own.

**`merge=ours` protects content, not absence.** It applies to a path that exists on
both sides of the merge. A path you deliberately deleted gets no merge driver at
all: on shared history the framework's change to it becomes a modify/delete
conflict, and on an unrelated-history first merge the framework's whole tree is
added back as theirs-only content. That is exactly the `.agent-toolkit/` case, and
it is why the flows above carry a classify step and a reconcile step.

## Dev-plugin state (`.agent-toolkit/`) — classified on every upgrade

`AGENTS.md` and `.agent-toolkit/**` are the dev-plugin's own files, and whether the
dev workflow is installed is **persistent instance state** the upgrade preserves in
either direction (ADR 006 addendum, SPEC §Repo topology). `/upgrade` and the flows
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

## Reconciling instance-owned starter files (every upgrade)

`merge=ours` keeps your version of an instance-owned file and **silently drops the
framework's changes** to it. That is what you want for `place.config.ts`,
`knowledge/**`, and media. But the *content-bearing starter* files the wizard seeded
— `AGENTS.md` above all, and `README.md` — started as framework boilerplate; a
release that improves that boilerplate would vanish with no signal. `CLAUDE.md` is
exempt: it is a pure one-line `@AGENTS.md` shim carrying no content that can diverge,
so if yours is anything but that single line, reset it to the shim rather than
reconciling it. After a merge, diff each content-bearing starter against the tag and
decide, file by file, whether to pull any framework improvement in (the `/upgrade`
skill does this conversationally):

```bash
# Show where your AGENTS.md diverges from the tag you just merged, then read both
# sides and hand-pick improvements — never a blind overwrite (your edits win by
# default; that is the point of merge=ours).
git diff --no-index -- AGENTS.md <(git show sekai-kb-v1.0.2:AGENTS.md)
# Apply only the lines you want, then: git add AGENTS.md
```
