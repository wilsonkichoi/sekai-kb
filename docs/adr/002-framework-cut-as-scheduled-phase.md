# ADR 002: Framework cut as a scheduled phase, genericity CI-gated from day one

**Status:** Accepted (2026-07-04, `.fable/STRATEGIC-DIRECTION.md` §A2)
**Deciders:** Wilson Choi, with Fable 5 as architect

## Context

The framework (sekai-kb) could be built first, simultaneously in two repos, or extracted
"later" from the instance. Framework-first with zero instances repeats Taiwan.md's coupling
mistake in mirror image (guessing the config surface instead of deriving it from a real
place). Two simultaneous repos double merge traffic during peak churn.
Extract-later is the deferral trap this project was burned by before.

## Decision

One repo through Phase 4, under a hard genericity rule from day one: **zero place-specific
strings in `src/` or `scripts/`; all place identity flows from `place.config.ts` +
`knowledge/` + `public/media/`**, enforced by `scripts/ci/check-genericity.sh` in CI
(§E 0.3). The framework repo `sekai-kb` is cut as Phase 5 — after LB content parity and
domain cutover, and **before** any Phase 6/7 LB feature. Phases 6-7 declare `Depends: 5.4`,
making the ordering structural rather than aspirational (§G risk 3).

## Consequences

- Late extraction is safe because nothing place-specific can bake into shared code — the
  build fails if it does.
- The config surface is derived from a real instance, then proven against a real second
  place (the dana-point acceptance, §E 5.2c).
- LB's most-wanted features are hostage to the framework shipping — deliberately.
- Framework scope is bounded: a feature exists only if LB uses it or it is one of the six
  named adopter needs (§G risk 6).
