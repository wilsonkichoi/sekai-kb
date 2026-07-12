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
# Instance-owned additions (written by `npm run init` with the adopter's place
# name, LB-27). Read ADDITIVELY: the framework denylist above stays
# framework-owned, so upgrades never conflict with local terms.
LOCAL_DENYLIST="$ROOT/scripts/ci/genericity-denylist.local.txt"

if [ ! -f "$DENYLIST" ]; then
  echo "genericity: denylist not found at $DENYLIST" >&2
  exit 2
fi

DENYLIST_FILES=("$DENYLIST")
[ -f "$LOCAL_DENYLIST" ] && DENYLIST_FILES+=("$LOCAL_DENYLIST")

# Build an alternation pattern from the denylists (drop comments/blank lines,
# join with |). Avoids `mapfile` so the script runs on macOS bash 3.2 as well as
# CI; grep -h suppresses filename prefixes when reading multiple files.
PATTERN="$(grep -vhE '^[[:space:]]*(#|$)' "${DENYLIST_FILES[@]}" | paste -sd '|' -)"
if [ -z "$PATTERN" ]; then
  echo "genericity: denylist is empty — nothing to check" >&2
  exit 0
fi

# Template mode vs instance mode (LB-26). The `.sekai-template` marker at the repo
# root means this checkout IS the sekai-kb template, which ships zero real-place
# content — so the denylist scan runs over the WHOLE tree, not just code trees.
# `npm run init` deletes the marker on adoption, reverting to instance mode
# (code trees only), where knowledge/ + place.config.ts legitimately carry the
# adopter's place identity.
if [ -f "$ROOT/.sekai-template" ]; then
  SCAN_ROOTS=("$ROOT")
  MODE="template (whole tree)"
else
  # Scan roots (skip any that don't exist yet).
  SCAN_ROOTS=()
  [ -d "$ROOT/src" ] && SCAN_ROOTS+=("$ROOT/src")
  [ -d "$ROOT/scripts" ] && SCAN_ROOTS+=("$ROOT/scripts")
  [ -d "$ROOT/tests" ] && SCAN_ROOTS+=("$ROOT/tests")
  MODE="instance (src/, scripts/, tests/)"
  if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
    echo "✓ genericity gate passed — no src/, scripts/, or tests/ to scan"
    exit 0
  fi
fi

# grep -I skips binary files. Excludes:
#  - node_modules, .git, and the build/tool caches (dist, .astro, .venv,
#    __pycache__): third-party or generated, never framework source. .git is
#    critical in template mode — commit messages carry the pre-cut place name.
#  - content, data, kb: the derived, gitignored projections of knowledge/
#    (src/content via sync.sh; src/data via prebuild JSON; public/kb via
#    build-kb-index) — place-specific by nature, never framework code.
#  - the denylist files themselves (they necessarily contain the forbidden
#    terms) and the template marker.
HITS="$(grep -rniIE "$PATTERN" "${SCAN_ROOTS[@]}" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  --exclude-dir=.astro \
  --exclude-dir=.venv \
  --exclude-dir=__pycache__ \
  --exclude-dir=content \
  --exclude-dir=data \
  --exclude-dir=kb \
  --exclude="genericity-denylist.txt" \
  --exclude="genericity-denylist.local.txt" \
  --exclude=".sekai-template" || true)"

if [ -n "$HITS" ]; then
  echo "❌ genericity gate FAILED [$MODE] — denylisted place strings found:" >&2
  echo "$HITS" >&2
  echo >&2
  echo "Place identity belongs in place.config.ts / knowledge/ / public/media/, not framework-owned code." >&2
  exit 1
fi

echo "✓ genericity gate passed [$MODE] — no denylisted terms"
