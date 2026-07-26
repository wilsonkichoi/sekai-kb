#!/usr/bin/env bash
#
# check-skills-gated.sh — self-test for the .agents/skills/ gate coverage.
#
# Proves that BOTH machine gates (check-genericity.sh and check-english-only.mjs)
# scan .agents/skills/ in INSTANCE mode (task 5.6, DoD-3). A framework skill is
# agent-executed prose, which is code for the genericity + English-only doctrine;
# a place string or CJK codepoint leaking into a skill body must fail CI the same
# way it does in src/ or tests/.
#
# Why instance mode specifically: the `.sekai-template` marker switches both
# gates to a whole-tree scan that would catch a planted string regardless of
# SCAN_ROOTS. This test hides the marker so the failure it observes can only come
# from .agents/skills/ being an explicit instance-mode scan root — which is the
# behavior an adopter (marker removed by `npm run init`) relies on.
#
# The plant lives inside .agents/skills/sekai-kb/ (the router's directory) so the
# self-test exercises a real framework skill directory instead of an unrelated
# scratch root.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset; the CJK
# byte is written via octal so this script's own source stays pure ASCII and
# passes the gate it tests).
#
# Usage: bash scripts/ci/check-skills-gated.sh   (run from anywhere; exit 1 on
# a gate that fails to catch the plant, exit 0 when both catch it)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

DENYLIST="$ROOT/scripts/ci/genericity-denylist.txt"
GEN_GATE="$ROOT/scripts/ci/check-genericity.sh"
CJK_GATE="$ROOT/scripts/ci/check-english-only.mjs"
SKILLS_ROOT="$ROOT/.agents/skills"
LEGACY_SKILLS_ROOT="$ROOT/.agent/skills"
MARKER="$ROOT/.sekai-template"
MARKER_BAK="$ROOT/.sekai-template.selftest-bak"
# Plant inside the router's own directory, not a fresh uniquely named root.
SCRATCH="$SKILLS_ROOT/sekai-kb/__gate_selftest__.md"

if [ ! -d "$SKILLS_ROOT" ]; then
  echo "skills-gate self-test: Codex discovery root .agents/skills is missing" >&2
  exit 1
fi
if [ -e "$LEGACY_SKILLS_ROOT" ]; then
  echo "skills-gate self-test: legacy undiscoverable root .agent/skills still exists" >&2
  exit 1
fi

# First real denylist term (skip comments/blank lines). Derived at runtime, never
# hardcoded, so this script's own source carries no forbidden place string.
PLANT_TERM="$(grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" | head -1 | tr -d '[:space:]')"
if [ -z "$PLANT_TERM" ]; then
  echo "skills-gate self-test: denylist has no term to plant with — cannot run" >&2
  exit 2
fi

restore() {
  rm -f "$SCRATCH"
  [ -f "$MARKER_BAK" ] && mv "$MARKER_BAK" "$MARKER"
  return 0
}
trap restore EXIT

# Force INSTANCE mode by hiding the template marker (restored on exit).
[ -f "$MARKER" ] && mv "$MARKER" "$MARKER_BAK"

# Baseline: on a clean instance tree (no scratch), both gates must PASS. Guards
# against a pre-existing hit masking the real assertion below.
if ! bash "$GEN_GATE" >/dev/null 2>&1; then
  echo "skills-gate self-test: genericity gate fails on a clean instance tree — cannot trust the test" >&2
  exit 1
fi
if ! node "$CJK_GATE" >/dev/null 2>&1; then
  echo "skills-gate self-test: english-only gate fails on a clean instance tree — cannot trust the test" >&2
  exit 1
fi

# Plant a denylisted place string and a CJK codepoint (U+4E2D, UTF-8 bytes
# 0xE4 0xB8 0xAD, written via octal) inside the router's directory.
{
  printf 'name: gate-selftest scratch — %s\n' "$PLANT_TERM"
  printf 'cjk: \344\270\255\n'
} > "$SCRATCH"

# The genericity gate must now FAIL (place string under .agents/skills/sekai-kb/).
if bash "$GEN_GATE" >/dev/null 2>&1; then
  echo "❌ skills-gate self-test: genericity gate did NOT catch '$PLANT_TERM' in .agents/skills/sekai-kb/ (instance mode)" >&2
  exit 1
fi

# The english-only gate must now FAIL (CJK codepoint under .agents/skills/sekai-kb/).
if node "$CJK_GATE" >/dev/null 2>&1; then
  echo "❌ skills-gate self-test: english-only gate did NOT catch a CJK codepoint in .agents/skills/sekai-kb/ (instance mode)" >&2
  exit 1
fi

echo "✓ skills-gate self-test passed — both gates scan .agents/skills/ (including the sekai-kb router) in instance mode ('$PLANT_TERM' + CJK caught)"
