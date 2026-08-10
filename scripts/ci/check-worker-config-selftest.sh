#!/usr/bin/env bash
#
# check-worker-config-selftest.sh -- non-vacuity proof for the worker config
# gate (scripts/ci/check-worker-config.mjs) and behavioral proof for the config
# generator (scripts/deploy/gen-worker-config.mjs).
#
# A guard that only ever asserts the green path proves nothing: it would pass
# just as happily with an empty file list or an unreachable comparison. This
# test plants eleven defect classes -- every kind of deployment identity that
# must never be committed, plus the worker the guard has never heard of, the
# template that lost a whole block, the derived artifacts that must never be
# tracked, and the four ways the runbook can stop telling the truth about a
# shipped default -- and requires the guard to FAIL each time:
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
#   5. DROPPED D1    -- the [[d1_databases]] block deleted outright. Every check
#                       above is per-key, so a template with no block has no
#                       offending key to find; the generator then emits a deploy
#                       config with no database binding and the deployed worker
#                       hits `env.DB.prepare` with `env.DB` undefined. Absence
#                       must fail as loudly as a wrong value.
#   6. TRACKED DERIVED  -- a generated worker config and a generated embedding
#                       index committed to git. Both are gitignored AND skipped
#                       by name in the two machine gates, so a tracked one is
#                       invisible to every other check in this repository: this
#                       guard is the only thing standing between it and a
#                       release. The fixture is a real git repository, because
#                       the check reads `git ls-files`.
#   7. DROPPED AI       -- the chat worker's [ai] binding deleted outright. A
#                       deployed worker without it cannot call env.AI.run.
#   8. STALE DEFAULT -- docs/runbook/DEPLOY.md documenting a shipped constant
#                       the template no longer carries. The runbook is where an
#                       operator reads the value before tuning it, and a wrong
#                       number there reads exactly like a right one.
#   9. UNDOCUMENTED  -- a shipped default with no row in the runbook table. The
#                       same contract from the other end: a constant nobody can
#                       look up is a constant nobody can tune back.
#  10. DROPPED ANCHOR-- the <!-- worker-vars: --> comment removed. It is what
#                       ties a table to this gate, so deleting it must fail
#                       rather than quietly exempt the table.
#  11. DROPPED OVERRIDE -- the ", override `workers.<key>`" clause removed from a
#                       Source cell whose var an instance may retune. The runbook
#                       is where an operator is told to measure a value; a table
#                       that states the default and not where the answer goes
#                       sends them back to editing a framework-owned file.
#
# Classes 8-11 need a fixture carrying the runbook as well as workers/; the
# copies used by 1-7 have no docs/ tree, which also exercises the guard's
# skip-when-absent path.
#
# The classes after those cover the other half of the same contract: the
# GENERATOR (scripts/deploy/gen-worker-config.mjs) writing the deploy-time
# tuning vars an instance may override from place.config.ts. Nine more:
#
#  12. UNSET       -- a place.config.ts setting none of the override keys must
#                     generate a config byte-identical to the one recorded in
#                     scripts/ci/fixtures/worker-config-chat-unset.toml, which
#                     was produced before the override path existed. That is
#                     what makes the absent-safe claim checkable rather than
#                     asserted: a stray formatting change, a reordered key, or
#                     an override that fires when its key is unset all fail here.
#  13. SET         -- all three keys set to non-default values must reach the
#                     generated [vars] block quoted the way the template writes
#                     them, and must change NOTHING else: exactly three lines
#                     differ from the recorded unset output.
#  14-19. REJECTED -- a non-numeric value, a floor outside 0..1, each rate limit
#                     below 1, a fractional count, and a non-finite number must
#                     fail generation by name. The worker parses these vars
#                     leniently and falls back to its own defaults, so a value it
#                     cannot use would otherwise deploy clean and behave as if the
#                     instance had configured nothing. Every one of these asserts
#                     the message names the offending VALUE as well as the key:
#                     19 exists because Infinity is the one input where the
#                     obvious way to render it (JSON.stringify) silently reports
#                     "null" instead, naming a value the config does not contain.
#  20. DROPPED VAR -- a key set in place.config.ts whose [vars] entry the template
#                     no longer carries. Generation must SUCCEED, warn naming the
#                     key, the value, and the var, and leave the var out of the
#                     generated config. An instance reaches this only by
#                     upgrading, and stopping generation there would leave it
#                     unable to deploy any worker over one stale key; the fatal
#                     half of the contract is check-worker-config.mjs, which
#                     fails at CI time on the same mismatch.
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
# exit 1 when the guard fails to catch a planted defect or the generator
# mishandles an override, exit 0 when all twenty classes hold)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-worker-config.mjs"
GENERATOR="$ROOT/scripts/deploy/gen-worker-config.mjs"

