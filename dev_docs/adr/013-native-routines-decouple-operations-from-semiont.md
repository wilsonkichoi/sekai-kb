# ADR 013: Native routines decouple operations from Semiont

**Status:** Accepted (2026-08-18)
**Deciders:** Wilson Choi
**Supersedes:** ADR 003 only for the optional ROUTINE organ; ADR 005 only for the
scheduler substrate, machine dependency, and ROUTINE.md registry; ADR 011 only for
Phase 11's deferral and dependency on Phase 8. Phase 8's remaining organ architecture,
the PR-only shipping rule, task 9.4, and the analytics contracts remain accepted.

## Context

Phase 10 is complete and adopted, while Phase 8 remains intentionally unscheduled. ADR
011 therefore left the active roadmap with no next phase because Phase 11's custom routine
substrate depended on Phase 8's ROUTINE organ.

That dependency no longer represents the available platform. As of 2026-08-18, Claude Code
Routines run on Anthropic-managed cloud infrastructure, support schedule and GitHub-event
triggers, clone the repository's default branch for each run, use committed skills, expose
run history and pause controls, and are created and managed through Claude Code's native
`/schedule` command. They run without an approval prompt. The capability is a research
preview, so its behavior and limits must be revalidated when Phase 11 is planned and before
each release proof. Evidence checked 2026-08-18:
<https://code.claude.com/docs/en/web-scheduled-tasks> and
<https://code.claude.com/docs/en/scheduled-tasks>. GitHub Actions schedule behavior is
documented at
<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>.

The old design would now build a second `/schedule` command, routine registry, scheduler,
run log, and kill switch around the native product. It would also retain an always-on-machine
dependency the cloud substrate removes. Semiont's identity and memory experiment does not
need to own operational scheduling, and operational scheduling does not need to wait for
Semiont.

An audit of the Phase 11 blocks found two separate blockers that are not Phase 8:

- feedback triage cannot execute writes unattended because `/sekai-triage-feedback`
  requires explicit human approval of an exact plan and revalidation after approval;
- social publishing has no live platform adapter yet, and instance #1 has not enabled
  `features.social`, so the named real-account trigger from Phase 6 is unsatisfied.

Neither blocker justifies parking content review, health audits, analytics refresh, trend
discovery, or rewrite maintenance.

## Options considered

| Option | Pros | Cons | Cost |
|---|---|---|---|
| Keep Phases 8 and 11 deferred | No document churn | Leaves useful operations work parked and preserves a scheduler design the platform has replaced | none now, continuing operations debt |
| Pull only deterministic jobs into a new phase | Smallest architecture change | Leaves agentic maintenance blocked on an artificial Semiont dependency and still plans a duplicate `/schedule` | low |
| Rebase Phase 11 on native Routines and move only gated integrations to Phase 12 (chosen) | Delivers the useful operations layer now, removes the Phase 8 dependency, preserves human and account gates | Accepts a vendor research-preview dependency and account-owned routine state | moderate |
| Rebuild the custom scheduler outside Semiont | Keeps routine state repository-owned | Duplicates native scheduling, triggers, run history, pause controls, and cloud execution | high |

## Decision

### 1. Phase 8 stays deferred and stops owning operational scheduling

Phase 8 remains the optional Semiont identity and memory layer. The ROUTINE organ is removed
from its required scaffolds. No Phase 11 or Phase 12 task depends on Phase 8. Any future
integration that writes routine summaries into MEMORY belongs in Phase 8 or in a separately
approved post-Phase-8 milestone; it is not part of Phase 12.

### 2. Phase 11 uses the platform substrate

Phase 11 becomes the next active phase and is renamed **Operational automation**.

- Deterministic repository and deployment jobs use GitHub Actions schedule or event
  triggers.
- Agentic jobs use Claude Code cloud Routines with committed `sekai-*` skills and the
  repository's instructions.
- The native routine configuration, trigger list, pause control, and run history are the
  operational source of truth. The repository does not create a shadow ROUTINE.md manifest
  and does not ship a skill named `/schedule`.
- `docs/runbook/AUTOMATION.md` records setup, least-privilege connector and environment
  configuration, routine prompts, manual fallbacks, pause and removal steps, and the live
  verification procedure. It is a reproducible registration guide, not a second registry.
- Every repository-changing run starts from the default branch, writes only to a
  `claude/`-prefixed branch, and opens a pull request. Content always requires human merge.
  No routine receives permission to push the protected default branch.
- A native green run status proves only that the session exited without an infrastructure
  error. Acceptance verifies the transcript, pull request or external effect, and repository
  state named by the task.

Phase 11 contains content PR review and scheduled health auditing, scheduled analytics
rebuild, trend discovery, rewrite maintenance, and its release/adoption/live-run gate.

### 3. Phase 12 contains only gated integrations

Phase 12 is **Gated integrations** and remains unscheduled until its external gates are
satisfied. It has no Phase 8 dependency.

- Feedback triage depends on the existing human approval contract, not Semiont. A scheduled
  routine runs `/sekai-triage-feedback --dry-run` and stops with the complete plan. The
  maintainer opens that run and explicitly approves the exact plan in the same session;
  the skill then performs its existing revalidation before any GitHub or D1 write. A saved
  routine prompt or trigger event is never approval.
- Social publishing depends on a real instance account and a reviewed platform adapter,
  not Semiont. The adapter must preserve the existing pending-to-approved human gate and
  make retries idempotent before a scheduled routine may call it.

Phase 12 closes only after both gated integrations run live, the framework release ships,
and instance #1 adopts it cleanly.

### 4. Operations remain optional and absent-safe

Claude Code Routines are optional subscription-backed automation, not a site runtime or
hosting dependency. An adopter with Routines disabled keeps the manual skills and GitHub
Actions paths, and the site still builds and deploys. Each routine includes only the
repository, connectors, environment variables, and network access it needs. Removing or
pausing a native routine is its kill switch.

## Consequences

- The execution order becomes 6, 7, 9, 10, 11. Phases 8 and 12 are unscheduled and
  independent of each other.
- Phase 11 can be planned without creating or migrating a Phase 8 milestone. Linear has no
  existing Phase 11 or Phase 12 packets to re-triage.
- The custom `/schedule` skill, ROUTINE.md registry, routine-organ kill switch, and
  always-on-machine requirement are removed before implementation, so no migration is
  required.
- Routine registration is account-owned external state. Reproducibility comes from the
  committed skills and runbook plus a live exit proof, not from claiming the repository can
  control state it does not own.
- The research-preview dependency is accepted but bounded. Phase 11 planning revalidates
  current availability, version floors, trigger support, branch behavior, run semantics,
  and limits against the official Claude Code documentation. A material loss of capability
  returns to architecture rather than being hidden behind a custom compatibility layer.
- Phase 12 cannot be pulled forward merely to make the roadmap look complete. Its human
  approval and real-account gates are product constraints, not scheduling inconvenience.
