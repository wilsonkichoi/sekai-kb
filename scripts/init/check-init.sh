#!/usr/bin/env bash
#
# check-init.sh — the init wizard's scripted self-check (LB-27 DoD 2/4/6).
#
# Tier 1 (always, non-destructive — runs on the COMMITTED tree via git archive):
#   1. Exports two scratch copies of HEAD and runs `--answers` init in each;
#      the two place.config.ts outputs must be byte-identical (cmp).
#   2. Runs the INTERACTIVE mode (piped stdin) on a third scratch copy with the
#      same answers; its place.config.ts must be byte-identical to the
#      `--answers` output. This is the DoD-2/§E contract (the two resolution
#      paths cannot drift), not just writer determinism.
#   3. Asserts every seeded artifact: FRAMEWORK-VERSION, the AGENTS.md header,
#      the CLAUDE.md @AGENTS.md shim, the README.md header, knowledge/{Category}/
#      dirs, INBOX.md, CNAME, the local genericity denylist, and the removed
#      .sekai-template marker.
#   4. Plants the test place name in src/ and asserts check-genericity.sh FAILS
#      (the local denylist is live); removes it and asserts the gate passes.
#
# Tier 2 (--build only — DESTRUCTIVE, runs init in THIS working tree, then
# `npm run build`): for CI and disposable clones only. The CI job passes
# --build; never pass it in a working tree you care about.
#
# Both tiers also run on ADOPTED INSTANCES (instances keep the init-check CI
# job, since they carry the wizard and receive framework upgrades). An adopted
# tree has no .sekai-template marker and has articles in knowledge/, so the
# wizard's re-run guard (index.mjs) would refuse it. The self-check tests the
# wizard, not the checkout's adoption state: it replants the marker before
# every init it runs, and init removes it again (asserted in tier 1).
#
# The test place name is assembled by concatenation below so that this script
# never contains it as a literal substring — post-init, the name is on the
# instance's local denylist, and this script lives inside the scanned scripts/
# tree of the scratch copies.
#
# Portability: macOS bash 3.2 + CI bash 5 (no mapfile, CDPATH unset).

set -euo pipefail
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"

BUILD=false
[ "${1:-}" = "--build" ] && BUILD=true

