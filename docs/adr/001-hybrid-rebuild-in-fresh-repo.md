# ADR 001: Hybrid rebuild in a fresh repo

**Status:** Accepted (2026-07-04, `.fable/STRATEGIC-DIRECTION.md` §A1)
**Deciders:** Wilson Choi, with Fable 5 as architect

## Context

Three ways to continue lagunabeach.md existed: keep maintaining the taiwan-md fork, do a
blind greenfield rewrite, or a hybrid. The fork's cost was structural: the last upstream
merge (297 commits) required 3 phases of de-Taiwan work; 34 `.astro` files still hardcoded
"Laguna"; upstream assumptions (CJK bigram recall, 3000-article expectations) kept
resurfacing. The genuinely valuable inheritance was ~30 files of 1,519. A prior greenfield
(v0) failed because the design was *described in prompts* instead of copied as files.

## Decision

Stop maintaining the fork. Create a fresh Astro project and extract into it, as literal
files: the design system (7 CSS files, ~2,500 lines), ~15 curated components, ~10 build
scripts, and the editorial tooling (§C is the contract). Write page shells and everything
else clean. The fork is archived read-only as `lagunabeach-md-v1` after domain cutover
(§E 3.2). Upstream merging ends permanently; future Taiwan.md improvements are deliberate
idea cherry-picks, re-implemented generic (§G risk 5).

## Consequences

- Extraction is a bounded 2-3 day job vs unbounded de-Taiwan maintenance.
- The v0 failure mode (design-by-prompt) cannot recur: design ships as copied files, with
  byte-diff acceptance where §C says verbatim, and the fork-copy fallback if any page
  misses the visual bar (§G risk 1).
- Losing future upstream improvements is an accepted, priced cost.
