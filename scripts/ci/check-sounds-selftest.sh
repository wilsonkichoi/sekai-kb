#!/usr/bin/env bash
#
# check-sounds-selftest.sh -- non-vacuity proof for the soundscape manifest
# gate (scripts/ci/check-sounds.mjs).
#
# A guard that only ever asserts the green path proves nothing. This test plants
# each of the gate's four failing classes into a temp copy and requires the gate
# to FAIL each time, then asserts the gate PASSES on the shipped tree, and
# finally asserts the orphan case exits zero while naming the orphan on stdout.
#
#   1. MISSING FIELD  -- a recording with a required field removed.
#   2. UNRESOLVED FILE -- a `file` whose mp3 does not exist under public/.
#   3. PATH ESCAPE    -- a `file` containing a `..` segment.
#   4. DUPLICATE ID   -- two categories sharing the same `id`.
#   5. ORPHAN (pass)  -- an mp3 under public/media/sounds/ unreferenced; gate
#                        must exit 0 but name the orphan on stdout.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset). This
# script's source is pure ASCII and carries no denylisted place term.
#
# Usage: bash scripts/ci/check-sounds-selftest.sh

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-sounds.mjs"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sounds-selftest.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  return 0
}
trap cleanup EXIT

OUT="$WORK_DIR/guard-output.txt"
PASS=0
FAIL=0

run_guard() {
  node --experimental-strip-types "$GUARD" --root "$1" >"$OUT" 2>&1
}

# Build a minimal valid fixture: one category, one recording, one mp3.
build_fixture() {
  local dir="$1"
  mkdir -p "$dir/knowledge/sounds"
  mkdir -p "$dir/public/media/sounds"
  # A real mp3 header is not required; the gate only checks existence.
  printf '\xff\xfb' >"$dir/public/media/sounds/test-clip.mp3"
  cat >"$dir/knowledge/sounds/_manifest.md" <<'MANIFEST'
---
categories:
  - id: nature
    icon: "\U0001F333"
    title: Nature
    sounds:
      - title: Test clip
        location: Test location
        credit: Test credit
        file: /media/sounds/test-clip.mp3
---
MANIFEST
}

# -- Baseline: the shipped tree must pass --
echo -n "baseline (shipped tree): "
if run_guard "$ROOT"; then
  echo "OK"
  PASS=$((PASS + 1))
else
  echo "FAILED -- the gate rejects the shipped tree (exit $?)"
  cat "$OUT"
  exit 1
fi

# -- Class 1: missing required field --
echo -n "class 1 (missing field): "
FIXTURE="$WORK_DIR/class1"
build_fixture "$FIXTURE"
# Remove the `credit` field from the recording
sed 's/        credit: Test credit//' "$FIXTURE/knowledge/sounds/_manifest.md" \
  >"$WORK_DIR/tmp_manifest" && mv "$WORK_DIR/tmp_manifest" "$FIXTURE/knowledge/sounds/_manifest.md"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch missing required field"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "missing" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention 'missing'"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 2: unresolved file --
echo -n "class 2 (unresolved file): "
FIXTURE="$WORK_DIR/class2"
build_fixture "$FIXTURE"
rm "$FIXTURE/public/media/sounds/test-clip.mp3"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch unresolved file"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "does not exist" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention file absence"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 3: path escape --
echo -n "class 3 (path escape): "
FIXTURE="$WORK_DIR/class3"
build_fixture "$FIXTURE"
sed 's|file: /media/sounds/test-clip.mp3|file: /media/sounds/../../etc/passwd|' \
  "$FIXTURE/knowledge/sounds/_manifest.md" \
  >"$WORK_DIR/tmp_manifest" && mv "$WORK_DIR/tmp_manifest" "$FIXTURE/knowledge/sounds/_manifest.md"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch path escape"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "safe" "$OUT" || grep -qi "\.\." "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention path safety"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 4: duplicate category id --
echo -n "class 4 (duplicate id): "
FIXTURE="$WORK_DIR/class4"
build_fixture "$FIXTURE"
cat >"$FIXTURE/knowledge/sounds/_manifest.md" <<'MANIFEST'
---
categories:
  - id: nature
    icon: "\U0001F333"
    title: Nature
    sounds:
      - title: Test clip
        location: Test location
        credit: Test credit
        file: /media/sounds/test-clip.mp3
  - id: nature
    icon: "\U0001F333"
    title: Nature duplicate
    sounds: []
---
MANIFEST
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch duplicate id"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "duplicate\|repeats" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention duplicate"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 5: orphan (must pass, naming the orphan) --
echo -n "class 5 (orphan, pass): "
FIXTURE="$WORK_DIR/class5"
build_fixture "$FIXTURE"
printf '\xff\xfb' >"$FIXTURE/public/media/sounds/unreferenced-orphan.mp3"
if run_guard "$FIXTURE"; then
  if grep -q "unreferenced-orphan" "$OUT"; then
    echo "OK (passed, orphan named)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate passed but did not name the orphan"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
else
  echo "FAILED -- gate exited nonzero on an orphan (should be warning only)"
  cat "$OUT"
  FAIL=$((FAIL + 1))
fi

# -- Summary --
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "sounds:selftest FAILED: $FAIL class(es) not caught ($PASS passed)"
  exit 1
fi
echo "sounds:selftest OK: all $PASS classes caught/verified."