# The chat config the generator produces from the fixture place.config.ts below
# with none of the tuning keys set. Recorded from the generator as it stood
# before the override path existed, which is the only thing that makes class 12
# a regression test rather than a restatement of current behavior.
EXPECTED_UNSET="$ROOT/scripts/ci/fixtures/worker-config-chat-unset.toml"
GENERATED_REL="workers/chat/wrangler.generated.toml"

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

# The same fixture plus the runbook, for the classes that plant into the
# documented defaults rather than into a template.
RUNBOOK_REL="docs/runbook/DEPLOY.md"
fresh_copy_with_runbook() {
  label="$1"
  copy="$(fresh_copy "$label")"
  mkdir -p "$copy/$(dirname "$RUNBOOK_REL")"
  cp "$ROOT/$RUNBOOK_REL" "$copy/$RUNBOOK_REL"
  echo "$copy"
}

# Rewrite the copied runbook with `filter` applied to it (sed or grep), and fail
# loudly when that changes nothing: text this test plants against that has moved
# would otherwise hand the guard a compliant file to pass on.
plant_runbook() {
  copy="$1"; what="$2"; shift 2
  target="$copy/$RUNBOOK_REL"
  "$@" < "$target" > "$WORK_DIR/plant.tmp" || true
  if cmp -s "$WORK_DIR/plant.tmp" "$target"; then
    echo "worker config self-test: planting [$what] changed nothing in $RUNBOOK_REL --" >&2
    echo "  the text this test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
  cp "$WORK_DIR/plant.tmp" "$target"
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

# Commit $WORK_DIR/plant.tmp over the copied template. An edit that changes
# nothing means the shipped file no longer carries the text this test plants
# against, which must fail loudly instead of handing the guard a compliant file
# to pass on.
commit_plant() {
  target="$1"; what="$2"
  if cmp -s "$WORK_DIR/plant.tmp" "$target"; then
    echo "worker config self-test: planting [$what] changed nothing in $REL -- the text" >&2
    echo "  this test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
  cp "$WORK_DIR/plant.tmp" "$target"
}

# Replace a literal line in the copied template (portable: sed -i differs
# between BSD and GNU, so write through a temp file).
plant() {
  copy="$1"; from="$2"; to="$3"
  target="$copy/$REL"
  sed "s|$from|$to|" "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$from"
}

# Delete a whole [[table]] block from the copied template: the header line and
# every line after it up to the next table header or end of file.
drop_table() {
  copy="$1"; header="$2"
  target="$copy/$REL"
  awk -v header="$header" '
    $0 == header { skip = 1; next }
    skip == 1 && substr($0, 1, 1) == "[" { skip = 0 }
    skip == 1 { next }
    { print }
  ' "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$header"
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

# 5. DROPPED D1: the whole [[d1_databases]] block removed. No key is wrong
# because no key is left, so only a registered block count catches it.
COPY="$(fresh_copy dropped-d1)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
drop_table "$COPY" '[[d1_databases]]'
assert_guard_catches "$COPY" "a deleted [[d1_databases]] block"

# 6. TRACKED DERIVED: both generated artifacts committed. The check reads
# `git ls-files`, so the fixture must be a real repository -- staged is enough,
# no commit needed. The copies above are not repositories, which is exactly why
# this class needs its own fixture rather than riding along with one of them.
COPY="$(fresh_copy tracked-derived)"
git -C "$COPY" init -q
assert_guard_passes "$COPY" "a git repository with no derived artifact tracked"
FEEDBACK_WORKER="$(dirname "$COPY/$REL")"
printf 'name = "planted"\n' > "$FEEDBACK_WORKER/wrangler.generated.toml"
mkdir -p "$COPY/workers/chat"
printf '{"schema":"rag-v1","count":0}\n' > "$COPY/workers/chat/vectors.json"
git -C "$COPY" add -A
assert_guard_catches "$COPY" "a tracked generated worker config" \
  "$(basename "$FEEDBACK_WORKER")/wrangler.generated.toml"
assert_guard_catches "$COPY" "a tracked generated embedding index" \
  "workers/chat/vectors.json"

# 7. DROPPED AI: the registered chat worker must keep the Workers AI binding.
COPY="$(fresh_copy dropped-ai)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
drop_table "$COPY" '[ai]'
assert_guard_catches "$COPY" "a deleted [ai] block"

# 8. STALE DEFAULT: the runbook documenting a constant the template does not
# ship. Nothing else in this repository compares the two.
COPY="$(fresh_copy_with_runbook stale-default)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a retuned default' \
  sed 's|template (`0.46`)|template (`0.9`)|'
assert_guard_catches "$COPY" "a documented default the template does not ship" "$RUNBOOK_REL"

# 9. UNDOCUMENTED: a shipped default with no row to read it from.
COPY="$(fresh_copy_with_runbook undocumented-default)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted default row' grep -v 'RELEVANCE_FLOOR'
assert_guard_catches "$COPY" "a shipped default the runbook documents nowhere" "$RUNBOOK_REL"

# 10. DROPPED ANCHOR: the comment that ties a table to this gate, removed.
COPY="$(fresh_copy_with_runbook dropped-anchor)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted table anchor' grep -v 'worker-vars: chat'
assert_guard_catches "$COPY" "a deleted worker-vars anchor" "$RUNBOOK_REL"

# 11. DROPPED OVERRIDE: the Source cell still states the right default, but no
# longer says where a retuned value goes. Only the override cross-check catches
# it; every value comparison above still passes.
COPY="$(fresh_copy_with_runbook dropped-override)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted override key' \
  sed 's|template (`0.46`), override `workers.chatRelevanceFloor`|template (`0.46`)|'
assert_guard_catches "$COPY" "a Source cell that no longer names its override key" "$RUNBOOK_REL"

# -- The generator's override path ------------------------------------------
#
# Everything above points the GATE at a mutated tree. Everything below runs the
# GENERATOR against a fixture place.config.ts and reads what it wrote.

# A fixture root: the committed workers/ tree plus a place.config.ts whose
# `workers` block is exactly the lines passed as $2 (empty for none). The place
# name and domain are invented -- this file lives under scripts/, which both
# machine gates scan.
fresh_copy_with_place_config() {
  label="$1"; workers_body="$2"
  copy="$(fresh_copy "$label")"
  {
    echo 'const config = {'
    echo "  place: { name: 'Selftest Place', domain: 'selftest.example' },"
    echo '  categories: [],'
    echo '  workers: {'
    if [ -n "$workers_body" ]; then printf '%s\n' "$workers_body"; fi
    echo '  },'
    echo '};'
    echo 'export default config;'
  } > "$copy/place.config.ts"
  echo "$copy"
}

# Node needs the type-stripping flag to import a .ts config, the same way the
# `npm run worker-config` script passes it.
run_generator() {
  where="$1"
  node --experimental-strip-types "$GENERATOR" --root "$where" > "$OUT" 2>&1
}

assert_generator_succeeds() {
  where="$1"; label="$2"
  if ! run_generator "$where"; then
    echo "worker config self-test: the generator failed on $label -- cannot trust the" >&2
    echo "  assertions that read its output:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# The generator must FAIL and name both the offending place.config.ts key and
# the value it rejected. Naming only one leaves an operator guessing which of
# three keys they mistyped.
assert_generator_rejects() {
  where="$1"; what="$2"; want_key="$3"; want_value="$4"
  if run_generator "$where"; then
    echo "FAIL: worker config self-test -- the generator ACCEPTED $what. The worker falls" >&2
    echo "  back to its own default for a value it cannot parse, so this would deploy" >&2
    echo "  clean and behave as if nothing had been configured." >&2
    cat "$OUT" >&2
    exit 1
  fi
  for want in "$want_key" "$want_value"; do
    if ! grep -q -- "$want" "$OUT"; then
      echo "FAIL: worker config self-test -- the generator rejected $what but its output" >&2
      echo "  never names $want:" >&2
      cat "$OUT" >&2
      exit 1
    fi
  done
}

# The generator must SUCCEED and say every remaining argument. Used for the path
# where a value cannot be applied but generation must still finish: a silent drop
# and a hard stop are both wrong, so both the success and the words are asserted.
assert_generator_warns() {
  where="$1"; what="$2"; shift 2
  if ! run_generator "$where"; then
    echo "FAIL: worker config self-test -- the generator STOPPED on $what. It must warn," >&2
    echo "  drop the value, and finish: an instance reaches this by upgrading, and a stop" >&2
    echo "  leaves it unable to deploy any worker over one stale key." >&2
    cat "$OUT" >&2
    exit 1
  fi
  for want in "$@"; do
    if ! grep -q -- "$want" "$OUT"; then
      echo "FAIL: worker config self-test -- the generator continued past $what but its" >&2
      echo "  output never names $want:" >&2
      cat "$OUT" >&2
      exit 1
    fi
  done
}

assert_generated_var() {
  where="$1"; key="$2"; want="$3"
  if ! grep -q "^$key = $want\$" "$where/$GENERATED_REL"; then
    echo "FAIL: worker config self-test -- $GENERATED_REL does not carry" >&2
    echo "  $key = $want. The override never reached the generated [vars] block:" >&2
    cat "$where/$GENERATED_REL" >&2
    exit 1
  fi
}

# 12. UNSET: the absent-safe case, proven byte for byte against output recorded
# before these keys existed. An override that fires on an unset key, or any
# incidental formatting drift, fails here rather than in someone's deploy.
COPY="$(fresh_copy_with_place_config generate-unset "")"
assert_generator_succeeds "$COPY" "a place.config.ts setting no tuning overrides"
if ! cmp -s "$COPY/$GENERATED_REL" "$EXPECTED_UNSET"; then
  echo "FAIL: worker config self-test -- with no tuning key set, the generated chat config" >&2
  echo "  is no longer byte-identical to the recorded pre-override output. Adding these" >&2
  echo "  keys must change nothing for an instance that sets none of them." >&2
  diff "$EXPECTED_UNSET" "$COPY/$GENERATED_REL" >&2 || true
  echo "  If the committed template legitimately changed, re-record the expectation:" >&2
  echo "    cp <a generated chat config from this fixture> $EXPECTED_UNSET" >&2
  exit 1
fi

# 13. SET: all three reach [vars] with their exact values, quoted as TOML
# strings the way the template writes them, and nothing else moves.
COPY="$(fresh_copy_with_place_config generate-set "    chatRateLimitMax: 60,
    chatRateLimitWindowSeconds: 900,
    chatRelevanceFloor: 0.52,")"
assert_generator_succeeds "$COPY" "a place.config.ts setting all three tuning overrides"
assert_generated_var "$COPY" 'RATE_LIMIT_MAX' '"60"'
assert_generated_var "$COPY" 'RATE_LIMIT_WINDOW_SECONDS' '"900"'
assert_generated_var "$COPY" 'RELEVANCE_FLOOR' '"0.52"'
CHANGED="$(diff "$EXPECTED_UNSET" "$COPY/$GENERATED_REL" | grep -c '^>' || true)"
if [ "$CHANGED" != "3" ]; then
  echo "FAIL: worker config self-test -- setting the three tuning keys changed $CHANGED line(s)" >&2
  echo "  in the generated chat config; exactly 3 must change." >&2
  diff "$EXPECTED_UNSET" "$COPY/$GENERATED_REL" >&2 || true
  exit 1
fi

# 14. NON-NUMERIC: the declared type is a number; anything else is a typo that
# must not survive to a deploy.
COPY="$(fresh_copy_with_place_config generate-bad-type "    chatRateLimitMax: 'sixty',")"
assert_generator_rejects "$COPY" "a non-numeric override value" \
  'workers.chatRateLimitMax' 'sixty'

# 15. FLOOR OUT OF RANGE: it is compared against a cosine score, so a value
# above 1 is one no chunk can ever clear.
COPY="$(fresh_copy_with_place_config generate-bad-floor "    chatRelevanceFloor: 1.5,")"
assert_generator_rejects "$COPY" "a relevance floor outside 0..1" \
  'workers.chatRelevanceFloor' '1.5'

# 16. RATE LIMIT BELOW 1: not a smaller budget, a worker that rejects everyone.
COPY="$(fresh_copy_with_place_config generate-bad-max "    chatRateLimitMax: 0,")"
assert_generator_rejects "$COPY" "a rate-limit ceiling below 1" \
  'workers.chatRateLimitMax' '0'

# 17. WINDOW BELOW 1: the same, one key over.
COPY="$(fresh_copy_with_place_config generate-bad-window "    chatRateLimitWindowSeconds: 0,")"
assert_generator_rejects "$COPY" "a rate-limit window below 1 second" \
  'workers.chatRateLimitWindowSeconds' '0'

# 18. FRACTIONAL COUNT: in range and numeric, so every check above passes it. The
# worker floors it, which means "20.7" deploys a ceiling of 20 while
# place.config.ts states something else -- the exact silent divergence this
# validation layer exists to prevent, and the one branch of it that shipped with
# no class of its own.
COPY="$(fresh_copy_with_place_config generate-fractional-max "    chatRateLimitMax: 20.7,")"
assert_generator_rejects "$COPY" "a fractional rate-limit ceiling" \
  'workers.chatRateLimitMax' '20.7'

# 19. NON-FINITE: Infinity is a number and passes `typeof`, so only the finite
# check stops it. It is asserted separately because it is the one value whose
# report is easy to get wrong: JSON.stringify(Infinity) is the string "null", so
# a message built that way names a value place.config.ts does not contain and
# sends the operator looking for a key they never set.
COPY="$(fresh_copy_with_place_config generate-non-finite "    chatRelevanceFloor: Infinity,")"
assert_generator_rejects "$COPY" "a non-finite override value" \
  'workers.chatRelevanceFloor' 'Infinity'

# 20. DROPPED VAR: the key is set and valid, but the template no longer carries
# the [vars] entry it overrides -- the shape of a framework release that removed
# a var an instance had tuned. Generation must finish, warn by name, and write a
# config without the var. Both failure modes are real: a silent drop deploys the
# framework default while place.config.ts says otherwise, and a hard stop blocks
# every other worker's config over one stale key.
COPY="$(fresh_copy_with_place_config generate-dropped-var "    chatRelevanceFloor: 0.52,")"
grep -v '^RELEVANCE_FLOOR' "$COPY/$REL" > "$WORK_DIR/plant.tmp"
commit_plant "$COPY/$REL" "RELEVANCE_FLOOR"
assert_generator_warns "$COPY" "a tuning key whose template var was removed" \
  'WARNING' 'workers.chatRelevanceFloor' '0.52' 'RELEVANCE_FLOOR' 'Generated without it'
if grep -q '^RELEVANCE_FLOOR' "$COPY/$GENERATED_REL"; then
  echo "FAIL: worker config self-test -- the generator warned that it dropped the override" >&2
  echo "  but $GENERATED_REL carries RELEVANCE_FLOOR anyway:" >&2
  cat "$COPY/$GENERATED_REL" >&2
  exit 1
fi

echo "OK: worker config self-test passed -- the guard catches committed identity, unregistered workers, missing D1 or AI bindings, tracked derived artifacts, and a runbook that has drifted from the shipped defaults; the generator carries the template through unchanged when no tuning key is set, writes each key that is set, rejects a value the worker could not use, and warns rather than stops when a set key's template var is gone"
