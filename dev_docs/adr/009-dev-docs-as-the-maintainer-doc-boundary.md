# ADR 009: `dev_docs/` is the maintainer-doc boundary, and the boundary is a directory

**Status:** Accepted (2026-08-04)
**Deciders:** Wilson Choi
**Supersedes:** ADR 008(a) and ADR 008(d) in their path details; ADR 008's reasoning stands
unchanged.

## Context

ADR 008 put the framework's PRD, SPEC, ROADMAP, and ADRs in this repository under `docs/`,
and had the init wizard strip those four paths at adoption. The ownership split it decided
was right and is not reopened here. What it got wrong was where the boundary lives.

**The boundary was a list, not a place.** `MAINTAINER_DOCS` in `scripts/init/writer.mjs`
enumerated four paths inside a directory that also held two adopter-facing trees. Everything
under `docs/` that was not on the list shipped to adopters. That makes the *default* wrong:
a maintainer adding a document to `docs/` puts it on the adopter side unless someone
remembers to extend an array in a script they are not editing.

**It had already failed once, silently.** `docs/diagrams/` holds the three `.drawio` sources
that `AGENTS.md` calls the engineering SSOT. They describe the framework's architecture —
its repo topology, its build pipeline, its instance/framework split. They were never added
to the strip list, so every adopted instance received architecture diagrams for a codebase
it does not maintain. Nothing was wrong with the diagrams and nothing was wrong with the
gate; the shape of the declaration simply did not make anyone notice.

**Phase 7 was about to make it worse.** The phase-7-through-11 platform research is
maintainer material by any reading, and it is roughly 60 KB of it. Landing it under `docs/`
would have shipped it to adopters, or required a fifth list entry, or both.

A fourth consideration: `docs/baselines/**` carried its own `merge=ours` line, separate from
the maintainer-doc block, for the same class of content (an instance's captured baselines).
Two mechanisms for one idea.

## Decision

**(a) Framework maintainer documents live in `dev_docs/`, and `docs/` becomes
adopter-facing by definition.** `dev_docs/` holds `PRD.md`, `SPEC.md`, `ROADMAP.md`, `adr/`,
`diagrams/`, and `research/`. `docs/` holds `playbook/` and `runbook/` and nothing else. The
rule a maintainer has to remember collapses to one sentence: *if an adopter does not operate
with it, it goes in `dev_docs/`.*

**(b) The strip declaration is the single directory.** `MAINTAINER_DOCS = ['dev_docs']`.
Everything still derives from that one array — the wizard's strip, the framework-docs gate's
dangling scan, the upgrade helper's classify/reconcile, and the instance-side guard. A
document added under `dev_docs/` later is on the correct side with no edit to any list.

**(c) `docs/diagrams/` is reclassified as maintainer state and moves.** This is
adopter-visible: instances stop receiving the `.drawio` sources. That is the intent — they
document the framework, not an adopted site — and it is called out in the release's
CHANGELOG entry rather than only here.

**(d) `merge=ours` collapses to `dev_docs/** merge=ours`.** One attribute line replaces four
plus the separate baselines line. An instance that keeps its own planning documents,
decision records, or captured baselines under `dev_docs/` is protected by default, including
documents it adds after the attribute was written. ADR 008(f)'s reasoning is unchanged; only
its granularity is.

**(e) Research is ported de-placed, never raw.** `dev_docs/research/` holds the
phase-7-through-11 platform research transformed by the genericity transform: place identity
removed, everything else — cost tables, escalation paths, worker skeletons, tuning
constants, rejected alternatives — retained. `OMISSIONS.md` records every dropped passage
against the non-goal that excludes it, so an omission is auditable rather than silent.

This is a constraint, not only a preference. Both genericity gates scan the whole tree in
template mode and their exclusions are filename-based, so raw research would fail CI on
place-name and CJK hits. **Being stripped at adoption is not an exemption from the gates** —
`.agent-toolkit/` is stripped too and is still scanned. The byte-exact originals live in
instance #1's repository as its lineage (ADR 008(b)).

**(f) The wizard's own emitted text is now checked.** `check-framework-docs.mjs` must exempt
the wizard from its dangling-reference scan, because a strip mechanism has to name what it
strips. The cost is that the `AGENTS.md` and `README.md` bodies the wizard *emits* live
inside that exemption and were never scanned. `scripts/init/check-init.sh` now asserts that
the really-stripped tree contains no occurrence of any stripped path, with a planted inverse
proving the assertion can fail. Moving `diagrams/` is what would have exercised this hole
(the wizard's `AGENTS.md` template named it), which is why the fix ships with the move.

**(g) Upgrading across this relocation is move-then-merge.** An instance holding its own
documents at the old paths must `git mv` them to `dev_docs/` and declare
`dev_docs/** merge=ours` **in the same branch, before** merging the tag. Done in that order,
the old paths delete cleanly on both sides and the new tree is an add/add that the `ours`
driver resolves in the instance's favour; `reconcile` then recognises the relocated tree as
owned because it existed at the pre-merge revision. Merging first and relocating afterwards
produces modify/delete conflicts the driver does not resolve. The release carries this as an
Upgrade note, and `check-upgrade-state.sh` case 9 is the fixture for it.

## Consequences

- The strip boundary is structural. Adding a maintainer document is `dev_docs/<name>.md` and
  nothing else; the gate, the wizard, the attribute, and the upgrade helper all already
  cover it.
- Adopters lose the `.drawio` sources and gain nothing they had. The framework's
  architecture is documented in the framework's repository, which is where a reader who
  needs it is already looking.
- One `merge=ours` line replaces five, and it protects documents that do not exist yet.
- `check-init.sh` gained an assertion class it did not have: what the wizard *writes* is now
  held to the same contract as what the repository *ships*.
- The relocation is a one-time cost for exactly one instance. Every later adopter starts on
  the far side of it and never sees the old paths.
- ADR 008 remains the decision of record for *why* the framework owns these documents and
  why adoption removes them. This ADR changes only where they sit and how the removal is
  declared. Its numbering, like ADRs 003-008, is continuous across both repositories.
