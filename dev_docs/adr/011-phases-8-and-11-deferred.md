# ADR 011: Phases 8 and 11 are deferred; retrieval freshness does not wait on them

**Status:** Accepted (2026-08-12)
**Deciders:** Wilson Choi

> **Phase 11 scheduling superseded by ADR 013 (2026-08-18).** Phase 8 remains deferred,
> but Phase 11 is now active on native Claude Code Routines plus GitHub Actions and no
> longer depends on Phase 8. Task 9.4 and this ADR's corpus-refresh security bounds stay
> accepted.

**Amends:** ADR 005 in its delivery-schedule half, and ADR 003 in nothing but its date. The
organ architecture, the routine substrate, the hybrid scheduler choice, and the analytics
stack all stand exactly as decided; what changes is when, and in one case whether, they are
built.

## Context

ADR 005 scheduled three extension phases: 9 (MCP + AI delivery), 10 (perception/analytics),
and 11 (autonomous routines), the last depending on the Phase 8 organ layer from ADR 003.
Phases 6 and 7 have since shipped and been adopted by instance #1 (`sekai-kb v1.1.4`), which
put Phase 8 next in line.

The maintainer chose to run 9 and 10 first and to defer 8 and 11 indefinitely rather than
resequence them behind 10. The ROADMAP requires that call to be explicit, which the
2026-08-12 amendment records; this ADR records the three consequences that are architectural
rather than schedule-keeping.

**Deferring 8 is nearly free, and that is not a coincidence.** ADR 003 made the organ layer
opt-in and required the site to build with `semiont/` deleted; `AGENTS.md` §Semiont probe
already requires every skill and script to no-op gracefully while `semiont/config.json` is
absent. An indefinite delay therefore changes no code path, invalidates no gate, and leaves
no half-built surface. The design bought exactly this option, and this is the decision that
exercises it.

**Deferring 11 wholesale is not free.** Phase 11 is where the framework stops needing a human
at a keyboard for routine upkeep, and parking it parks that. One task inside it is worse than
merely delayed. `npm run embeddings:build` writes a corpus artifact on the maintainer's
machine, which `wrangler deploy` bundles into the chat worker; nothing in the site build or
in CI produces it. The deployed retrieval corpus is therefore a snapshot of the last manual
deploy, and publishing an article does not change what chat can answer. Task 11.2 was the
scheduled fix, its dependencies are 7.2a and 9.1, and it never needed 8.1 for anything. Phase
9's `semantic_search` reads the same artifact, so deferring 11.2 would have shipped a second
consumer of a corpus that silently drifts from the site.

