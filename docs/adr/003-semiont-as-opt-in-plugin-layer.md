# ADR 003: Semiont as an opt-in plugin layer

**Status:** Accepted (2026-07-04, `.fable/STRATEGIC-DIRECTION.md` §A3)
**Deciders:** Wilson Choi, with Fable 5 as architect

## Context

Taiwan.md's Semiont (AI-organism identity layer) is a monolith: a 753-line awakening
protocol, organs that read each other's files, and site code entangled with identity
machinery. The audit found memory/reflexes/manifesto/routine earn their keep; the
introspection organs are art. Laguna Beach is an art town and Wilson values the
experiment — but adopters must not be forced to take it.

## Decision

Semiont becomes a `semiont/` directory the site build never imports from — **the site must
build with the directory deleted** (CI-checked in Phase 8). A `semiont/config.json`
manifest lists enabled organs. Default-on core: boot identity (<150-line replacement for
the BECOME protocol), MEMORY (session handoff), REFLEXES (don't-do rules). Opt-in:
MANIFESTO, DIARY, ROUTINE, INTROSPECTION pack. Constraints: organs may not require each
other; no organ reads another organ's files; skills probe for organ existence and no-op
gracefully when absent. LB enables core + MANIFESTO at launch (§E 8.2).

## Consequences

- Plug-and-play becomes real rather than aspirational: the two constraints (build-without,
  no cross-dependency) are exactly what Taiwan.md's monolith violates.
- The art stays available without being mandatory or deleted.
- Phase 8 builds the organ shells fresh; only MANIFESTO/REFLEXES prose is salvaged by
  hand from the v1 archive (§F).
