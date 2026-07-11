# Genericity gate: what it actually checks (and what it doesn't)

Two machine gates run over the same code trees, wired into the `genericity` CI job and the
`npm run genericity` script:

- `scripts/ci/check-genericity.sh` — case-insensitive substring grep of a small place-name
  denylist (`laguna`, `taiwan`, …).
- `scripts/ci/check-english-only.mjs` — fails on any CJK-range codepoint
  (`U+3000–U+9FFF`, `U+FF00–U+FFEF`); the site is English-only (STRATEGIC-DIRECTION
  2026-07-11 (b)). U+2014 em dash and U+201C/U+201D curly quotes are below U+3000 and are
  not flagged.

**Scan scope: `src/`, `scripts/`, AND `tests/`** (extended in LB-20 from the original
`src/` + `scripts/`). Test fixtures are code — the English-only + genericity doctrine is
whole-project, never per-directory (STRATEGIC-DIRECTION 2026-07-11 (b); the earlier
`scripts/`-only reading let `author: 'Taiwan.md'` and zh-TW fixtures ship in `tests/`).
`workers/` is in the CJK gate's root list for when it arrives. Derived projections
`src/content/` and `src/data/` (gitignored, place-specific by nature) are excluded from both
gates by construction. Two consequences recur:

1. **They scan comments and doc-strings, not just code.** A cleanup comment that quotes the
   fork's place-named identifiers verbatim (e.g. "stripped the `laguna-beach-geocode.json`
   lookup") fails the gate exactly like live code. When documenting what you removed from a
   fork file, describe it generically ("the geocode lookup table") — never quote the
   place-named symbol. Likewise a CJK codepoint in a comment or a test fixture body fails the
   English-only gate; re-fixture in English rather than carrying fork CJK.

2. **They do NOT check hex colors.** DoD prose like "zero hex colors in `src/`" means *no
   place/category palette baked into framework code* — marker/category colors come from
   `src/utils/categoryConfig.ts`. It does not forbid the design-system brand/theme hexes
   (e.g. brand navy `#0e3a5c`) used throughout `src/` templates; those are approved chrome,
   the gate does not flag them, and they are not review blockers nor candidates for
   abstraction.

**Why (LB-15):** (1) a doc-comment naming `laguna-beach-geocode.json` failed the gate and
forced a reword cycle; (2) review and verify both had to reason around DoD-3's literal "zero
hex colors" because brand `#0e3a5c` (in `categoryConfig.ts` + ~57 `src/` uses) is legitimate
chrome — the load-bearing intent (no place palette in framework code) was met (PR #16).

**Why (LB-20):** the article-health review passed CI while `author: 'Taiwan.md'` and heavy
zh-TW fixtures shipped in `tests/`, because the gate scanned only `src/` + `scripts/` and had
no CJK check. Wilson's 2026-07-11 (b) ruling made the doctrine whole-project; the gate's scan
scope was extended to `tests/` and the CJK-codepoint gate added, both landing in LB-20 (PR #20).