That fix requires CI to deploy a Worker, which contradicts a standing rule stated in two
places: `AGENTS.md` §Where things live ("Deployed by hand, never by CI") and
`docs/runbook/DEPLOY.md` §Corpus embeddings ("Nothing in the site build or in CI produces
it... a deliberate manual step"). The rule was written when every Worker deploy was an
operator action with account credentials on their own machine, and it is a good default for
that. It cannot survive a task whose entire purpose is removing the operator from the loop.

## Options considered

| Option | Pros | Cons | Cost |
|---|---|---|---|
| **Resequence to 9 → 10 → 8 → 11** | Nothing deferred; every dependency intact | Commits the maintainer to two phases they did not ask for; 8 and 11 are ~20h of the remaining plan | none |
| **Defer 8 and 11, park 11.2 with them** | Simplest statement of the deferral | Ships `semantic_search` on a corpus that refreshes only on a manual deploy, and leaves chat that way indefinitely | none now, correctness debt later |
| **Defer 8 and 11, pull 11.2 into Phase 9** (chosen) | Retrieval freshness ships with the feature that needs it; no dependency inverted | Forces the CI-deploy rule change now rather than at Phase 11 | moderate |
| **Drop 8, re-scope 11 to need no organ layer** | Removes the 8-to-11 dependency permanently | Contradicts ADR 003 and ADR 005; a rewrite of the routine substrate to avoid a phase nobody has ruled out | high |

## Decision

**(a) Phases 8 and 11 are deferred, unscheduled, and not re-scoped.** Their ROADMAP blocks,
estimates, and exit gates stay as written and stay convertible: `/dev:plan` runs against them
unchanged whenever a maintainer schedules them. ADR 003 and ADR 005 remain Accepted. What
unblocks the pair is a maintainer call to schedule Phase 8, which Phase 11 then follows,
because 11.1 depends on 8.1 and that dependency is not weakened here.

**(b) Task 11.2 moves into Phase 9 as task 9.4.** Its dependencies (7.2a, 9.1) are satisfied
inside Phase 9, so the move inverts nothing. This is a scope move, not a scope cut: Phase
11's subtotal drops by its estimate and Phase 9's rises by the same.

**(c) CI may deploy the workers that bundle the corpus artifact, by narrow exception.** The
hand-deploy default stands for every other worker and every other reason. The exception is
bounded by four properties, all of which 9.4 must implement and prove:

1. **Push to `main` only.** Never `pull_request`: a workflow carrying a deploy credential
   that runs fork PR code hands that credential to anyone who opens a PR.
2. **Opt-in, absent-safe.** No credential secret configured means the job no-ops and the
   build stays green. An adopter who never opts in keeps the hand-deploy path and a green CI,
   which is the same absent-safe rule every `place.config` key follows.
3. **Least privilege**, per `.agent-toolkit/rules/github-actions-least-privilege.md`:
   `permissions: contents: read` at the top level, write scopes only on the job that needs
   them.
4. **Documented blast radius.** The token is strictly broader than the local one documented
   today: `Workers AI: Read + Edit` for the embedding call plus `Workers Scripts: Edit` for
   the deploy. `docs/runbook/DEPLOY.md` states the scopes, what an adopter grants by opting
   in, and how to revoke.

**(d) The rule text changes where the code proves it.** `AGENTS.md` and
`docs/runbook/DEPLOY.md` are amended inside task 9.4, not in a separate documentation pass,
so no release exists in which the shipped workflow contradicts the shipped rule.

## Consequences

- **The maintainer accepted a real security tradeoff in (c), with it stated.** An adopter who
  opts in grants their CI deploy rights to their Cloudflare account, so a compromised Action,
  a malicious dependency in the workflow's own toolchain, or a bad merge to `main` can deploy
  a Worker in their name. The four bounds above are what keep it proportionate; the opt-in is
  what keeps it an adopter's choice rather than the framework's. Revisiting this is a
  maintainer call, not a defect report.
- **`AGENTS.md` is instance-owned (`merge=ours`), so the reworded rule reaches existing
  instances only by hand.** The release carrying 9.4 needs a `CHANGELOG.md` **Upgrade note**
  saying so, exactly as ADR 010's rewording of iron rule 3 did.
- **The corpus artifact gains a second consumer and moves to `workers/lib/`.** Its 7.2a
  treatment is otherwise unchanged: derived, gitignored, skipped by both genericity gates,
  and a `check-worker-config.mjs` failure if git tracks it. Two workers retrieving against
  one artifact is what stops them answering from different corpora.
- **`ADR 005 §5`'s claim that Phase 9's `features.mcp` is the first post-cut config-schema
  addition is now false**, and was already false before this ADR: `features.feedback`,
  `features.soundscape`, `features.chat`, and `features.og` all shipped and were adopted
  first. Task 9.3 is re-scoped to write the adopter upgrade playbook from the 6.4 and 7.4
  runs. Recorded here because the erroneous sentence is in an Accepted ADR and would
  otherwise be cited again.
- **The autonomous-operations goal in `dev_docs/PRD.md` has no delivery date.** It stays a
  stated product goal; nothing in the framework claims to deliver it in the meantime. A
  document that implies otherwise is a defect against this ADR.
- **Does not foreclose** either phase, and grants no license to break their contracts in the
  meantime. Code shipped in phases 9 and 10 must still leave 8.1 and 11.1 buildable as
  specified, and the `semiont/` no-op probe stays a requirement of every skill and script.
