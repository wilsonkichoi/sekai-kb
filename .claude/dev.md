---
tracker: linear
linear_team: LB
linear_project: "LB Rebuild"
test_command: "npm run test:ci && npm run article-health -- --all --profile=ci-deploy && npm run build"
ci_workflow: deploy.yml        # GH Actions workflow: genericity + build on every PR, deploy on push to main (LB-2)
merge_policy: squash
review_action_installed: false # auto PR-review GitHub Action (claude-review.yml) is set up; flips true at task 11.3
work_in_progress_limit: 2      # max tasks simultaneously In Progress + In Review
max_fix_attempts: 3            # CI-fix or review-fix cycles before a task goes Blocked
max_tasks_per_run: 5           # batch cap for /dev:auto and /loop /dev:execute
auto_merge: true               # standing merge approval for /dev:auto (see that skill)
---

# Project conventions

## Binding spec and doc precedence

Binding spec: `.fable/STRATEGIC-DIRECTION.md` (see its 2026-07-07 revision note). Task
packets are converted from its §E, never re-derived. Once `docs/PRD.md`, `docs/SPEC.md`,
and `docs/ROADMAP.md` are approved, they are the operative docs for dev-plugin skills;
STRATEGIC-DIRECTION.md is the frozen source of record. Any conflict between them is
surfaced to Wilson — never silently resolved in either direction.

## Genericity rule (negative requirement)

Zero place-specific strings in `src/` or `scripts/`. All place identity flows from
`place.config.ts` + `knowledge/` + `public/media/`. CI-gated by
`scripts/ci/check-genericity.sh` from task 0.3 onward; until then, reviewers grep manually.

## Binding references (extraction sources — outside this repo, absolute paths)

| Reference | Role | Rule |
|---|---|---|
| `.fable/STRATEGIC-DIRECTION.md` (this repo) | binding spec | every task packet names the §E sub-unit it executes |
| `${SRC_HOME}/lagunabeach-md-v1` (the renamed fork checkout) | extraction source | §C prefers the fork's copy; reviews verify extraction claims against this tree, **byte-diff where §C says verbatim** |
| `${SRC_HOME}/taiwan-md` | design reference | consult for design rationale; never a content source |
| `${SRC_HOME}/lagunabeach-md-v0/_research/taiwan-md-research.md` + `taiwan-md-llm-wiki.md` | v0 deep research | §B/§D section pointers are mandatory pre-reads for the executor of the citing task (2.1 boundary sourcing, Phase 5 adopter needs, 7.1/7.2 worker designs) |
| v1 archive `MIGRATION.md` | lessons only | not process; the migration apparatus is dead per §F |

A session loads only the references its task cites — nothing else.

## Milestones and model policy

- Milestones = Linear project milestones on project "LB Rebuild", one per phase
  ("Phase 0" … "Phase 11"): 0-8 from §E, 9-11 from the ROADMAP "Extension task blocks"
  appendix (ADR 005) — packets convert from those blocks exactly as from §E.
  Phase transitions are Wilson gates: `/dev:plan` for phase n+1
  runs only after Wilson confirms phase n closed **and** the phase-n retro confirms every
  Backlog discovery stub from the phase is triaged — each stub either became a
  ROADMAP/SPEC edit (via `dev:backlog` triage), was pulled into the phase-n+1 plan, or was
  closed Wont Do with rationale. Untriaged stubs block the next plan.
- Wilson gates from §E (1.1c design sign-off, 3.2 domain cutover, 5.2c dana-point proof)
  are manual DoD criteria on those tasks — `/dev:verify` must stop for Wilson on them.
- Packet `Model:` notes (version-less, e.g. `Model: Opus`) are advisory; Wilson picks each
  session's model. Reviews default to Sonnet; a `Review-Model: Opus` note on a task
  (1.1c, 1.2b, each phase-closing task) overrides.

## Planning conventions

- **Verify extraction sources before citing them.** When a packet names a fork file as the
  extraction source for specific fields, confirm that file actually contains those fields
  before writing the packet. In LB-1 the packet cited `src/utils/category-static-paths.ts`
  `CATEGORY_MAP` for category icons/descriptions, but that const is slug→title only — the real
  source is `src/utils/categoryConfig.ts`, forcing a mid-task source hunt.
- **Mirror the fork's exact dep versions, not caret ranges** — see
  `.claude/rules/extraction-version-pinning.md`. A packet's `^`/`~` ranges are advisory; the
  fork's installed version is the contract.
- **Read ahead, plan JIT.** When decomposing phase n, `/dev:plan` must read the §E / ROADMAP
  sections for phases n+1 and n+2 and include a **Forward constraints** section in the dry
  run: every phase-n decision a later phase depends on, one line each, citing the future §E
  unit it serves. A dry run without this section is incomplete — Wilson rejects it.
- **`Downstream:` field in every packet.** Each minted packet names the future §E units that
  consume its output (`Downstream: none` allowed, but must be stated), so the executor knows
  which interfaces are load-bearing contracts versus internal choices.

## Execution conventions

- **Deferred-discoveries capture.** Any discovery during execute/review/verify that belongs
  to a future phase is captured immediately as a Linear **Backlog** stub: title, two
  sentences, link to where it surfaced. No milestone, no packet — stubs are state
  ("untriaged discovery exists"), not intent; intent enters the docs only at phase-close
  triage (see Milestones). Stubs are never worked directly; they become tasks only through
  `/dev:plan` or `dev:backlog` triage.
- **Every PR description carries a `Deferred discoveries:` section** — listing the stubs
  filed from that task, or an explicit `none`. `/dev:review-pr` treats a missing section as
  a review finding.
- **In-scope work is never a deferred discovery.** If a finding is required by the
  claimed task's Objective or DoD, it is implemented in that task; stubs are only for
  work belonging to a future phase. Stubbing DoD work is a review finding (blocker).
- **"Test-backed" DoD before the 4.1 test runner.** Until real tests arrive (task 4.1),
  `test_command` is `npm run build`. A DoD criterion whose evidence says "test-backed" is
  satisfied by a **postbuild check script** in the repo idiom
  (`scripts/core/post-build-check.mjs`, `check-internal-links.mjs`): a node script that
  asserts the contract and `process.exit(1)` on violation, wired into the `postbuild` `run-s`
  chain so it runs on every build locally and in CI. Do not leave "test-backed" as a one-off
  `jq` in the PR — wire the assertion so it guards regressions.
