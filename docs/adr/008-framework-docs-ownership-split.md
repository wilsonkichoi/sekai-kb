# ADR 008: Framework maintainer docs live in sekai-kb and are stripped at adoption

**Status:** Accepted (2026-07-28, maintainer-approved 2026-07-27)
**Deciders:** Wilson Choi
**Executes:** LB-61 (sekai-kb side) + LB-62 (instance #1 side)

## Context

Phases 6-11 are framework feature phases whose code executes in `sekai-kb` (ADR 004,
ADR 005). Their product intent, architecture contracts, delivery blocks, and accepted
decisions were all written in instance #1's repository, because that is where the
framework was built before it was cut out (ADR 002, held there as its own history).

The result was a repository that owns the code but not the documents governing it:

1. **Every framework session read its contracts from a sibling checkout.** An agent
   working in `sekai-kb` had no `docs/SPEC.md` to cite and no ADR directory to check. The
   dev config's binding-docs list pointed across a repository boundary, so the contract a
   task must satisfy was only reachable if the other clone happened to exist locally.
2. **`/dev:plan` amended documents in a repository the work does not happen in.** A phase
   plan for framework code produced ROADMAP amendments in the instance repository, so the
   plan and the diff it governs could never appear in one review.
3. **The documents mixed two ownerships.** One SPEC held both the framework's contracts
   (repo topology, build pipeline, negative requirements) and one instance's rebuild
   history (the extraction map, the inherited-fork disposition). A reader could not tell
   which statements bound the framework and which recorded how the first instance came to
   exist.

A fourth constraint shaped the answer: whatever lands in `sekai-kb` ships to every
adopter through the GitHub template and every later tag merge. Framework maintainer
documents are exactly as irrelevant to an adopter as the framework's own dev-plugin state,
which ADR 006 ruling (c) already strips at adoption.

## Decision

**(a) The framework's own PRD, SPEC, ROADMAP, and ADRs live in `sekai-kb`, under
`docs/`.** `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, and `docs/adr/` are the
framework's product, engineering, and delivery SSOTs, beside the code they govern.

**(b) The split is by section, not wholesale.** The framework receives the sections that
state framework contracts. Instance #1 keeps the sections that record its own rebuild:
the extraction map (which inherited file seeded which framework file), the inherited-fork
disposition table, phases 0-5 and their packet-shaping notes, and ADRs 001 and 002, which
decided how that one instance was rebuilt. ADRs 003 through 007 move, keeping their
numbers and filenames, because each governs framework code. Continuity of ADR numbering
across the two repositories is deliberate: renumbering would break every existing citation
for no gain, and the moved files carry a header note saying where they came from.

**(c) `sekai-kb` gets its own PRD, written fresh.** The framework's customers, north star,
and non-goals are not the first instance's with the place name removed. It is written from
the generic half of the source document, not copied.

**(d) The init wizard strips the maintainer docs, exactly as it strips
`.agent-toolkit/`.** `npm run init` removes `docs/PRD.md`, `docs/SPEC.md`,
`docs/ROADMAP.md`, and `docs/adr/` from an adopter clone. `docs/playbook/` and
`docs/runbook/` stay: those are how an adopter writes articles and operates the site.
`scripts/init/check-init.sh` asserts the strip on a tree the wizard really stripped, with
planted inverse fixtures proving the assertion can fail.

**(e) No file that survives adoption may link into a stripped path.** A dangling
reference in an adopter's tree is worse than no reference, because the reader cannot tell
whether the document was deleted or never existed. `scripts/ci/check-framework-docs.mjs`
derives the stripped path list from the wizard itself and fails CI on any link into it
from a file adoption keeps. Bare citations by name ("ADR 004") are not links and remain
legal in framework code comments; adopter-facing prose that cites a maintainer doc points
at the upstream repository instead.

**(f) Instance #1 must mark the four paths `merge=ours` before adopting the release that
carries them.** It has its own documents at exactly those paths. Without the attribute the
first tag merge that includes framework maintainer docs conflicts with, or overwrites, the
instance's own PRD, SPEC, and ROADMAP. This is why the release carries an upgrade note and
why the instance-side work is a separate task (LB-62).

**(g) The tracker stays a single project.** One project ("LB Rebuild") continues to span
both repositories. The alternative — one project per repository — would split a
dependency chain that genuinely crosses the boundary (a framework release and the
instance upgrade that adopts it are two tasks in one phase gate) and would make phase
milestones ambiguous. A packet's `Execution repo:` field already names where its code
lands, which is the only routing information a session needs.

## Consequences

- A framework session resolves its contracts from its own checkout. `/dev:plan` for
  phases 6-11 reads and amends `sekai-kb/docs/ROADMAP.md`.
- The two repositories hold the same four paths with different content and different
  owners. That is intended, and `merge=ours` on the instance side is what keeps it
  stable. Until LB-62 lands, both repositories carry copies; that intermediate state is
  planned, not drift.
- Adopters see no change: the wizard removes all four paths, and the gate proves nothing
  they keep points at them.
- Moved prose was genericized to pass template-mode gates, which scan the whole tree. The
  moved documents therefore say "the instance" where they once named a place, and
  "the maintainer" where they named a person, except in ADR provenance headers, where
  naming the decider is the point.
- **Open: an existing stripped adopter reacquires the maintainer docs on upgrade.** The
  wizard strip protects a *fresh* adoption. A later framework tag merge adds the four
  paths back as theirs-only additions, exactly the failure ADR 006's addendum documented
  for `.agent-toolkit/`, and for the same reason: `merge=ours` cannot protect an absent
  path. `/sekai-upgrade` needs a classify/reconcile pass for maintainer-doc state, distinct
  from the dev-plugin one because an instance that legitimately owns documents at those
  paths (instance #1) must never have them deleted. That work is tracked separately and is
  not carried by this decision.
