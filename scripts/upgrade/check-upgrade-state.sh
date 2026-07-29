#!/usr/bin/env bash
#
# check-upgrade-state.sh — contract regression harness for the dev-plugin
# upgrade-state helper (`scripts/upgrade/dev-plugin-state.mjs`, LB-44 / ADR 006 /
# SPEC "Repo topology").
#
# The contract under test (CLI only — this harness never re-implements the
# helper's logic; it copies the real file out of this repo and drives it):
#
#   node scripts/upgrade/dev-plugin-state.mjs classify [--repo <dir>]
#   node scripts/upgrade/dev-plugin-state.mjs reconcile --state <stripped|installed> [--repo <dir>]
#
#   dev-plugin tree = `.agent-toolkit/`; dev config = `.agent-toolkit/dev.md`.
#   "active reference" = the literal `@.agent-toolkit/dev.md` in AGENTS.md or
#   CLAUDE.md on a line that is NOT inside an HTML comment (a reference inside a
#   comment is inert).
#     stripped  = tree absent      AND no active reference
#     installed = dev config present AND an active reference present
#     anything else = mixed/inconsistent
#   classify prints exactly `stripped` or `installed` on stdout (exit 0); on a
#   mixed state it prints a diagnostic naming the offending facts and a remedy on
#   STDERR and exits 3.
#   reconcile runs immediately AFTER the merge command, with --state set to what
#   classify printed BEFORE the merge. Exit 0 success / 1 failure / 2 usage.
#     --state stripped  removes every `.agent-toolkit/` path the merge brought in
#                       (modify/delete conflicts and theirs-only additions),
#                       removes any active reference the merge introduced into an
#                       entry file, and amends the merge commit if the merge
#                       already committed — the framework tree is never committed.
#     --state installed mutates nothing: asserts `.agent-toolkit/**` is
#                       byte-for-byte unchanged against the pre-merge revision,
#                       asserts config + active reference survive, and REPORTS
#                       (does not delete) framework paths the merge ADDED.
#
# Cases (each an independent disposable git repo under $(mktemp -d)):
#   0. reconcile usage contract — missing / invalid --state exits 2 and mutates
#      nothing.
#   1. stripped, shared history  — clone at fw-v1, init-wizard strip, merge fw-v2
#      (modify/delete conflict on the dev config), reconcile, finalize.
#   2. stripped, unrelated history — fresh repo, first framework merge with
#      --allow-unrelated-histories; passes whether or not the merge conflicts.
#      Sub-case 2b pins the no-conflict shape (git auto-commits the merge), which
#      is the only shape that exercises the amend path and the "reference the
#      merge introduced into an entry file" clause.
#   3. installed — adopter-owned dev config + rule survive a tag merge byte-for-byte.
#   4. mixed: tree present, reference absent (plus two inert-comment variants).
#   5. mixed: reference active, tree absent (in AGENTS.md and in CLAUDE.md).
#
# Cases 6-10 cover the second helper, `scripts/upgrade/maintainer-docs-state.mjs`
# (ADR 008 addendum). Its contract:
#
#   node scripts/upgrade/maintainer-docs-state.mjs classify  [--repo <dir>] [--from-tag <tag>] [--state <file>]
#   node scripts/upgrade/maintainer-docs-state.mjs reconcile [--repo <dir>] [--from-tag <tag>] [--state <file>]
#   node scripts/upgrade/maintainer-docs-state.mjs paths     [--repo <dir>] [--from-tag <tag>]
#
#   The path set is DERIVED from the init wizard's exported MAINTAINER_DOCS, so
#   this harness derives its fixtures from the same source (`paths`) instead of
#   restating them. `--from-tag` moves only that derivation to the tag being
#   merged; presence is always read from the pre-merge working tree.
#   Classification is PER PATH, with no activation signal and no
#   mixed state:
#     owned    = present before the merge -> never deleted, asserted unchanged
#     stripped = absent  before the merge -> whatever the merge introduced is removed
#   classify records its answer in the git directory; reconcile consumes it after
#   the merge. Exit 0 success / 1 failure / 2 usage / 3 contract underivable.
#
#   6. stripped instance, shared history (modify/delete on every doc path).
#   7. stripped instance, unrelated-history first merge (theirs-only additions;
#      the auto-commit shape exercises the amend path).
#   8. fully owned instance protected by merge=ours: every path byte-for-byte
#      unchanged, and a framework file ADDED under an owned directory is REPORTED,
#      never deleted.
#   9. partially owned instance: per-path outcome, and the run does NOT stop —
#      owning some of these paths and not others is a legitimate adopter state.
#  10. owned but unprotected, in three shapes (no merge=ours attribute; attribute
#      present but merge.ours.driver unset; and the framework's edits merging
#      cleanly so git auto-commits): reconcile stops, names both repairs, and the
#      framework's copy never wins. The undo it prescribes depends on the shape —
#      `git merge --abort` mid-merge, `git reset --hard ORIG_HEAD` once the merge
#      is committed — and the auto-commit sub-case runs the prescribed command and
#      asserts it restores the instance's own documents.
#  11. FIRST upgrade to the release that introduces MAINTAINER_DOCS: the working
#      tree's wizard predates the export, so classify without `--from-tag` cannot
#      derive the path set (exit 3) and `--from-tag <the tag being merged>` must
#      still produce the classification the whole pass depends on.
#
# Case 12 covers the third helper, `scripts/upgrade/package-state.mjs`, on the one
# path `merge=ours` cannot protect:
#
#   node scripts/upgrade/package-state.mjs capture              -> prints the state path
#   node scripts/upgrade/package-state.mjs reconcile <state>
#
#  12. FRAMEWORK-VERSION holds its PRE-MERGE value across the merge and changes
#      only on the explicit post-verification bump. A merge driver runs only on a
#      three-way content merge, so an instance that has not touched the file since
#      the merge base has `ours == base` and git fast-forwards to theirs — the
#      fixture pins that, with the attribute set and the driver configured, before
#      requiring reconcile to undo it. Sub-case 12b is the no-conflict shape, where
#      git auto-commits and reconcile must amend the merge commit.
#
# The documented-bootstrap check closes the loop from the other side: the options
# the adopter-facing upgrade documents tell a user to pass are derived from the
# helper's own option parser, so a renamed flag fails CI rather than leaving a
# runbook that no longer works.
#
# `--selftest` proves the suite is non-vacuous: it re-runs cases 1, 2, 6, 7, 8, 9,
# 10, 11 and 12 with the reconcile step DELIBERATELY SKIPPED and requires each
# case's own assertions to FAIL. A skipped-reconcile run that passes means the case
# cannot detect the regression it exists to guard, and --selftest exits nonzero. No
# reconcile-dependent assertion is gated on the skip toggle, because gating one out
# is how a case silently becomes vacuous.
#
# Fixtures use only generic names (Example / Instance / fw-v1) — this repo is in
# whole-tree template mode, so the genericity + English-only gates scan this file
# and everything it writes into scripts/.
#
# Usage:
#   bash scripts/upgrade/check-upgrade-state.sh             all twelve cases
#   bash scripts/upgrade/check-upgrade-state.sh --selftest  non-vacuity proof
#
# Portability: macOS bash 3.2 + CI bash 5 (no mapfile/readarray, no associative
# arrays, no ${var,,}, CDPATH unset before cd-in-$()).

set -euo pipefail
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"

