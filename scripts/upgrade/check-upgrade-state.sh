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
# `--selftest` proves the suite is non-vacuous: it re-runs cases 1 and 2 with the
# reconcile step DELIBERATELY SKIPPED and requires each case's own assertions to
# FAIL. A skipped-reconcile run that passes means the case cannot detect the
# regression it exists to guard, and --selftest exits nonzero.
#
# Fixtures use only generic names (Example / Instance / fw-v1) — this repo is in
# whole-tree template mode, so the genericity + English-only gates scan this file
# and everything it writes into scripts/.
#
# Usage:
#   bash scripts/upgrade/check-upgrade-state.sh             all five cases
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
# Fixture builders
# ---------------------------------------------------------------------------

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
place.config.ts merge=ours
.agent-toolkit/** merge=ours
EOF
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

# Framework repo carrying tags fw-v1 and fw-v2.
build_framework() { # dir
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
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

# Common instance skeleton (no AGENTS.md, no dev-plugin state, not committed).
lay_instance_skeleton() { # dir
  mkdir -p "$1/src" "$1/scripts/upgrade"
  write_gitattributes "$1"
  printf 'export const place = { name: "Instance", tagline: "The adopting instance." };\n' > "$1/place.config.ts"
  printf 'export const INSTANCE_APP = "instance-local";\n' > "$1/src/app.js"
  printf '@AGENTS.md\n' > "$1/CLAUDE.md"
  cp "$HELPER_SRC" "$1/scripts/upgrade/dev-plugin-state.mjs"
}

clone_at_v1() { # framework-dir dest
  git clone -q "$1" "$2"
  configure_repo "$2"
  git -C "$2" checkout -q -B main fw-v1
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
      AGENTS.md|CLAUDE.md|place.config.ts)
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
  assert_no_unmerged_paths "$inst" "case 1"

  git -C "$inst" commit -q --no-edit || fail "case 1: 'git commit --no-edit' failed after reconcile"
  ok "case 1: 'git commit --no-edit' finalizes the merge"

  assert_is_merge_commit "$inst" "case 1"
  assert_no_tree_paths_in_commit "$inst" HEAD "case 1"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 1: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst" "case 1"

  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 1: the framework's non-dev-plugin change (src/app.js at fw-v2) did not land — reconcile discarded the merge"
  ok "case 1: the framework's non-dev-plugin change (src/app.js @ fw-v2) landed"
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
  echo "✅ upgrade-state check passed: classify (stripped / installed / mixed exit 3) and reconcile (stripped removal + amend, installed byte-preservation) hold on all five fixtures."
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
  echo "✅ SELFTEST OK: cases 1 and 2 both fail when reconcile is skipped."
}

main() {
  case "${1:-}" in
    --selftest) run_selftest ;;
    "")         run_all_cases ;;
    *)          echo "usage: bash scripts/upgrade/check-upgrade-state.sh [--selftest]" >&2; exit 2 ;;
  esac
}

main "${1:-}"