# "Test" + "haven": never a literal substring of this file (see header).
NAME="Test$(printf 'haven')"
NAME_LC="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"
DOMAIN="kb.example.org"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The answers fixture is generated OUTSIDE the tree (same never-a-literal
# reason). Categories use an explicit array to exercise the custom path.
ANSWERS="$TMP/answers.json"
cat > "$ANSWERS" <<EOF
{
  "place": {
    "name": "$NAME",
    "tagline": "Knowledge base for $NAME, the init self-check place.",
    "domain": "$DOMAIN",
    "locale": "en"
  },
  "categories": [
    { "slug": "history", "title": "History", "icon": "X", "description": "The record" },
    { "slug": "harbor", "title": "Harbor", "icon": "X", "description": "The waterfront" },
    { "slug": "nature", "title": "Nature", "icon": "X", "description": "The land" },
    { "slug": "food", "title": "Food", "icon": "X", "description": "The table" },
    { "slug": "events", "title": "Events", "icon": "X", "description": "The calendar" }
  ],
  "map": { "center": [35.1, -120.65], "zoom": 12 },
  "features": { "soundscape": false, "social": true },
  "links": {
    "repo": "https://github.com/example/kb",
    "email": "kb@example.org",
    "social": { "twitter": "@example" }
  }
}
EOF

fail() {
  echo "❌ init-check FAILED: $1" >&2
  exit 1
}

# CLAUDE.md is a byte-level contract. Do not use command substitution here:
# shells strip trailing newlines, which would make `@AGENTS.md\n\n` look valid.
EXPECTED_CLAUDE_MD="$TMP/expected-CLAUDE.md"
printf '@AGENTS.md\n' > "$EXPECTED_CLAUDE_MD"

claude_shim_is_exact() {
  cmp -s "$1" "$EXPECTED_CLAUDE_MD"
}

assert_rejected_claude_shim() {
  if claude_shim_is_exact "$1"; then
    fail "CLAUDE.md byte comparator accepted invalid fixture: $2"
  fi
}

snapshot() {
  mkdir -p "$1"
  git -C "$ROOT" archive HEAD | tar -x -C "$1"
  # Replant the marker (see header): on an adopted instance, HEAD has no
  # .sekai-template and the re-run guard would refuse the scratch init.
  touch "$1/.sekai-template"
}

echo "── tier 1: double init on scratch copies of HEAD ──"
snapshot "$TMP/run1"
snapshot "$TMP/run2"
node "$TMP/run1/scripts/init/index.mjs" --answers "$ANSWERS" >/dev/null
node "$TMP/run2/scripts/init/index.mjs" --answers "$ANSWERS" >/dev/null

# DoD-2 (determinism): byte-identical place.config.ts across --answers runs.
cmp "$TMP/run1/place.config.ts" "$TMP/run2/place.config.ts" \
  || fail "place.config.ts differs between two --answers runs (not byte-identical)"
echo "✓ two --answers runs produce byte-identical place.config.ts"

# DoD-2 (cross-mode, the §E acceptance): the INTERACTIVE path with the same
# answers must produce the same bytes as --answers. resolveInteractive/parseText
# and resolveFromJson/coerce are parallel per-kind implementations — this is
# where drift would enter. Lines below mirror answers.json in prompt order;
# blank lines take the same defaults the JSON path takes for missing keys.
INPUT="$TMP/interactive-input.txt"
{
  printf '%s\n' "$NAME"                                            # place.name
  printf '%s\n' "Knowledge base for $NAME, the init self-check place."
  printf '%s\n' "$DOMAIN"                                          # place.domain
  printf '\n'                                                      # locale -> en
  printf '4\n'                                                     # categories: custom
  printf 'history\nHistory\nX\nThe record\n'
  printf 'harbor\nHarbor\nX\nThe waterfront\n'
  printf 'nature\nNature\nX\nThe land\n'
  printf 'food\nFood\nX\nThe table\n'
  printf 'events\nEvents\nX\nThe calendar\n'
  printf '\n'                                                      # blank slug: done
  printf '35.1,-120.65\n'                                          # map.center
  printf '12\n'                                                    # map.zoom
  printf '\n'                                                      # maxBounds -> default
  printf '\n\n\n'                                                  # graph/map/dashboard -> defaults
  printf 'n\n'                                                     # soundscape (explicit, as in JSON)
  printf '\n\n'                                                    # feedback/chat -> defaults
  printf 'y\n'                                                     # social (explicit, as in JSON)
  printf '\n'                                                      # analytics -> default
  printf 'https://github.com/example/kb\n'                         # links.repo
  printf 'kb@example.org\n'                                        # links.email
  printf '@example\n'                                              # twitter
  printf '\n\n'                                                    # threads/instagram -> none
} > "$INPUT"
snapshot "$TMP/run3"
node "$TMP/run3/scripts/init/index.mjs" < "$INPUT" >/dev/null
cmp "$TMP/run3/place.config.ts" "$TMP/run1/place.config.ts" \
  || fail "interactive-mode place.config.ts differs from --answers output (cross-mode drift)"
echo "✓ interactive mode with the same answers is byte-identical to --answers"

# DoD-6: seeded artifacts exist.
R="$TMP/run1"
[ -f "$R/FRAMEWORK-VERSION" ] || fail "FRAMEWORK-VERSION not written"
[ -s "$R/FRAMEWORK-VERSION" ] || fail "FRAMEWORK-VERSION is empty"
# AGENTS.md is the instance's agent-instruction SSOT; its header is the place name.
head -1 "$R/AGENTS.md" | grep -q "^# $NAME$" \
  || fail "AGENTS.md header is not '# $NAME'"
# CLAUDE.md is a pure one-line @AGENTS.md shim — all instructions live in AGENTS.md.
claude_shim_is_exact "$R/CLAUDE.md" \
  || fail "CLAUDE.md is not byte-identical to '@AGENTS.md\\n'"

# Regression fixtures prove the byte comparator rejects differences that shell
# command substitution would hide, plus content before or after the shim.
printf '@AGENTS.md\n\n' > "$TMP/claude-trailing-blank.md"
printf '@AGENTS.md' > "$TMP/claude-missing-newline.md"
printf '@AGENTS.md\nAdditional instructions.\n' > "$TMP/claude-added-prose.md"
printf '@AGENT.md\n' > "$TMP/claude-changed-byte.md"
assert_rejected_claude_shim "$TMP/claude-trailing-blank.md" "trailing blank line"
assert_rejected_claude_shim "$TMP/claude-missing-newline.md" "missing final newline"
assert_rejected_claude_shim "$TMP/claude-added-prose.md" "added prose"
assert_rejected_claude_shim "$TMP/claude-changed-byte.md" "changed byte"

# The adopted AGENTS.md must retain the framework's support boundaries. Check
# both headings and contract-bearing text so empty placeholder sections fail.
grep -Fxq "## Language support boundary" "$R/AGENTS.md" \
  || fail "AGENTS.md missing '## Language support boundary'"
grep -Fq "Latin-script content" "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits Latin-script support"
grep -Fq "CJK content is unsupported" "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits unsupported CJK content"
grep -Fq 'place.locale' "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits place.locale"
grep -Fq 'place.languages[]' "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits place.languages[]"
grep -Fxq "## Semiont probe" "$R/AGENTS.md" \
  || fail "AGENTS.md missing '## Semiont probe'"
grep -Fq 'semiont/config.json' "$R/AGENTS.md" \
  || fail "AGENTS.md semiont probe omits semiont/config.json"
grep -Fq "no-op gracefully when it is absent" "$R/AGENTS.md" \
  || fail "AGENTS.md semiont probe omits absent-file behavior"
head -1 "$R/README.md" | grep -q "^# $NAME$" \
  || fail "README.md header is not '# $NAME' (template README left on the instance)"
for cat_dir in History Harbor Nature Food Events; do
  [ -d "$R/knowledge/$cat_dir" ] || fail "knowledge/$cat_dir/ not seeded"
done
[ -f "$R/knowledge/INBOX.md" ] || fail "knowledge/INBOX.md not written"
# The writer's contract is "no articles survive" (rmSync + reseed), so assert
# it wholesale rather than naming demo files that could be renamed later.
LEFTOVER_MD="$(find "$R/knowledge" -type f -name '*.md' ! -name 'INBOX.md')"
[ -z "$LEFTOVER_MD" ] || fail "demo content survived init: $LEFTOVER_MD"
grep -q "^$DOMAIN$" "$R/CNAME" || fail "CNAME does not contain $DOMAIN"
[ ! -f "$R/.sekai-template" ] || fail ".sekai-template marker not removed"
grep -q "^$NAME_LC$" "$R/scripts/ci/genericity-denylist.local.txt" \
  || fail "local denylist does not contain $NAME_LC"
# Dev-plugin encapsulation: a fresh instance ships zero dev-plugin state — the
# .agent-toolkit/ tree is removed by the wizard, and the wizard-regenerated AGENTS.md
# carries none of the framework's dev-plugin sentinel block or reference line.
# Non-vacuous only because the committed tree (git archive HEAD, snapshotted above)
# carries .agent-toolkit/ and, in its AGENTS.md, the dev-plugin block.
[ ! -d "$R/.agent-toolkit" ] || fail ".agent-toolkit/ not stripped from adopted instance"
if grep -q "@.agent-toolkit/dev.md" "$R/AGENTS.md"; then
  fail "AGENTS.md carries a dev-plugin reference line (should be absent on an instance)"
fi
if grep -Fq "<!-- dev-plugin:" "$R/AGENTS.md"; then
  fail "AGENTS.md carries the dev-plugin sentinel block (should be absent on an instance)"
fi
if grep -Fxq "## Template mode" "$R/AGENTS.md"; then
  fail "AGENTS.md carries template-only '## Template mode'"
fi
echo "✓ seeded artifacts present (FRAMEWORK-VERSION, complete instance AGENTS.md, byte-exact CLAUDE.md shim, README.md header, category dirs, INBOX.md, CNAME, local denylist, marker removed, .agent-toolkit/ removed + template/dev-plugin AGENTS.md content absent)"

# DoD-4: a planted place-name string in src/ fails the gate; framework denylist
# untouched.
cmp "$R/scripts/ci/genericity-denylist.txt" "$ROOT/scripts/ci/genericity-denylist.txt" \
  || fail "framework denylist was modified by init"
PLANT="$R/src/planted-init-check.ts"
printf "export const leaked = '%s';\n" "$NAME" > "$PLANT"
if bash "$R/scripts/ci/check-genericity.sh" >/dev/null 2>&1; then
  fail "gate PASSED with a planted place-name string in src/ (local denylist not live)"
fi
rm "$PLANT"
bash "$R/scripts/ci/check-genericity.sh" >/dev/null 2>&1 \
  || fail "gate fails on the clean post-init tree"
echo "✓ planted place-name string in src/ fails the gate; clean tree passes"

if [ "$BUILD" = false ]; then
  echo "✅ init-check passed (tier 1). Pass --build on a DISPOSABLE clone/CI to add the in-place init + build tier."
  exit 0
fi

echo "── tier 2 (--build): in-place init + full build in $ROOT ──"
# Same replant as snapshot(): the CI checkout of an adopted instance has no
# marker and the in-place init would hit the re-run guard. This checkout is
# disposable (see header); init removes the marker.
touch "$ROOT/.sekai-template"
node "$ROOT/scripts/init/index.mjs" --answers "$ANSWERS"
bash "$ROOT/scripts/ci/check-genericity.sh" \
  || fail "post-init genericity gate failed in instance mode"
(cd "$ROOT" && npm run build) || fail "npm run build failed on the initialized instance"
echo "✅ init-check passed (tier 1 + build tier): init → diff → gate → build all green."
