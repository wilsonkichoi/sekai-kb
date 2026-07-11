#!/usr/bin/env bash
#
# check-genericity.sh — the genericity gate.
#
# Fails if any place-specific string leaks into framework-owned code (src/,
# scripts/, or tests/). Place identity must flow ONLY through place.config.ts,
# knowledge/, and public/media/ — never hardcoded in code trees (ADR 002, SPEC
# §Negative requirements, §G risk 2). This is the structural mitigation for the
# trap that motivated the whole rebuild.
#
# Scan scope: src/, scripts/, and tests/ (test fixtures are code — the
# whole-project doctrine, STRATEGIC-DIRECTION 2026-07-11 (b)). place.config.ts
# (repo root), knowledge/, public/media/, and docs/ hold place identity
# legitimately and are outside the scan roots by construction; the denylist file
# itself is inside scripts/ and is excluded explicitly (it necessarily contains
# the forbidden terms).
#
# Usage: bash scripts/ci/check-genericity.sh   (run from anywhere; exit 1 on hit)

set -euo pipefail

# Unset CDPATH: with it set, `cd` echoes the resolved dir into the command
# substitution and corrupts ROOT.
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
DENYLIST="$ROOT/scripts/ci/genericity-denylist.txt"

if [ ! -f "$DENYLIST" ]; then
  echo "genericity: denylist not found at $DENYLIST" >&2
  exit 2
fi

# Build an alternation pattern from the denylist (drop comments/blank lines, join
# with |). Avoids `mapfile` so the script runs on macOS bash 3.2 as well as CI.
PATTERN="$(grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" | paste -sd '|' -)"
if [ -z "$PATTERN" ]; then
  echo "genericity: denylist is empty — nothing to check" >&2
  exit 0
fi

# Scan roots (skip any that don't exist yet).
SCAN_ROOTS=()
[ -d "$ROOT/src" ] && SCAN_ROOTS+=("$ROOT/src")
[ -d "$ROOT/scripts" ] && SCAN_ROOTS+=("$ROOT/scripts")
[ -d "$ROOT/tests" ] && SCAN_ROOTS+=("$ROOT/tests")
if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
  echo "✓ genericity gate passed — no src/, scripts/, or tests/ to scan"
  exit 0
fi

# grep -I skips binary files; exclude node_modules, the denylist itself, and the
# two derived projections of knowledge/ that are place-specific by nature,
# gitignored, and never framework code: src/content/ (sync.sh) and src/data/
# (prebuild JSON — content-dates/git-info/latest/related).
HITS="$(grep -rniIE "$PATTERN" "${SCAN_ROOTS[@]}" \
  --exclude-dir=node_modules \
  --exclude-dir=content \
  --exclude-dir=data \
  --exclude="genericity-denylist.txt" || true)"

if [ -n "$HITS" ]; then
  echo "❌ genericity gate FAILED — place-specific strings in framework-owned code:" >&2
  echo "$HITS" >&2
  echo >&2
  echo "Place identity belongs in place.config.ts / knowledge/ / public/media/, not src/, scripts/, or tests/." >&2
  exit 1
fi

echo "✓ genericity gate passed — no denylisted terms in src/, scripts/, or tests/"
