# Clean rebuild: dead fork-era code is a blocker, not a nit

This is a clean rebuild, not a fork maintenance project. Unreachable code carried from the
fork (dead language fallbacks, hardcoded strings for features that don't exist, comments
referencing the fork's context) is not "harmless residue" or "low priority." It is dirty code
that must be removed at extraction time.

**Review behavior:**

- Dead fork-era logic (unreachable branches, hardcoded strings for languages/features not in
  this site) is a BLOCKER, not a SUGGESTION or NIT.
- "Unreachable today" is not a defense. Unreachable means it should not exist.
- "Harmless" is not a defense. Clean means clean.

**Extraction behavior:**

- Strip dead fork-era logic at extraction time, not as a follow-up.
- If uncertain whether something is dead vs load-bearing, ask, don't ship it with a "low
  priority" comment.
- **Sweep a ported fork file for CJK / zh-TW artifacts before hand-off.** The fork is
  zh-TW; ported pages carry transforms that are silent no-ops on English content and easy
  to skim past (the fullwidth colon `：` U+FF1A reads almost like `:`). Grep the ported file
  for CJK-range codepoints as part of the extraction sweep — `rg -n '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' <file>`
  (unicode-aware), or at minimum `grep -n '：' <file>` for the specific offender. Any hit is
  dead fork code unless it is load-bearing for a language this site actually ships.

**Why (LB-3 review):** the first review classified dead zh-TW search strings and a '中' badge
as S1/SUGGESTION ("unreachable", "harmless", "low priority"), tried to approve without
requiring the fix. Wilson rejected: "unreachable means non-acceptable dirty code." Required a
second review cycle to land the cleanup that should have been a blocker on the first pass.