HELPER_SRC="$ROOT/scripts/upgrade/dev-plugin-state.mjs"
if [ ! -f "$HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $HELPER_SRC" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The helper is driven from a stable copy outside every fixture (exercising
# `--repo`), because a stripped adopter merging the framework for the first time
# (case 2) has no copy of it until the merge lands. Case 1 additionally drives the
# fixture's own committed copy with plain cwd resolution, covering both CLI forms.
HELPER="$TMP/helper/dev-plugin-state.mjs"
mkdir -p "$TMP/helper" "$TMP/nohooks"
cp "$HELPER_SRC" "$HELPER"

MDOCS_HELPER_SRC="$ROOT/scripts/upgrade/maintainer-docs-state.mjs"
if [ ! -f "$MDOCS_HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $MDOCS_HELPER_SRC" >&2
  exit 1
fi
MDOCS_HELPER="$TMP/helper/maintainer-docs-state.mjs"
cp "$MDOCS_HELPER_SRC" "$MDOCS_HELPER"

PACKAGE_HELPER_SRC="$ROOT/scripts/upgrade/package-state.mjs"
if [ ! -f "$PACKAGE_HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $PACKAGE_HELPER_SRC" >&2
  exit 1
fi
PACKAGE_HELPER="$TMP/helper/package-state.mjs"
cp "$PACKAGE_HELPER_SRC" "$PACKAGE_HELPER"

# The maintainer-doc path set under test is DERIVED from the init wizard by the
# helper itself, never restated here — a hardcoded fixture list would keep passing
# after the wizard's strip list changed, which is the drift both the gate and the
# upgrade exist to prevent. Driving the out-of-tree copy against --repo is also the
# shape an instance uses when it extracts the helper from a release tag.
MAINTAINER_DOCS="$(node "$MDOCS_HELPER" paths --repo "$ROOT")" || {
  echo "❌ upgrade-state check FAILED: could not derive the maintainer-doc path set from the wizard" >&2
  exit 1
}
if [ -z "$MAINTAINER_DOCS" ]; then
  echo "❌ upgrade-state check FAILED: the derived maintainer-doc path set is empty" >&2
  exit 1
fi

REF_LINE='Dev workflow (agent-toolkit dev plugin): @.agent-toolkit/dev.md'

fail() {
  echo "❌ upgrade-state check FAILED: $1" >&2
  exit 1
}

ok() { echo "✓ $1"; }

# ---------------------------------------------------------------------------
# Harness-side contract predicates (independent of the implementation)
# ---------------------------------------------------------------------------

# Count active `@.agent-toolkit/dev.md` references in a file: occurrences on
# lines outside HTML comments, with comment state carried across lines so a
# multi-line `<!-- ... -->` block makes every reference inside it inert.
active_ref_count() {
  if [ ! -f "$1" ]; then echo 0; return; fi
  awk '
    function strip(line,   i, j, out) {
      out = ""
      while (length(line) > 0) {
        if (incomment) {
          i = index(line, "-->")
          if (i == 0) return out
          line = substr(line, i + 3)
          incomment = 0
        } else {
          j = index(line, "<!--")
          if (j == 0) return out line
          out = out substr(line, 1, j - 1)
          line = substr(line, j + 4)
          incomment = 1
        }
      }
      return out
    }
    { if (index(strip($0), "@.agent-toolkit/dev.md") > 0) n++ }
    END { print n + 0 }
  ' "$1"
}

assert_no_active_reference() { # dir label
  local f count
  for f in AGENTS.md CLAUDE.md; do
    count="$(active_ref_count "$1/$f")"
    [ "$count" = "0" ] || fail "$2: $f carries $count active @.agent-toolkit/dev.md reference(s) after reconcile"
  done
  ok "$2: no active dev-plugin reference in AGENTS.md / CLAUDE.md"
}

assert_active_reference() { # dir label
  local total
  total=$(( $(active_ref_count "$1/AGENTS.md") + $(active_ref_count "$1/CLAUDE.md") ))
  [ "$total" -gt 0 ] || fail "$2: the adopter's active dev-plugin reference did not survive the merge"
  ok "$2: adopter's active dev-plugin reference survived"
}

assert_no_tree_paths_in_commit() { # dir rev label
  local paths
  paths="$(git -C "$1" ls-tree -r --name-only "$2" | grep '^\.agent-toolkit/' || true)"
  [ -z "$paths" ] || fail "$3: commit $2 carries dev-plugin paths: $(echo "$paths" | tr '\n' ' ')"
  ok "$3: finalized merge commit carries no .agent-toolkit/ path"
}

assert_no_unmerged_paths() { # dir label
  local u
  u="$(git -C "$1" diff --name-only --diff-filter=U)"
  [ -z "$u" ] || fail "$2: unmerged paths remain after reconcile (the user was left to resolve them): $(echo "$u" | tr '\n' ' ')"
  ok "$2: no unmerged paths remain — no dev-plugin conflict reached the user"
}

assert_no_unmerged_tree_paths() { # dir label
  local u
  u="$(git -C "$1" diff --name-only --diff-filter=U | grep '^\.agent-toolkit/' || true)"
  [ -z "$u" ] || fail "$2: dev-plugin paths left unmerged by reconcile: $(echo "$u" | tr '\n' ' ')"
  ok "$2: no .agent-toolkit/ path left unmerged"
}

assert_is_merge_commit() { # dir label
  local parents
  parents="$(git -C "$1" rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')"
  [ "$parents" -ge 3 ] || fail "$2: HEAD is not a merge commit (the framework merge did not happen)"
  ok "$2: HEAD is a real merge commit"
}

# ---------------------------------------------------------------------------
# Helper invocation
# ---------------------------------------------------------------------------

HELPER_STATUS=0
HELPER_OUT=""
HELPER_ERR=""

run_helper() { # dir subcommand [args...]
  local dir="$1"
  shift
  HELPER_STATUS=0
  node "$HELPER" "$@" --repo "$dir" > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

run_helper_in_repo() { # dir subcommand [args...] — cwd form, repo's own copy
  local dir="$1"
  shift
  HELPER_STATUS=0
  ( cd "$dir" && node scripts/upgrade/dev-plugin-state.mjs "$@" ) \
    > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

assert_classify() { # dir label expected
  run_helper "$1" classify
  [ "$HELPER_STATUS" -eq 0 ] || fail "$2: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  [ "$HELPER_OUT" = "$3" ] || fail "$2: classify printed '$HELPER_OUT' on stdout (expected exactly '$3')"
  ok "$2: classify = $3"
}

assert_classify_mixed() { # dir label
  run_helper "$1" classify
  [ "$HELPER_STATUS" -eq 3 ] || fail "$2: classify exited $HELPER_STATUS (expected 3 for a mixed state); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "$2: classify exited 3 with no diagnostic on stderr"
  printf '%s' "$HELPER_ERR" | grep -q '\.agent-toolkit' \
    || fail "$2: mixed-state diagnostic does not name the offending dev-plugin facts: $HELPER_ERR"
  printf '%s' "$HELPER_ERR" | grep -Eiq 'remed|fix|resolve|restore|re-add|re-run|rerun|remove|delete' \
    || fail "$2: mixed-state diagnostic names no remedy: $HELPER_ERR"
  if printf '%s' "$HELPER_OUT" | grep -Eq 'stripped|installed'; then
    fail "$2: classify leaked a state verdict on stdout for a mixed state: '$HELPER_OUT'"
  fi
  ok "$2: classify exits 3, diagnoses on stderr with a remedy, prints no verdict on stdout"
}

# reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_reconcile() { # dir state label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: reconcile --state $2 DELIBERATELY SKIPPED)"
    HELPER_STATUS=0
    HELPER_OUT=""
    HELPER_ERR=""
    return 0
  fi
  run_helper "$1" reconcile --state "$2"
}

assert_reconcile_ok() { # dir state label
  run_reconcile "$1" "$2" "$3"
  [ "$HELPER_STATUS" -eq 0 ] \
    || fail "$3: reconcile --state $2 exited $HELPER_STATUS (expected 0); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ "${SKIP_RECONCILE:-0}" = "1" ] || ok "$3: reconcile --state $2 exited 0"
}

# ---------------------------------------------------------------------------
# Maintainer-doc helper invocation (ADR 008 addendum)
# ---------------------------------------------------------------------------

run_mdocs() { # dir subcommand [args...]
  local dir="$1"
  shift
  HELPER_STATUS=0
  node "$MDOCS_HELPER" "$@" --repo "$dir" > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

# Sorted, space-separated tokens from a comma-separated helper field, so an
# assertion does not depend on the order the wizard happens to list paths in.
# The helper prints the literal `none` for an empty side; that is the same
# assertion as an empty expectation, so it normalizes away.
# `sed` rather than `grep -v`: an empty result is a legitimate answer here, and a
# grep that filters every line exits 1, which `set -e` turns into a silent abort.
normalize_list() { # raw
  printf '%s' "$1" | tr ', ' '\n\n' | sed '/^$/d; /^none$/d' | sort | paste -sd ' ' -
}

mdocs_field() { # field — reads the classify output in $HELPER_OUT
  printf '%s\n' "$HELPER_OUT" | sed -n "s/^maintainer-docs-state: $1: //p"
}

assert_mdocs_classify() { # dir label expected-owned expected-stripped [extra classify args...]
  local dir="$1" label="$2" want_owned="$3" want_stripped="$4"
  local owned stripped
  shift 4
  run_mdocs "$dir" classify "$@"
  [ "$HELPER_STATUS" -eq 0 ] || fail "$label: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  owned="$(normalize_list "$(mdocs_field owned)")"
  stripped="$(normalize_list "$(mdocs_field stripped)")"
  [ "$owned" = "$(normalize_list "$want_owned")" ] \
    || fail "$label: classify reported owned='$owned' (expected '$(normalize_list "$want_owned")')"
  [ "$stripped" = "$(normalize_list "$want_stripped")" ] \
    || fail "$label: classify reported stripped='$stripped' (expected '$(normalize_list "$want_stripped")')"
  ok "$label: classify — owned: ${owned:-none} | stripped: ${stripped:-none}"
}

# reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_mdocs_reconcile() { # dir label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: maintainer-docs reconcile DELIBERATELY SKIPPED)"
    HELPER_STATUS=0
    HELPER_OUT=""
    HELPER_ERR=""
    return 0
  fi
  run_mdocs "$1" reconcile
}

assert_mdocs_reconcile_ok() { # dir label
  run_mdocs_reconcile "$1" "$2"
  [ "$HELPER_STATUS" -eq 0 ] \
    || fail "$2: reconcile exited $HELPER_STATUS (expected 0); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ "${SKIP_RECONCILE:-0}" = "1" ] || ok "$2: reconcile exited 0"
}

# An owned path the merge touched must STOP the upgrade and name both repairs.
# Routed through run_mdocs_reconcile so --selftest can skip it: an upgrade that
# does NOT stop is exactly the regression this assertion guards.
assert_mdocs_reconcile_stops() { # dir label
  run_mdocs_reconcile "$1" "$2"
  [ "$HELPER_STATUS" -ne 0 ] \
    || fail "$2: reconcile exited 0 on an unprotected owned path — the framework copy was allowed to win"
  [ -n "$HELPER_ERR" ] || fail "$2: reconcile failed with no diagnostic on stderr"
  printf '%s' "$HELPER_ERR" | grep -q 'merge=ours' \
    || fail "$2: the diagnostic does not name the missing .gitattributes marking: $HELPER_ERR"
  printf '%s' "$HELPER_ERR" | grep -q 'merge.ours.driver' \
    || fail "$2: the diagnostic does not name the per-clone driver repair: $HELPER_ERR"
  ok "$2: reconcile stops and names both repairs (attribute + per-clone driver)"
}

# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

# Every fixture repo carries the wizard, because the helper derives the path set
# from it rather than from a list of its own.
write_wizard() { # dir
  local rel
  mkdir -p "$1/scripts/init"
  {
    printf 'export const MAINTAINER_DOCS = [\n'
    for rel in $MAINTAINER_DOCS; do printf "  '%s',\n" "$rel"; done
    printf '];\n'
  } > "$1/scripts/init/writer.mjs"
}

# A wizard from BEFORE the strip list was exported. This is the tree an instance
# really has on its first upgrade to the release that introduces MAINTAINER_DOCS:
# the docs already exist, the export does not, so the path set can only come from
# the tag being merged.
write_legacy_wizard() { # dir
  mkdir -p "$1/scripts/init"
  printf 'export const PLACEHOLDER_SETTINGS = { seeded: true };\n' > "$1/scripts/init/writer.mjs"
}

# A file path gets a file; a directory path gets one record inside it.
write_maintainer_docs() { # dir marker
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md)
        mkdir -p "$1/$(dirname "$rel")"
        printf '# Maintainer doc: %s (%s)\n' "$rel" "$2" > "$1/$rel"
        ;;
      *)
        mkdir -p "$1/$rel"
        printf '# Decision record 001 (%s)\n' "$2" > "$1/$rel/001-example.md"
        ;;
    esac
  done
}

# The init wizard's strip, as an adopter's tree really looks afterwards.
strip_maintainer_docs() { # dir
  local rel
  for rel in $MAINTAINER_DOCS; do rm -rf "$1/$rel"; done
}

first_doc_file() { # — the first file-shaped maintainer-doc path
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in *.md) printf '%s' "$rel"; return ;; esac
  done
  fail "fixture: the derived maintainer-doc set contains no file-shaped path"
}

assert_maintainer_docs_absent() { # dir label
  local rel
  for rel in $MAINTAINER_DOCS; do
    [ ! -e "$1/$rel" ] || fail "$2: $rel survives in the working tree"
    [ -z "$(git -C "$1" ls-files -- "$rel")" ] || fail "$2: $rel is still tracked in the index"
    [ -z "$(git -C "$1" ls-files -u -- "$rel")" ] || fail "$2: $rel still has unmerged entries"
  done
  ok "$2: no maintainer-doc path in the working tree or the index"
}

assert_maintainer_docs_not_in_commit() { # dir rev label
  local rel paths
  for rel in $MAINTAINER_DOCS; do
    paths="$(git -C "$1" ls-tree -r --name-only "$2" -- "$rel")"
    [ -z "$paths" ] || fail "$3: commit $2 carries maintainer-doc path(s): $(echo "$paths" | tr '\n' ' ')"
  done
  ok "$3: finalized merge commit carries no maintainer-doc path"
}

configure_repo() { # dir
  git -C "$1" config user.email "harness@example.invalid"
  git -C "$1" config user.name "Upgrade Harness"
  git -C "$1" config commit.gpgsign false
  git -C "$1" config tag.gpgsign false
  git -C "$1" config merge.ours.driver true   # required for merge=ours (docs/runbook/UPGRADE.md)
  git -C "$1" config core.hooksPath "$TMP/nohooks"
}

init_repo() { # dir
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" symbolic-ref HEAD refs/heads/main
  configure_repo "$1"
}

write_gitattributes() { # dir — byte-identical in framework and instances
  cat > "$1/.gitattributes" <<'EOF'
AGENTS.md merge=ours
CLAUDE.md merge=ours
CHANGELOG.md merge=ours
VERSION merge=ours
FRAMEWORK-VERSION merge=ours
place.config.ts merge=ours
.agent-toolkit/** merge=ours
EOF
}

# An instance that owns documents at the maintainer-doc paths must mark them
# instance-owned BEFORE its first merge of a release that carries them; a file path
# takes the path itself, a directory path takes a `/**` glob.
append_maintainer_doc_attributes() { # dir
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) printf '%s merge=ours\n' "$rel" >> "$1/.gitattributes" ;;
      *) printf '%s/** merge=ours\n' "$rel" >> "$1/.gitattributes" ;;
    esac
  done
}

write_dev_config() { # file marker
  cat > "$1" <<EOF
---
tracker: linear
context_file: AGENTS.md
rules_dir: .agent-toolkit/rules/
---

# Example dev config ($2)
EOF
}

# Framework AGENTS.md: dev-plugin block between sentinels, reference on the last
# line inside the block (the shape the init wizard strips).
write_framework_agents_md() { # file
  cat > "$1" <<EOF
# Example Framework

Template instructions for the Example framework.

<!-- dev-plugin:start - the init wizard strips this block, and the
     .agent-toolkit/ tree it points at, from adopter clones. Framework state only. -->
## Framework development

This repository is developed with the agent-toolkit dev plugin. Adopters do not
need any of this.

$REF_LINE
<!-- dev-plugin:end -->
EOF
}

write_instance_agents_md() { # file variant
  case "$2" in
    no-reference)
      cat > "$1" <<'EOF'
# Example Instance

Instance instructions. This instance keeps no dev-plugin state.
EOF
      ;;
    active-reference)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. This instance runs the dev plugin.

## Dev workflow

$REF_LINE
EOF
      ;;
    inert-reference-inline)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. The reference below is commented out and therefore inert.

<!-- $REF_LINE -->
EOF
      ;;
    inert-reference-block)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. The reference below sits inside a multi-line HTML comment
and is therefore inert.

<!-- dev-plugin:start - disabled for this instance.
## Dev workflow

$REF_LINE
<!-- dev-plugin:end -->
EOF
      ;;
    *) fail "unknown AGENTS.md variant: $2" ;;
  esac
}

write_instance_changelog() { # file
  cat > "$1" <<'EOF'
# Instance changelog

Instance-only sentinel. Framework upgrades must preserve these bytes.
EOF
}

assert_instance_changelog() { # repo label
  grep -Fq 'Instance-only sentinel' "$1/CHANGELOG.md" \
    || fail "$2: framework CHANGELOG.md replaced the instance changelog"
  if grep -Fq 'Framework release fw-v2' "$1/CHANGELOG.md"; then
    fail "$2: framework release history leaked into the instance changelog"
  fi
  ok "$2: instance CHANGELOG.md is preserved"
}

write_instance_framework_version() { # file
  printf 'instance-v1\n' > "$1"
}

write_instance_version() { # file
  printf 'adopter-v7\n' > "$1"
}

assert_instance_framework_version() { # repo label
  [ "$(cat "$1/FRAMEWORK-VERSION")" = "instance-v1" ] \
    || fail "$2: framework merge replaced FRAMEWORK-VERSION before the explicit bump"
  ok "$2: FRAMEWORK-VERSION is preserved through the merge"
}

assert_instance_version() { # repo label
  [ "$(cat "$1/VERSION")" = "adopter-v7" ] \
    || fail "$2: framework merge replaced the adopter's VERSION"
  ok "$2: adopter VERSION is preserved"
}

# Framework repo carrying legacy fw-v1 (which mistakenly tracked VERSION) and
# corrected fw-v2 (which deletes it so only adopters carry VERSION).
build_framework() { # dir [legacy-wizard]
  local fw="$1"
  init_repo "$fw"
  mkdir -p "$fw/.agent-toolkit/rules" "$fw/src" "$fw/scripts/upgrade"
  write_framework_agents_md "$fw/AGENTS.md"
  write_dev_config "$fw/.agent-toolkit/dev.md" "fw-v1"
  cat > "$fw/.agent-toolkit/rules/example-rule.md" <<'EOF'
---
tier: doctrine
---
# Example rule (framework-owned, fw-v1)
EOF
  write_gitattributes "$fw"
  if [ "${2:-}" = "legacy-wizard" ]; then write_legacy_wizard "$fw"; else write_wizard "$fw"; fi
  write_maintainer_docs "$fw" "fw-v1"
  # Adopter-facing docs live beside the maintainer docs and must survive the strip
  # and every upgrade — the other half of the ownership boundary.
  mkdir -p "$fw/docs/playbook"
  printf '# Editorial canon (adopter-facing, survives adoption)\n' > "$fw/docs/playbook/keep.md"
  printf '# Framework changelog\n\nFramework release fw-v1.\n' > "$fw/CHANGELOG.md"
  printf 'template-v1\n' > "$fw/VERSION"
  printf 'framework-v1\n' > "$fw/FRAMEWORK-VERSION"
  printf 'export const place = { name: "Example", tagline: "The framework demo place." };\n' > "$fw/place.config.ts"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  cp "$HELPER_SRC" "$fw/scripts/upgrade/dev-plugin-state.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1"
  git -C "$fw" tag fw-v1

  write_dev_config "$fw/.agent-toolkit/dev.md" "fw-v2"
  cat > "$fw/.agent-toolkit/rules/new-rule.md" <<'EOF'
---
tier: gotcha
triggers:
  paths:
    - "src/**"
---
# New rule (framework-owned, added in fw-v2)
EOF
  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  # fw-v2 always exports the strip list, so a `legacy-wizard` framework models the
  # release that INTRODUCES it — the first-upgrade shape case 11 drives.
  write_wizard "$fw"
  # fw-v2 CHANGES every maintainer doc (so a stripped instance on shared history
  # hits the modify/delete case) and ADDS one record the instance cannot have (so
  # the owned case exercises the report-never-delete rule).
  write_maintainer_docs "$fw" "fw-v2"
  local docdir
  for docdir in $MAINTAINER_DOCS; do
    case "$docdir" in
      *.md) ;;
      *) printf '# Decision record 002 (added in fw-v2)\n' > "$fw/$docdir/002-added-in-fw-v2.md" ;;
    esac
  done
  printf '# Framework changelog\n\nFramework release fw-v2.\n' > "$fw/CHANGELOG.md"
  rm "$fw/VERSION"
  printf 'framework-v2\n' > "$fw/FRAMEWORK-VERSION"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

# Common instance skeleton (no AGENTS.md, no dev-plugin state, not committed).
lay_instance_skeleton() { # dir
  mkdir -p "$1/src" "$1/scripts/upgrade"
  write_gitattributes "$1"
  write_wizard "$1"   # framework scripts survive adoption; the strip removes docs, not the wizard
  printf 'export const place = { name: "Instance", tagline: "The adopting instance." };\n' > "$1/place.config.ts"
  printf 'export const INSTANCE_APP = "instance-local";\n' > "$1/src/app.js"
  printf '@AGENTS.md\n' > "$1/CLAUDE.md"
  write_instance_changelog "$1/CHANGELOG.md"
  write_instance_version "$1/VERSION"
  write_instance_framework_version "$1/FRAMEWORK-VERSION"
  cp "$HELPER_SRC" "$1/scripts/upgrade/dev-plugin-state.mjs"
}

clone_at_v1() { # framework-dir dest
  git clone -q "$1" "$2"
  configure_repo "$2"
  git -C "$2" checkout -q -B main fw-v1
  write_instance_changelog "$2/CHANGELOG.md"
  write_instance_version "$2/VERSION"
  write_instance_framework_version "$2/FRAMEWORK-VERSION"
}

# Resolve any conflict the harness itself is responsible for finishing, then
# commit. Instance-owned entry/config files take OURS (that is what merge=ours
# declares them to be); framework-owned code takes THEIRS. Dev-plugin paths are
# never touched here — resolving them is reconcile's job and is asserted before
# this runs.
finalize_merge() { # dir label
  local path
  git -C "$1" diff --name-only --diff-filter=U | while IFS= read -r path; do
    case "$path" in
      AGENTS.md|CLAUDE.md|CHANGELOG.md|VERSION|FRAMEWORK-VERSION|place.config.ts)
        git -C "$1" checkout --ours -- "$path" 2>/dev/null || true
        ;;
      *)
        git -C "$1" checkout --theirs -- "$path" 2>/dev/null || true
        ;;
    esac
    git -C "$1" add -A -- "$path"
  done
  if git -C "$1" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    git -C "$1" commit -q --no-edit || fail "$2: could not finalize the merge commit"
  fi
}

# ---------------------------------------------------------------------------
# Case 1 — stripped instance, shared history
# ---------------------------------------------------------------------------
case_stripped_shared_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # Simulate the init wizard's strip: remove the tree and the reference.
  rm -rf "$inst/.agent-toolkit"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework: strip dev-plugin state"

  # cwd form, from the instance's own committed copy of the helper.
  run_helper_in_repo "$inst" classify
  [ "$HELPER_STATUS" -eq 0 ] || fail "case 1: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  [ "$HELPER_OUT" = "stripped" ] || fail "case 1: classify printed '$HELPER_OUT' (expected exactly 'stripped')"
  ok "case 1: classify = stripped (cwd form, repo's own copy of the helper)"

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 1: the fw-v2 merge did not stop on the dev-config modify/delete conflict (fixture no longer exercises the contract)"
  git -C "$inst" diff --name-only --diff-filter=U | grep -q '^\.agent-toolkit/dev\.md$' \
    || fail "case 1: expected .agent-toolkit/dev.md to be the unmerged modify/delete path"
  ok "case 1: fw-v2 merge stops on the .agent-toolkit/dev.md modify/delete conflict"

  assert_reconcile_ok "$inst" stripped "case 1"
  git -C "$inst" diff --name-only --diff-filter=U | grep -qx 'VERSION' \
    || fail "case 1: expected the one-time VERSION modify/delete conflict after dev-plugin reconciliation"
  ok "case 1: one-time framework VERSION deletion leaves the adopter VERSION for explicit resolution"
  finalize_merge "$inst" "case 1"

  assert_is_merge_commit "$inst" "case 1"
  assert_no_tree_paths_in_commit "$inst" HEAD "case 1"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 1: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst" "case 1"

  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 1: the framework's non-dev-plugin change (src/app.js at fw-v2) did not land — reconcile discarded the merge"
  ok "case 1: the framework's non-dev-plugin change (src/app.js @ fw-v2) landed"
  assert_instance_changelog "$inst" "case 1"
  assert_instance_version "$inst" "case 1"
  assert_instance_framework_version "$inst" "case 1"

  # 1b — the same stripped shared-history upgrade run from a LINKED GIT WORKTREE
  # (`git worktree add`), not a standalone clone. Git answers `rev-parse
  # --git-path MERGE_HEAD` with an ABSOLUTE path there
  # (`<main>/.git/worktrees/<name>/MERGE_HEAD`) instead of the repo-relative
  # `.git/MERGE_HEAD`, so a helper that resolves it as repo-relative misses the
  # file, believes the merge already committed, and runs `git commit --amend`
  # mid-merge — which git refuses. Review finding B1 on PR #16.
  local inst_wt wt
  inst_wt="$work/instance-worktree-main"
  wt="$work/instance-worktree-linked"
  clone_at_v1 "$fw" "$inst_wt"
  rm -rf "$inst_wt/.agent-toolkit"
  write_instance_agents_md "$inst_wt/AGENTS.md" no-reference
  git -C "$inst_wt" add -A
  git -C "$inst_wt" commit -q -m "Adopt Example framework: strip dev-plugin state"
  git -C "$inst_wt" worktree add -q "$wt" -b upgrade-in-worktree HEAD

  # Fixture guard: this must really be a linked worktree (.git is a file there).
  [ -f "$wt/.git" ] || fail "case 1b: fixture is not a linked worktree (.git is not a gitfile)"
  case "$(git -C "$wt" rev-parse --git-path MERGE_HEAD)" in
    /*) : ;;
    *) fail "case 1b: fixture guard — git no longer answers --git-path absolutely in a linked worktree, so the topology under test is gone" ;;
  esac
  assert_classify "$wt" "case 1b" stripped

  merge_status=0
  git -C "$wt" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 1b: the fw-v2 merge did not stop on the dev-config modify/delete conflict (fixture no longer exercises the in-progress path)"
  git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
    || fail "case 1b: fixture guard — no merge in progress after the conflicting merge"
  ok "case 1b: linked-worktree upgrade stops mid-merge with MERGE_HEAD set"

  assert_reconcile_ok "$wt" stripped "case 1b"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
      || fail "case 1b: reconcile finalized or amended the merge instead of leaving it in progress — it misread the linked worktree's MERGE_HEAD path"
    ok "case 1b: reconcile took the merge-in-progress path (did not try to amend)"
  fi
  git -C "$wt" diff --name-only --diff-filter=U | grep -qx 'VERSION' \
    || fail "case 1b: expected the one-time VERSION modify/delete conflict"
  finalize_merge "$wt" "case 1b"
  assert_is_merge_commit "$wt" "case 1b"
  assert_no_tree_paths_in_commit "$wt" HEAD "case 1b"
  [ ! -e "$wt/.agent-toolkit" ] || fail "case 1b: .agent-toolkit/ survives in the linked worktree"
  assert_no_active_reference "$wt" "case 1b"
  assert_instance_changelog "$wt" "case 1b"
  assert_instance_version "$wt" "case 1b"
  assert_instance_framework_version "$wt" "case 1b"
}

# ---------------------------------------------------------------------------
# Case 2 — stripped instance, unrelated history, first framework merge
# ---------------------------------------------------------------------------
case_stripped_unrelated_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"

  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance, own history"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 2: fixture is not stripped"

  assert_classify "$inst" "case 2" stripped

  git -C "$inst" remote add framework "$fw"
  git -C "$inst" fetch -q framework --tags
  # The merge may or may not conflict depending on fixture shape; both shapes are
  # in contract (the no-conflict shape is the amend path).
  git -C "$inst" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    ok "case 2: unrelated-history merge stopped with conflicts (merge in progress)"
  else
    ok "case 2: unrelated-history merge auto-committed (reconcile must take the amend path)"
  fi

  assert_reconcile_ok "$inst" stripped "case 2"
  assert_no_unmerged_tree_paths "$inst" "case 2"
  finalize_merge "$inst" "case 2"

  assert_is_merge_commit "$inst" "case 2"
  assert_no_tree_paths_in_commit "$inst" HEAD "case 2"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 2: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst" "case 2"
  assert_instance_changelog "$inst" "case 2"
  assert_instance_version "$inst" "case 2"
  assert_instance_framework_version "$inst" "case 2"

  # 2b — the same unrelated-history first merge, shaped so the merge COMPLETES
  # WITHOUT CONFLICTS (every framework path is theirs-only or merge=ours). This
  # is the amend path: git auto-commits the merge with `.agent-toolkit/**` and
  # the framework's own AGENTS.md (active reference) in the tree, so reconcile
  # must rewrite that commit rather than resolve an index.
  local inst2="$work/instance-autocommit"
  init_repo "$inst2"
  mkdir -p "$inst2/src"
  write_gitattributes "$inst2"
  printf 'export const place = { name: "Instance", tagline: "The adopting instance." };\n' > "$inst2/place.config.ts"
  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$inst2/src/app.js"
  write_instance_changelog "$inst2/CHANGELOG.md"
  write_instance_version "$inst2/VERSION"
  write_instance_framework_version "$inst2/FRAMEWORK-VERSION"
  git -C "$inst2" add -A
  git -C "$inst2" commit -q -m "Example instance without entry files, own history"

  assert_classify "$inst2" "case 2b" stripped

  git -C "$inst2" remote add framework "$fw"
  git -C "$inst2" fetch -q framework --tags
  git -C "$inst2" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst2" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 2b: fixture no longer auto-commits the merge, so the amend path is not exercised"
  fi
  git -C "$inst2" ls-tree -r --name-only HEAD | grep -q '^\.agent-toolkit/' \
    || fail "case 2b: fixture guard — the auto-committed merge did not bring in .agent-toolkit/ (nothing to amend)"
  [ "$(active_ref_count "$inst2/AGENTS.md")" -gt 0 ] \
    || fail "case 2b: fixture guard — the auto-committed merge did not introduce an active reference into AGENTS.md"
  ok "case 2b: unrelated-history merge auto-committed with .agent-toolkit/ and an active reference in the tree"

  assert_reconcile_ok "$inst2" stripped "case 2b"
  assert_is_merge_commit "$inst2" "case 2b"
  assert_no_tree_paths_in_commit "$inst2" HEAD "case 2b"
  [ ! -e "$inst2/.agent-toolkit" ] || fail "case 2b: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst2" "case 2b"
  assert_instance_changelog "$inst2" "case 2b"
  assert_instance_version "$inst2" "case 2b"
  assert_instance_framework_version "$inst2" "case 2b"
  local dirty
  dirty="$(git -C "$inst2" status --porcelain)"
  [ -z "$dirty" ] || fail "case 2b: reconcile left the amended merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 2b: reconcile amended the merge commit itself (working tree clean)"
}

# ---------------------------------------------------------------------------
# Case 3 — installed instance: adopter-owned dev-plugin state preserved
# ---------------------------------------------------------------------------
case_installed_preserved() { # workdir
  local work="$1" fw inst keep
  fw="$work/fw"
  inst="$work/instance"
  keep="$work/expected"
  mkdir -p "$work" "$keep"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # Adopter-owned dev-plugin state: own dev config content, own rule, own
  # AGENTS.md carrying an active (uncommented) reference line.
  cat > "$inst/.agent-toolkit/dev.md" <<'EOF'
---
tracker: linear
context_file: AGENTS.md
rules_dir: .agent-toolkit/rules/
---

# Instance dev config (adopter-owned, must survive every framework merge)

This content belongs to the instance, not to the framework.
EOF
  cat > "$inst/.agent-toolkit/rules/adopter-sentinel.md" <<'EOF'
---
tier: doctrine
---
# Adopter sentinel rule

Written by the adopting instance. A framework merge must not touch these bytes.
EOF
  write_instance_agents_md "$inst/AGENTS.md" active-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance dev-plugin state"

  cp "$inst/.agent-toolkit/dev.md" "$keep/dev.md"
  cp "$inst/.agent-toolkit/rules/adopter-sentinel.md" "$keep/adopter-sentinel.md"

  assert_classify "$inst" "case 3" installed

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  assert_reconcile_ok "$inst" installed "case 3"

  # Reported, not deleted: the framework path the merge ADDED under .agent-toolkit/.
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -q 'new-rule\.md' \
      || fail "case 3: reconcile did not report the framework path the merge added (.agent-toolkit/rules/new-rule.md); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
    ok "case 3: reconcile reports the framework-added .agent-toolkit/rules/new-rule.md"
    [ -f "$inst/.agent-toolkit/rules/new-rule.md" ] \
      || fail "case 3: reconcile --state installed DELETED the framework-added path (it must report, not delete)"
    ok "case 3: reconcile --state installed deleted nothing"
  fi

  finalize_merge "$inst" "case 3"

  [ -f "$inst/.agent-toolkit/dev.md" ] || fail "case 3: the adopter's .agent-toolkit/dev.md was deleted by the merge"
  [ -f "$inst/.agent-toolkit/rules/adopter-sentinel.md" ] || fail "case 3: the adopter's rule file was deleted by the merge"
  cmp "$inst/.agent-toolkit/dev.md" "$keep/dev.md" \
    || fail "case 3: the adopter's .agent-toolkit/dev.md is not byte-for-byte identical after the merge"
  cmp "$inst/.agent-toolkit/rules/adopter-sentinel.md" "$keep/adopter-sentinel.md" \
    || fail "case 3: the adopter's rule file is not byte-for-byte identical after the merge"
  ok "case 3: adopter dev config and rule are byte-for-byte unchanged (cmp)"

  assert_active_reference "$inst" "case 3"
  assert_classify "$inst" "case 3 (post-merge)" installed
  assert_instance_changelog "$inst" "case 3"
  assert_instance_version "$inst" "case 3"
  assert_instance_framework_version "$inst" "case 3"
}

# ---------------------------------------------------------------------------
# Case 4 — mixed: dev-plugin tree present, no active reference
# ---------------------------------------------------------------------------
case_mixed_tree_without_reference() { # workdir
  local work="$1" variant inst
  mkdir -p "$work"
  for variant in no-reference inert-reference-inline inert-reference-block; do
    inst="$work/$variant"
    init_repo "$inst"
    lay_instance_skeleton "$inst"
    mkdir -p "$inst/.agent-toolkit/rules"
    write_dev_config "$inst/.agent-toolkit/dev.md" "instance"
    cat > "$inst/.agent-toolkit/rules/example-rule.md" <<'EOF'
---
tier: doctrine
---
# Example rule (instance)
EOF
    write_instance_agents_md "$inst/AGENTS.md" "$variant"
    git -C "$inst" add -A
    git -C "$inst" commit -q -m "Mixed state: tree present, $variant"

    # Fixture guard: the harness's own reader must agree the reference is inert.
    [ "$(active_ref_count "$inst/AGENTS.md")" = "0" ] \
      || fail "case 4/$variant: fixture is not actually reference-free (harness reader found an active reference)"
    assert_classify_mixed "$inst" "case 4/$variant (tree present, reference $variant)"
  done
}

# ---------------------------------------------------------------------------
# Case 5 — mixed: active reference, dev-plugin tree absent
# ---------------------------------------------------------------------------
case_mixed_reference_without_tree() { # workdir
  local work="$1" entry inst
  mkdir -p "$work"
  for entry in AGENTS.md CLAUDE.md; do
    inst="$work/${entry%.md}"
    init_repo "$inst"
    lay_instance_skeleton "$inst"
    if [ "$entry" = "AGENTS.md" ]; then
      write_instance_agents_md "$inst/AGENTS.md" active-reference
    else
      write_instance_agents_md "$inst/AGENTS.md" no-reference
      printf '@AGENTS.md\n\n%s\n' "$REF_LINE" > "$inst/CLAUDE.md"
    fi
    git -C "$inst" add -A
    git -C "$inst" commit -q -m "Mixed state: active reference in $entry, no tree"

    [ ! -e "$inst/.agent-toolkit" ] || fail "case 5/$entry: fixture unexpectedly has a dev-plugin tree"
    [ "$(active_ref_count "$inst/$entry")" -gt 0 ] \
      || fail "case 5/$entry: fixture has no active reference (harness reader)"
    assert_classify_mixed "$inst" "case 5/$entry (active reference, tree absent)"
  done
}

# ---------------------------------------------------------------------------
# Usage contract — reconcile exits 2 on a usage error (never 0, never a mutation)
# ---------------------------------------------------------------------------
case_usage_errors() { # workdir
  local work="$1" inst before after
  inst="$work/instance"
  mkdir -p "$work"
  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance"
  before="$(git -C "$inst" rev-parse HEAD)"

  run_helper "$inst" reconcile
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "usage: reconcile without --state exited $HELPER_STATUS (expected 2); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "usage: reconcile without --state exited 2 with no message on stderr"
  ok "usage: reconcile without --state exits 2 with a stderr message"

  run_helper "$inst" reconcile --state bogus
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "usage: reconcile --state bogus exited $HELPER_STATUS (expected 2); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "usage: reconcile --state bogus exited 2 with no message on stderr"
  ok "usage: reconcile --state bogus exits 2 with a stderr message"

  after="$(git -C "$inst" rev-parse HEAD)"
  [ "$before" = "$after" ] || fail "usage: a usage error moved HEAD"
  [ -z "$(git -C "$inst" status --porcelain)" ] || fail "usage: a usage error dirtied the working tree"
  ok "usage: neither usage error touched HEAD or the working tree"
}

# ---------------------------------------------------------------------------
# Case 6 — maintainer docs: stripped instance, shared history
# ---------------------------------------------------------------------------
case_mdocs_stripped_shared_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # The init wizard's strip: an adopted instance carries none of these paths.
  strip_maintainer_docs "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework: strip maintainer docs"

  assert_mdocs_classify "$inst" "case 6" "" "$MAINTAINER_DOCS"

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 6: the fw-v2 merge did not stop on a maintainer-doc modify/delete conflict (fixture no longer exercises the contract)"
  git -C "$inst" diff --name-only --diff-filter=U | grep -q "^$(first_doc_file)$" \
    || fail "case 6: expected $(first_doc_file) among the unmerged modify/delete paths"
  ok "case 6: fw-v2 merge stops on the maintainer-doc modify/delete conflict"

  assert_mdocs_reconcile_ok "$inst" "case 6"
  assert_maintainer_docs_absent "$inst" "case 6"
  finalize_merge "$inst" "case 6"

  assert_is_merge_commit "$inst" "case 6"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 6"
  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 6: the framework's non-doc change (src/app.js at fw-v2) did not land — reconcile discarded the merge"
  ok "case 6: the framework's non-doc change (src/app.js @ fw-v2) landed"
  [ -f "$inst/docs/playbook/keep.md" ] || fail "case 6: the adopter-facing doc tree did not survive the upgrade"
  ok "case 6: adopter-facing docs/playbook/ survives"
}

# ---------------------------------------------------------------------------
# Case 7 — maintainer docs: stripped instance, unrelated history, first merge
# ---------------------------------------------------------------------------
case_mdocs_stripped_unrelated_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"

  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance, own history"

  assert_mdocs_classify "$inst" "case 7" "" "$MAINTAINER_DOCS"

  git -C "$inst" remote add framework "$fw"
  git -C "$inst" fetch -q framework --tags
  git -C "$inst" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    ok "case 7: unrelated-history merge stopped with conflicts (merge in progress)"
  else
    git -C "$inst" ls-tree -r --name-only HEAD -- "$(first_doc_file)" | grep -q . \
      || fail "case 7: fixture guard — the auto-committed merge did not bring in the maintainer docs (nothing to amend)"
    ok "case 7: unrelated-history merge auto-committed the framework's maintainer docs (reconcile must amend)"
  fi

  assert_mdocs_reconcile_ok "$inst" "case 7"
  assert_maintainer_docs_absent "$inst" "case 7"
  finalize_merge "$inst" "case 7"

  assert_is_merge_commit "$inst" "case 7"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 7"
  local dirty
  dirty="$(git -C "$inst" status --porcelain)"
  [ -z "$dirty" ] || fail "case 7: reconcile left the merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 7: working tree clean after the upgrade"
}

# ---------------------------------------------------------------------------
# Case 8 — maintainer docs: fully owned instance, protected by merge=ours
# ---------------------------------------------------------------------------
case_mdocs_owned_preserved() { # workdir
  local work="$1" fw inst keep rel docdir
  fw="$work/fw"
  inst="$work/instance"
  keep="$work/expected"
  mkdir -p "$work" "$keep"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # The instance keeps documents at every maintainer-doc path, with its own
  # content, and marks them instance-owned before merging.
  write_maintainer_docs "$inst" "instance-owned"
  append_maintainer_doc_attributes "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance documents at the maintainer-doc paths"

  mkdir -p "$keep/tree"
  for rel in $MAINTAINER_DOCS; do
    mkdir -p "$keep/tree/$(dirname "$rel")"
    cp -R "$inst/$rel" "$keep/tree/$rel"
  done

  assert_mdocs_classify "$inst" "case 8" "$MAINTAINER_DOCS" ""

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  assert_mdocs_reconcile_ok "$inst" "case 8"

  # Reported, not deleted: the framework record the merge ADDED under the owned
  # directory path. Deliberately NOT gated on SKIP_RECONCILE — the report is the
  # only reconcile-dependent behavior in this case, so gating it out would make the
  # case pass without reconcile and leave it vacuous.
  printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -q '002-added-in-fw-v2\.md' \
    || fail "case 8: reconcile did not report the framework file the merge added under an owned path; stdout: '$HELPER_OUT'"
  ok "case 8: reconcile reports the framework-added record"
  for docdir in $MAINTAINER_DOCS; do
    case "$docdir" in
      *.md) ;;
      *) [ -f "$inst/$docdir/002-added-in-fw-v2.md" ] \
           || fail "case 8: reconcile DELETED the framework-added record (it must report, not delete)" ;;
    esac
  done
  ok "case 8: reconcile deleted nothing"

  finalize_merge "$inst" "case 8"

  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md)
        cmp "$inst/$rel" "$keep/tree/$rel" \
          || fail "case 8: the instance's $rel is not byte-for-byte identical after the merge"
        ;;
      *)
        cmp "$inst/$rel/001-example.md" "$keep/tree/$rel/001-example.md" \
          || fail "case 8: the instance's $rel/001-example.md is not byte-for-byte identical after the merge"
        ;;
    esac
  done
  ok "case 8: every instance-owned maintainer doc is byte-for-byte unchanged (cmp)"
  assert_mdocs_classify "$inst" "case 8 (post-merge)" "$MAINTAINER_DOCS" ""
}

# ---------------------------------------------------------------------------
# Case 9 — maintainer docs: PARTIALLY owned instance (per-path, never a stop)
# ---------------------------------------------------------------------------
case_mdocs_partially_owned() { # workdir
  local work="$1" fw inst owned rest rel
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  owned="$(first_doc_file)"
  rest=""
  for rel in $MAINTAINER_DOCS; do
    if [ "$rel" != "$owned" ]; then
      rest="$rest $rel"
      rm -rf "$inst/$rel"
    fi
  done
  # The one path the instance keeps is its own document, and only it is protected.
  printf '# Instance document at %s\n' "$owned" > "$inst/$owned"
  case "$owned" in
    *.md) printf '%s merge=ours\n' "$owned" >> "$inst/.gitattributes" ;;
  esac
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance owns one maintainer-doc path and no others"

  assert_mdocs_classify "$inst" "case 9" "$owned" "$rest"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  # A partial set is a normal state: the run must not stop.
  assert_mdocs_reconcile_ok "$inst" "case 9"

  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    grep -Fq "Instance document at $owned" "$inst/$owned" \
      || fail "case 9: the instance's own $owned was overwritten or deleted"
    ok "case 9: the one owned path kept the instance's content"
    for rel in $rest; do
      [ ! -e "$inst/$rel" ] || fail "case 9: stripped path $rel survives in the working tree"
      [ -z "$(git -C "$inst" ls-files -- "$rel")" ] || fail "case 9: stripped path $rel is still tracked"
    done
    ok "case 9: every path the instance did not own was removed"
  fi

  finalize_merge "$inst" "case 9"
  assert_is_merge_commit "$inst" "case 9"
  for rel in $rest; do
    [ -z "$(git -C "$inst" ls-tree -r --name-only HEAD -- "$rel")" ] \
      || fail "case 9: the finalized merge commit carries stripped path $rel"
  done
  git -C "$inst" ls-tree -r --name-only HEAD -- "$owned" | grep -q . \
    || fail "case 9: the finalized merge commit dropped the instance's own $owned"
  ok "case 9: per-path outcome survives into the merge commit"
}

# ---------------------------------------------------------------------------
# Case 10 — maintainer docs: OWNED BUT UNPROTECTED — the upgrade must stop
# ---------------------------------------------------------------------------
case_mdocs_owned_unprotected() { # workdir
  local work="$1" variant fw inst owned
  mkdir -p "$work"
  for variant in no-attribute no-driver; do
    fw="$work/$variant/fw"
    inst="$work/$variant/instance"
    mkdir -p "$work/$variant"
    build_framework "$fw"
    clone_at_v1 "$fw" "$inst"

    owned="$(first_doc_file)"
    write_maintainer_docs "$inst" "instance-owned"
    case "$variant" in
      no-attribute) : ;;                                  # never marked merge=ours
      no-driver)
        append_maintainer_doc_attributes "$inst"
        git -C "$inst" config --unset merge.ours.driver   # per-clone, not version-controlled
        ;;
    esac
    write_instance_agents_md "$inst/AGENTS.md" no-reference
    git -C "$inst" add -A
    git -C "$inst" commit -q -m "Instance documents at the maintainer-doc paths ($variant)"

    local before
    before="$(git -C "$inst" rev-parse HEAD)"
    assert_mdocs_classify "$inst" "case 10/$variant" "$MAINTAINER_DOCS" ""

    git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
    git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
      || fail "case 10/$variant: fixture guard — expected the merge to stop mid-merge (both sides edited these paths)"
    assert_mdocs_reconcile_stops "$inst" "case 10/$variant"
    if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
      printf '%s' "$HELPER_ERR" | grep -q 'merge --abort' \
        || fail "case 10/$variant: mid-merge diagnostic does not prescribe the abort: $HELPER_ERR"
    fi

    # The instance's own document must still be its own: nothing committed, and the
    # committed content at the pre-merge revision untouched.
    git -C "$inst" show "$before:$owned" | grep -Fq 'instance-owned' \
      || fail "case 10/$variant: the instance's committed $owned no longer holds its own content"
    [ "$(git -C "$inst" rev-parse HEAD)" = "$before" ] \
      || fail "case 10/$variant: the failed reconcile advanced HEAD"
    ok "case 10/$variant: the framework copy did not win and HEAD did not move"
  done

  # 10c — the same unprotected instance, but the framework's edits apply WITHOUT a
  # conflict, so git auto-commits the merge. `git merge --abort` does not work once
  # the merge is committed, so the diagnostic must send the user to ORIG_HEAD
  # instead. Review finding B1 on PR #39: the earlier remedy was unconditional and
  # failed with `no merge to abort` in exactly this shape.
  local inst3 fw3 before3
  fw3="$work/clean-auto-merge/fw"
  inst3="$work/clean-auto-merge/instance"
  mkdir -p "$work/clean-auto-merge"
  build_framework "$fw3"
  clone_at_v1 "$fw3" "$inst3"
  # The instance carries the maintainer docs from its own history and never edited
  # them, and never marked them merge=ours — so fw-v2's edits merge cleanly. It
  # also drops the framework's VERSION the same way fw-v2 does, because that
  # one-time modify/delete conflict would otherwise stop the merge for an unrelated
  # reason and this fixture needs git to auto-commit.
  git -C "$inst3" rm -q -f VERSION
  write_instance_agents_md "$inst3/AGENTS.md" no-reference
  git -C "$inst3" add -A
  git -C "$inst3" commit -q -m "Instance carries the maintainer-doc paths unprotected"
  before3="$(git -C "$inst3" rev-parse HEAD)"

  assert_mdocs_classify "$inst3" "case 10/clean-auto-merge" "$MAINTAINER_DOCS" ""

  git -C "$inst3" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst3" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 10/clean-auto-merge: fixture no longer auto-commits the merge, so the committed-merge remedy is not exercised"
  fi
  ok "case 10/clean-auto-merge: the framework's doc edits merged cleanly and git committed the merge"

  assert_mdocs_reconcile_stops "$inst3" "case 10/clean-auto-merge"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    printf '%s' "$HELPER_ERR" | grep -q 'ORIG_HEAD' \
      || fail "case 10/clean-auto-merge: the diagnostic does not name the committed-merge undo (ORIG_HEAD): $HELPER_ERR"
    if printf '%s' "$HELPER_ERR" | grep -q 'merge --abort'; then
      fail "case 10/clean-auto-merge: the diagnostic prescribes \`git merge --abort\`, which fails once the merge is committed: $HELPER_ERR"
    fi
    ok "case 10/clean-auto-merge: the diagnostic prescribes the undo that actually works here"
    # The prescribed remedy must really return the instance to its own documents.
    git -C "$inst3" reset --hard ORIG_HEAD >/dev/null 2>&1 \
      || fail "case 10/clean-auto-merge: the prescribed \`git reset --hard ORIG_HEAD\` failed"
    [ "$(git -C "$inst3" rev-parse HEAD)" = "$before3" ] \
      || fail "case 10/clean-auto-merge: the prescribed undo did not restore the pre-merge commit"
    grep -Fq 'fw-v1' "$inst3/$owned" \
      || fail "case 10/clean-auto-merge: after the undo, $owned does not hold the instance's pre-merge content"
    ok "case 10/clean-auto-merge: the prescribed undo restores the instance's pre-merge documents"
  fi
}

# ---------------------------------------------------------------------------
# Case 11 — maintainer docs: FIRST upgrade to the release that introduces the
# strip list. The helper is bootstrapped out of the tag, but the working tree's
# wizard predates the export, so the derivation must come from the tag while
# presence still comes from the tree.
# ---------------------------------------------------------------------------
case_mdocs_first_upgrade_from_tag() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw" legacy-wizard
  clone_at_v1 "$fw" "$inst"

  # The instance carries no maintainer docs (an earlier adoption removed them),
  # and its wizard is fw-v1's — the one that predates MAINTAINER_DOCS.
  strip_maintainer_docs "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1: strip maintainer docs"

  # Fixture guards: this must really be the pre-export tree, and the tag must
  # really carry the export. Without both, the case proves nothing.
  if grep -q 'MAINTAINER_DOCS' "$inst/scripts/init/writer.mjs"; then
    fail "case 11: fixture guard — the working tree's wizard already exports MAINTAINER_DOCS, so the first-upgrade shape is gone"
  fi
  git -C "$inst" show fw-v2:scripts/init/writer.mjs | grep -q 'MAINTAINER_DOCS' \
    || fail "case 11: fixture guard — fw-v2 does not export MAINTAINER_DOCS, so there is nothing to derive from the tag"
  ok "case 11: fixture is the first-upgrade shape (tree's wizard predates the export, fw-v2 carries it)"

  # The defect this criterion exists for: deriving from the working tree cannot
  # produce the classification at all.
  run_mdocs "$inst" classify
  [ "$HELPER_STATUS" -eq 3 ] \
    || fail "case 11: classify without --from-tag exited $HELPER_STATUS (expected 3 on a wizard that predates the export); stdout: '$HELPER_OUT'"
  printf '%s' "$HELPER_ERR" | grep -q -- '--from-tag' \
    || fail "case 11: the underivable diagnostic does not point at --from-tag: $HELPER_ERR"
  ok "case 11: classify without --from-tag exits 3 and names --from-tag as the remedy"

  # The contract: the path set comes from the tag, presence from this tree.
  assert_mdocs_classify "$inst" "case 11" "" "$MAINTAINER_DOCS" --from-tag fw-v2

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 11: the fw-v2 merge did not stop on a maintainer-doc modify/delete conflict (fixture no longer exercises the contract)"

  # reconcile takes no --from-tag: after the merge the framework-owned wizard is
  # the tag's, so the working tree is once again a correct derivation source.
  assert_mdocs_reconcile_ok "$inst" "case 11"
  assert_maintainer_docs_absent "$inst" "case 11"
  finalize_merge "$inst" "case 11"

  assert_is_merge_commit "$inst" "case 11"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 11"
  grep -q 'MAINTAINER_DOCS' "$inst/scripts/init/writer.mjs" \
    || fail "case 11: the framework's wizard did not land, so later upgrades still cannot derive the path set"
  ok "case 11: the release's wizard landed — later upgrades need no --from-tag"
}

# ---------------------------------------------------------------------------
# Case 12 — FRAMEWORK-VERSION holds its pre-merge value across the merge and
# changes only on the explicit post-verification bump.
#
# Deliberately NOT built on build_framework: this case needs npm manifests on both
# tags and a FRAMEWORK-VERSION the instance has NOT touched since the merge base.
# That last part is the whole point — `merge=ours` names a driver git only invokes
# on a three-way content merge, so an instance with `ours == base` gets theirs
# fast-forwarded in and silently claims the incoming release before anything has
# verified it.
# ---------------------------------------------------------------------------

# `versioned` mirrors VERSION into the manifests; `versionless` writes the v1.0.8
# shape, which the capture accepts so the first migration needs no pre-editing.
write_npm_manifests() { # dir name shape version
  local pkg lock
  pkg="$1/package.json"
  lock="$1/package-lock.json"
  if [ "$3" = "versioned" ]; then
    cat > "$pkg" <<EOF
{
  "name": "$2",
  "version": "$4",
  "private": true,
  "description": "Example package",
  "scripts": { "build": "true" }
}
EOF
    cat > "$lock" <<EOF
{
  "name": "$2",
  "version": "$4",
  "lockfileVersion": 3,
  "packages": { "": { "name": "$2", "version": "$4" } }
}
EOF
  else
    cat > "$pkg" <<EOF
{
  "name": "$2",
  "private": true,
  "description": "Example package",
  "scripts": { "build": "$4" }
}
EOF
    cat > "$lock" <<EOF
{
  "name": "$2",
  "lockfileVersion": 3,
  "packages": { "": { "name": "$2" } }
}
EOF
  fi
}

# Two framework tags whose only interesting difference is FRAMEWORK-VERSION plus
# one manifest field, so each sub-case controls the merge shape exactly.
build_version_framework() { # dir shape
  local fw="$1" shape="$2"
  init_repo "$fw"
  mkdir -p "$fw/src"
  write_gitattributes "$fw"
  printf 'marker\n' > "$fw/.sekai-template"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  printf 'v1.0.0\n' > "$fw/FRAMEWORK-VERSION"
  if [ "$shape" = "versioned" ]; then
    write_npm_manifests "$fw" "example-framework" versioned "1.0.0"
  else
    write_npm_manifests "$fw" "example-framework" versionless "old-framework-build"
  fi
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1"
  git -C "$fw" tag fw-v1

  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  printf 'v1.0.1\n' > "$fw/FRAMEWORK-VERSION"
  if [ "$shape" = "versioned" ]; then
    write_npm_manifests "$fw" "example-framework" versioned "1.0.1"
  else
    write_npm_manifests "$fw" "example-framework" versionless "new-framework-build"
  fi
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

run_package_capture() { # dir label — prints the state path
  local out
  out="$( cd "$1" && node "$PACKAGE_HELPER" capture )" \
    || fail "$2: package-state capture failed"
  [ -n "$out" ] || fail "$2: package-state capture printed no state path (the helper was a silent no-op)"
  printf '%s' "$out"
}

# package-state reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_package_reconcile() { # dir state-file label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: package-state reconcile DELIBERATELY SKIPPED)"
    return 0
  fi
  ( cd "$1" && node "$PACKAGE_HELPER" reconcile "$2" ) > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" \
    || fail "$3: package-state reconcile failed; stderr: $(cat "$TMP/stderr.txt")"
  ok "$3: package-state reconcile exited 0"
}

assert_framework_version() { # dir expected label where
  local found
  found="$(cat "$1/FRAMEWORK-VERSION")"
  [ "$found" = "$2" ] || fail "$3: FRAMEWORK-VERSION is '$found' $4 (expected '$2')"
  ok "$3: FRAMEWORK-VERSION is $2 $4"
}

assert_framework_version_committed() { # dir expected label
  local found
  found="$(git -C "$1" show HEAD:FRAMEWORK-VERSION)"
  [ "$found" = "$2" ] || fail "$3: the commit carries FRAMEWORK-VERSION '$found' (expected '$2')"
  ok "$3: the commit carries FRAMEWORK-VERSION $2"
}

# The explicit post-verification bump (`/sekai-upgrade` step 9 / UPGRADE.md step 8),
# including the assertion that step now makes rather than assuming its write took.
bump_framework_version() { # dir target label
  printf '%s\n' "$2" > "$1/FRAMEWORK-VERSION"
  [ "$(cat "$1/FRAMEWORK-VERSION")" = "$2" ] \
    || fail "$3: the documented bump assertion would not have caught a failed write"
  git -C "$1" add -- FRAMEWORK-VERSION
  git -C "$1" commit -q -m "chore: FRAMEWORK-VERSION -> $2"
}

case_framework_version_survives_merge() { # workdir
  local work="$1" fw inst state
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_version_framework "$fw" versioned

  git clone -q "$fw" "$inst"
  configure_repo "$inst"
  git -C "$inst" checkout -q -B main fw-v1
  git -C "$inst" rm -q -f .sekai-template
  printf 'v7.0.0\n' > "$inst/VERSION"
  write_npm_manifests "$inst" "example-instance" versioned "7.0.0"
  # FRAMEWORK-VERSION is deliberately NOT touched here.
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1"

  # Fixture guards: the attribute and the driver are both in place, and the
  # instance's FRAMEWORK-VERSION is identical to the merge base. That pair is what
  # makes `merge=ours` insufficient, and it is the state this case exists for.
  grep -qx 'FRAMEWORK-VERSION merge=ours' "$inst/.gitattributes" \
    || fail "case 12: fixture guard — FRAMEWORK-VERSION is not marked merge=ours"
  [ "$(git -C "$inst" config merge.ours.driver)" = "true" ] \
    || fail "case 12: fixture guard — the ours driver is not configured in this clone"
  git -C "$inst" diff --quiet fw-v1 HEAD -- FRAMEWORK-VERSION \
    || fail "case 12: fixture guard — the instance changed FRAMEWORK-VERSION since the merge base, so merge=ours would fire and the case would prove nothing"
  assert_framework_version "$inst" "v1.0.0" "case 12" "before the merge"

  state="$(run_package_capture "$inst" "case 12")"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true

  # The defect, pinned: with the attribute set and the driver configured, the merge
  # still moved the file, because git never invoked the driver.
  assert_framework_version "$inst" "v1.0.1" "case 12" "after the merge (merge=ours did not protect it)"

  run_package_reconcile "$inst" "$state" "case 12"
  assert_framework_version "$inst" "v1.0.0" "case 12" "after reconcile"

  finalize_merge "$inst" "case 12"
  assert_is_merge_commit "$inst" "case 12"
  assert_framework_version_committed "$inst" "v1.0.0" "case 12"

  # Only now, after verification, does the explicit bump move it.
  bump_framework_version "$inst" "v1.0.1" "case 12"
  assert_framework_version "$inst" "v1.0.1" "case 12" "after the explicit bump"
  assert_framework_version_committed "$inst" "v1.0.1" "case 12"

  # 12b — the same contract where the merge COMPLETES WITHOUT CONFLICTS, so git
  # auto-commits it. reconcile must rewrite that commit rather than resolve an
  # index, or the merge commit itself ships the unverified version.
  local fw2 inst2 state2
  fw2="$work/autocommit/fw"
  inst2="$work/autocommit/instance"
  mkdir -p "$work/autocommit"
  build_version_framework "$fw2" versionless

  git clone -q "$fw2" "$inst2"
  configure_repo "$inst2"
  git -C "$inst2" checkout -q -B main fw-v1
  git -C "$inst2" rm -q -f .sekai-template
  # The adopter adds only VERSION: the versionless manifests are accepted as-is, so
  # nothing the framework also edits differs on this side and the merge is clean.
  printf 'v7.0.0\n' > "$inst2/VERSION"
  git -C "$inst2" add -A
  git -C "$inst2" commit -q -m "Adopt Example framework at fw-v1 (versionless manifests)"

  git -C "$inst2" diff --quiet fw-v1 HEAD -- FRAMEWORK-VERSION \
    || fail "case 12b: fixture guard — the instance changed FRAMEWORK-VERSION since the merge base"
  state2="$(run_package_capture "$inst2" "case 12b")"

  git -C "$inst2" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst2" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 12b: fixture no longer auto-commits the merge, so the amend path is not exercised"
  fi
  assert_is_merge_commit "$inst2" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.1" "case 12b (the auto-committed merge, before reconcile)"

  run_package_reconcile "$inst2" "$state2" "case 12b"
  assert_framework_version "$inst2" "v1.0.0" "case 12b" "after reconcile"
  assert_is_merge_commit "$inst2" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.0" "case 12b"
  local dirty
  dirty="$(git -C "$inst2" status --porcelain)"
  [ -z "$dirty" ] || fail "case 12b: reconcile left the amended merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 12b: reconcile amended the merge commit itself (working tree clean)"

  bump_framework_version "$inst2" "v1.0.1" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.1" "case 12b"
}

# ---------------------------------------------------------------------------
# Documented-bootstrap contract — the flags the adopter-facing docs tell a user to
# run must be flags the helper actually accepts.
#
# The prose in `.agents/skills/sekai-upgrade/SKILL.md` and
# `docs/runbook/UPGRADE.md` states something about this code: which options the
# first-upgrade bootstrap passes. Derive that statement from the option parser
# instead of trusting it (guard-or-explain: a doc that states a CLI form must fail
# CI when the CLI changes under it).
# ---------------------------------------------------------------------------
UPGRADE_DOCS="$ROOT/.agents/skills/sekai-upgrade/SKILL.md $ROOT/docs/runbook/UPGRADE.md"

case_documented_flags_exist() {
  local doc flag accepted used
  # The parser's own option table is the source: `'--flag': '...'` entries.
  accepted="$(grep -o -- "'--[a-z-]*'" "$MDOCS_HELPER_SRC" | tr -d "'" | sort -u)"
  [ -n "$accepted" ] \
    || fail "documented flags: could not derive the accepted option set from $MDOCS_HELPER_SRC"

  for doc in $UPGRADE_DOCS; do
    [ -f "$doc" ] || fail "documented flags: $doc is missing"
    # Options on the lines that INVOKE the helper. Both documents bootstrap it into
    # a `$MDOCS_HELPER` variable first, so matching the filename instead would pick
    # up the `git rev-parse --git-dir` on the extraction line.
    used="$(grep -- 'node "$MDOCS_HELPER"' "$doc" | grep -o -- '--[a-z-]*' | sort -u)"
    for flag in $used; do
      printf '%s\n' "$accepted" | grep -qx -- "$flag" \
        || fail "documented flags: $(basename "$doc") tells the user to pass $flag to maintainer-docs-state.mjs, which its option parser does not accept"
    done
    printf '%s\n' "$used" | grep -qx -- '--from-tag' \
      || fail "documented flags: $(basename "$doc") no longer shows --from-tag on a helper invocation, so the first-upgrade bootstrap it documents cannot derive the path set"
  done
  ok "documented flags: both upgrade documents pass only options the helper accepts, and both still show --from-tag"
}

# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------

run_all_cases() {
  echo "── case 0: reconcile usage contract ──"
  case_usage_errors "$TMP/case0"
  echo ""
  echo "── case 1: stripped instance, shared history ──"
  case_stripped_shared_history "$TMP/case1"
  echo ""
  echo "── case 2: stripped instance, unrelated history, first framework merge ──"
  case_stripped_unrelated_history "$TMP/case2"
  echo ""
  echo "── case 3: installed instance, adopter dev-plugin state preserved ──"
  case_installed_preserved "$TMP/case3"
  echo ""
  echo "── case 4: mixed — dev-plugin tree present, reference absent ──"
  case_mixed_tree_without_reference "$TMP/case4"
  echo ""
  echo "── case 5: mixed — active reference, dev-plugin tree absent ──"
  case_mixed_reference_without_tree "$TMP/case5"
  echo ""
  echo "── case 6: maintainer docs — stripped instance, shared history ──"
  case_mdocs_stripped_shared_history "$TMP/case6"
  echo ""
  echo "── case 7: maintainer docs — stripped instance, unrelated history, first merge ──"
  case_mdocs_stripped_unrelated_history "$TMP/case7"
  echo ""
  echo "── case 8: maintainer docs — fully owned instance, protected ──"
  case_mdocs_owned_preserved "$TMP/case8"
  echo ""
  echo "── case 9: maintainer docs — partially owned instance (per path, no stop) ──"
  case_mdocs_partially_owned "$TMP/case9"
  echo ""
  echo "── case 10: maintainer docs — owned but unprotected (must stop) ──"
  case_mdocs_owned_unprotected "$TMP/case10"
  echo ""
  echo "── case 11: maintainer docs — first upgrade to the release that introduces the strip list ──"
  case_mdocs_first_upgrade_from_tag "$TMP/case11"
  echo ""
  echo "── case 12: FRAMEWORK-VERSION survives the merge, bumps only after verification ──"
  case_framework_version_survives_merge "$TMP/case12"
  echo ""
  echo "── documented bootstrap: the docs' helper options are options the parser accepts ──"
  case_documented_flags_exist
  echo ""
  echo "✅ upgrade-state check passed: dev-plugin state (stripped / installed / mixed exit 3), maintainer-doc state (per-path owned / stripped, unprotected stop, tag-derived first upgrade) and the FRAMEWORK-VERSION bump contract hold on all twelve fixtures."
}

# Run one case with reconcile skipped, in a subshell whose EXIT trap is cleared
# (the parent owns $TMP cleanup). The case MUST fail.
expect_case_to_fail() { # fn workdir label
  echo "── selftest: $3 with reconcile SKIPPED (must FAIL) ──"
  local status=0
  ( trap - EXIT; SKIP_RECONCILE=1; "$1" "$2" ) || status=$?
  if [ "$status" -eq 0 ]; then
    echo "❌ SELFTEST FAILED: $3 PASSED without reconcile — the case cannot detect the regression it guards (vacuous test)." >&2
    exit 1
  fi
  echo "✓ selftest: $3 fails without reconcile (exit $status) — the case is non-vacuous"
  echo ""
}

run_selftest() {
  echo "Selftest: proving the reconcile-dependent cases are non-vacuous."
  echo "Expect ❌ lines below — they are the deliberately-broken runs being caught."
  echo ""
  expect_case_to_fail case_stripped_shared_history "$TMP/selftest-case1" "case 1 (stripped, shared history)"
  expect_case_to_fail case_stripped_unrelated_history "$TMP/selftest-case2" "case 2 (stripped, unrelated history)"
  expect_case_to_fail case_mdocs_stripped_shared_history "$TMP/selftest-case6" "case 6 (maintainer docs, stripped, shared history)"
  expect_case_to_fail case_mdocs_stripped_unrelated_history "$TMP/selftest-case7" "case 7 (maintainer docs, stripped, unrelated history)"
  expect_case_to_fail case_mdocs_owned_preserved "$TMP/selftest-case8" "case 8 (maintainer docs, fully owned)"
  expect_case_to_fail case_mdocs_partially_owned "$TMP/selftest-case9" "case 9 (maintainer docs, partially owned)"
  expect_case_to_fail case_mdocs_owned_unprotected "$TMP/selftest-case10" "case 10 (maintainer docs, owned but unprotected)"
  expect_case_to_fail case_mdocs_first_upgrade_from_tag "$TMP/selftest-case11" "case 11 (maintainer docs, first upgrade from tag)"
  expect_case_to_fail case_framework_version_survives_merge "$TMP/selftest-case12" "case 12 (FRAMEWORK-VERSION survives the merge)"
  echo "✅ SELFTEST OK: cases 1, 2, 6, 7, 8, 9, 10, 11 and 12 all fail when reconcile is skipped."
}

main() {
  case "${1:-}" in
    --selftest) run_selftest ;;
    "")         run_all_cases ;;
    *)          echo "usage: bash scripts/upgrade/check-upgrade-state.sh [--selftest]" >&2; exit 2 ;;
  esac
}

main "${1:-}"
