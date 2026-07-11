# ADR 004: Tagged-release upgrade discipline for instances

**Status:** Accepted (2026-07-05 revision, `.fable/STRATEGIC-DIRECTION.md` §B "Repo topology")
**Deciders:** Wilson Choi, with Fable 5 as architect

## Context

After Phase 5 there are two repos: `sekai-kb` (framework SSOT, GitHub template) and
`lagunabeach-md` (instance #1), with more instances expected. The v1 fork demonstrated how
instance/upstream merges rot: a moving upstream main re-floods place-specific assumptions
and every merge becomes a triage project. Instances need framework updates without that
cost.

## Decision

Instances merge **immutable semver release tags, never framework main**:
`git fetch framework && git merge sekai-kb-vX.Y.Z`. Determinism by construction:

1. Merge target is a tag with a `CHANGELOG.md` entry; breaking config changes carry an
   upgrade note.
2. The template contains zero place content (CI-enforced, §E 5.1).
3. Instance-owned files (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`,
   `CLAUDE.md`) carry `.gitattributes merge=ours` — the mechanism already proven on the
   fork's CLAUDE.md.
4. **Ownership rule:** in an instance, `src/` and `scripts/` are framework-owned.
   Customization goes through config/content/media; anything beyond is upstreamed to
   sekai-kb first, then pulled back as a release (reverse flow lands in sekai-kb within
   the same work item — review-checklist enforced, §G risk 4).

`FRAMEWORK-VERSION` records the instance's version; the `/upgrade` skill wraps
fetch → merge tag → build-verify → conflict report → version bump (§E 5.4, proven by a
demonstrated clean tag merge as acceptance).

## Consequences

- Upgrades are reproducible on every instance at the same version.
- Instance-local drift in framework-owned trees is the one hole the ownership rule closes;
  it costs contributors an upstream-first habit.
- The fork-vs-rewrite failure mode cannot structurally recur between sekai-kb and its
  instances.
