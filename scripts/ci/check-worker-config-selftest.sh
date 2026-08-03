#!/usr/bin/env bash
#
# check-worker-config-selftest.sh -- non-vacuity proof for the worker config
# gate (scripts/ci/check-worker-config.mjs).
#
# A guard that only ever asserts the green path proves nothing: it would pass
# just as happily with an empty file list or an unreachable comparison. This
# test plants four defect classes -- every kind of deployment identity that
# must never be committed, plus the worker the guard has never heard of -- and
# requires the guard to FAIL each time:
#
#   1. ORIGIN        -- a real https origin in [vars] ALLOWED_ORIGIN. The
#                       template ships it empty; a real one is a deploy config
#                       committed as a template.
#   2. WORKER NAME   -- a place-named `name` in place of the framework
#                       placeholder. This is what a hand-edited deploy leaves
#                       behind, and it carries the instance's identity.
#   3. DATABASE NAME -- a place-named `database_name`, the same defect one key
#                       deeper, inside [[d1_databases]].
#   4. NEW WORKER    -- a worker directory the guard carries no expectation for.
#                       Coverage that a later phase's worker inherits by
#                       omission is no coverage: a new worker must be registered
#                       deliberately, so an unregistered one fails closed.
#
# Unlike its sibling check-scan-root-docs-selftest.sh, this test never mutates
# the repository: each class gets a fresh copy of the committed workers/ tree in
# a temp directory and the guard is pointed at it with --root. Before each plant
# the guard must PASS on the unmutated copy, so a copy that is somehow already
# dirty cannot masquerade as a caught regression, and a substitution that
# silently no-ops fails this test loudly rather than leaving the guard nothing
# to catch.
#
# Nothing below hardcodes a worker directory: the template planted into is
# whichever committed wrangler.toml sorts first, and the path the guard's output
# must name is derived from it.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset; sed writes
# through a temp file rather than using the non-portable -i). This script's own
# source is pure ASCII and carries no denylisted place term -- it lives under
# scripts/, which both gates scan; the planted place names are invented.
#
# Usage: bash scripts/ci/check-worker-config-selftest.sh   (run from anywhere;
# exit 1 when the guard fails to catch a planted defect, exit 0 when it catches
# all four)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-worker-config.mjs"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/worker-config-selftest.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  return 0
}
trap cleanup EXIT

OUT="$WORK_DIR/guard-output.txt"

# The committed template this test plants its defects into, and the
# repository-relative path the guard is required to name when it complains.
TEMPLATE="$(find "$ROOT/workers" -type f -name 'wrangler.toml' | LC_ALL=C sort | sed -n '1p')"
if [ -z "$TEMPLATE" ]; then
  echo "worker config self-test: no committed wrangler.toml under workers/ -- the tree" >&2
  echo "  this test plants into has moved; re-point the self-test." >&2
  exit 1
fi
REL="${TEMPLATE#$ROOT/}"

# Run the guard, capturing stdout+stderr. An empty root means: no --root, i.e.
# the repository the guard lives in.
run_guard() {
  where="$1"
  if [ -z "$where" ]; then
    node "$GUARD" > "$OUT" 2>&1
  else
    node "$GUARD" --root "$where" > "$OUT" 2>&1
  fi
}

# A fresh copy of the committed workers/ tree, echoed as a root the guard can be
# pointed at. Any wrangler.generated.toml a local `npm run worker-config` left
# behind is dropped, so the fixture equals a clean checkout on every machine.
fresh_copy() {
  label="$1"
  copy="$WORK_DIR/$label"
  mkdir -p "$copy"
  cp -R "$ROOT/workers" "$copy/workers"
  find "$copy/workers" -type f -name 'wrangler.generated.toml' -exec rm -f {} +
  echo "$copy"
}

assert_guard_passes() {
  where="$1"; label="$2"
  if ! run_guard "$where"; then
    echo "worker config self-test: the guard fails on a clean tree ($label) -- cannot" >&2
    echo "  trust the assertions below." >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q '^OK:' "$OUT"; then
    echo "worker config self-test: the guard passed on a clean tree ($label) without an" >&2
    echo "  OK: summary line:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# The guard must FAIL, say so, and name the file it is complaining about. The
# third argument overrides which path that is; it defaults to the planted
# template.
assert_guard_catches() {
  where="$1"; what="$2"; expect="${3:-$REL}"
  if run_guard "$where"; then
    echo "FAIL: worker config self-test -- the guard did NOT catch $what" >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q '^FAIL:' "$OUT"; then
    echo "FAIL: worker config self-test -- the guard exited nonzero on $what without a" >&2
    echo "  FAIL: line:" >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q "$expect" "$OUT"; then
    echo "FAIL: worker config self-test -- the guard caught $what but its output never" >&2
    echo "  names $expect:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# Replace a literal line in the copied template (portable: sed -i differs
# between BSD and GNU, so write through a temp file). A substitution that
# changes nothing means the shipped file no longer carries the text this test
# plants against, which must fail loudly instead of handing the guard a
# compliant file to pass on.
plant() {
  copy="$1"; from="$2"; to="$3"
  target="$copy/$REL"
  sed "s|$from|$to|" "$target" > "$WORK_DIR/plant.tmp"
  if cmp -s "$WORK_DIR/plant.tmp" "$target"; then
    echo "worker config self-test: planting [$from] changed nothing in $REL -- the text" >&2
    echo "  this test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
  cp "$WORK_DIR/plant.tmp" "$target"
}

assert_guard_passes "" "the shipped tree"

# 1. ORIGIN: a real deploy origin committed in [vars]. The generated config is
# where place.domain belongs; the template ships ALLOWED_ORIGIN empty.
COPY="$(fresh_copy origin)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" 'ALLOWED_ORIGIN = ""' 'ALLOWED_ORIGIN = "https://kb.harborbend.example"'
assert_guard_catches "$COPY" "a real origin committed in [vars]"

# 2. WORKER NAME: a place-named `name` where the framework placeholder belongs.
COPY="$(fresh_copy worker-name)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" '^name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named worker name"

# 3. DATABASE NAME: the same identity leak one key deeper, in [[d1_databases]].
COPY="$(fresh_copy database-name)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" '^database_name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'database_name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named database_name"

# 4. NEW WORKER: a second worker directory, byte-identical to the compliant
# template, that the guard carries no expectation for. Copied rather than
# written from a heredoc so it is compliant by construction: the only thing
# wrong with it is that nobody registered it.
COPY="$(fresh_copy new-worker)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
NEW_WORKER="$COPY/workers/selftest-unregistered"
mkdir -p "$NEW_WORKER"
cp "$COPY/$REL" "$NEW_WORKER/wrangler.toml"
assert_guard_catches "$COPY" "a worker directory with no registered expectation" \
  "workers/selftest-unregistered/wrangler.toml"

echo "OK: worker config self-test passed -- the guard catches a committed origin, a place-named worker name, a place-named database_name, and an unregistered worker"
