---
dev_plugin_repository: wilsonkichoi/agent-toolkit
dev_plugin_release: dev-v0.0.78
tracker: linear
linear_team: LB
linear_project: "LB Rebuild"
test_command: "npm run version:check && npm run genericity && npm run worker-config:check && npm run worker-config:selftest && npm run schema-docs && npm run framework-docs && npm run framework-docs:selftest && npm run analytics-delivery:check && npm run analytics-delivery:selftest && npm run workflow-triggers:check && npm run workflow-triggers:selftest && npm run corpus-refresh:check && npm run corpus-refresh:selftest && npm run test:corpus-refresh && npm run dev-plugin:check && npm run test:ci && npm run test:snippet && npm run test:soundscape && npm run test:workers && npm run test:embeddings && npm run test:chat && npm run test:mcp && npm run test:ai && npm run test:qr && npm run test:analytics && npm run article-health:test && npm run article-health -- --all --profile=ci-deploy && npm run build && npm run test:theme"
ci_workflow: deploy.yml        # GH Actions: genericity + test + build + init-check on every PR; deploy on push to main
merge_policy: squash
review_action_installed: false # auto PR-review GitHub Action (claude-review.yml) not installed
work_in_progress_limit: 3      # max tasks simultaneously In Progress + In Review
max_fix_attempts: 3            # CI-fix or review-fix cycles before a task goes Blocked
max_tasks_per_run: 5           # batch cap for dev:auto and execute loop/batch mode
auto_merge: false              # standing merge approval for dev:auto (see that skill)
context_file: AGENTS.md        # AGENTS.md carries the reference line; CLAUDE.md reaches it via an @AGENTS.md shim
rules_dir: .agent-toolkit/rules/  # promoted learnings, one file per rule
---

# sekai-kb dev config

This is the **framework** repo (`github.com/wilsonkichoi/sekai-kb`). The Linear
tracker (team `LB`, project "LB Rebuild") is shared with the first instance; a
packet's `Execution repo:` field says where its code lands (absent → `sekai-kb`
for framework work). Both repos read their own `.agent-toolkit/dev.md`; this one
governs work committed here.

Roadmap phases map to native Linear project milestones in `LB Rebuild`, not
`milestone:*` labels.

**Which repo a session runs in.** This is the framework-side half of the rule the
first instance's `.agent-toolkit/dev.md` carries; the two must state the same thing.
`gh` resolves against the working-directory repository, so the working directory is
what makes cross-repo targeting correct — not a per-call `-R` flag. **A session runs
in the repository that owns the documents it reads and the commits it makes**, which
are always the same repository:

- **Execution skills** — `/dev:execute`, `/dev:review-pr`, `/dev:verify` — run in the
  repository named by the packet's `Execution repo:` field. Framework work (Phase 6+,
  anything touching `src/`, `scripts/`, `.agents/skills/`, or the maintainer docs) runs
  here, so PR numbers, CI runs, and review threads resolve against this repository with
  no flag and no bare-`#N` ambiguity. A packet about an instance's own content, config,
  feature flags, or `/sekai-upgrade` adoption names that instance and runs there.
- **`/dev:plan`** runs in the repository whose ROADMAP carries the phase being
  decomposed, and amends that ROADMAP there. Phases 6-11 are framework phases: plan them
  here against `dev_docs/ROADMAP.md`. A constraint that lands on the other repository is
  recorded in the packet and surfaced to the maintainer, never written into the other
  repository's ROADMAP from this side.
- **`/dev:backlog`** runs where the change lands. A stub that becomes framework work is
  triaged here against `dev_docs/SPEC.md` + `dev_docs/ROADMAP.md`; a stub about an instance's
  content, config, or adoption is triaged there. The Linear stub itself is repo-neutral —
  triage picks the side, and the resulting packet's `Execution repo:` field records it.
- **`/dev:status` and `/dev:retro`** read the tracker, which spans both repositories, so
  either working directory answers correctly. Run `/dev:retro` in the repository whose
  rules it may promote into: a lesson about framework code belongs in this tree's
  `.agent-toolkit/rules/`, one about an instance's process belongs in that instance's.
  A retro producing both writes each rule on its own side.
- Every packet states `Execution repo:` — that field is what makes this mechanical.
  Record the full PR URL on the Linear task either way: the tracker spans both
  repositories and PR numbering does not.

Where the two copies disagree, this one governs framework commits and the instance's
governs its own — and the disagreement is a defect to report, not a choice to make.

## Binding docs

- **Product SSOT:** `dev_docs/PRD.md` — what the framework is for, who adopts it, north
  star, non-goals.
- **Engineering SSOT:** `dev_docs/SPEC.md` + `dev_docs/adr/` — architecture, contracts, risk
  controls, negative requirements, and accepted decisions.
- **Delivery SSOT:** `dev_docs/ROADMAP.md` — phases 6-11 task blocks, amendments, ordering
  rules, and exit gates. `/dev:plan` converts packets from those blocks and amends this
  file, not a sibling checkout.
- **Research provenance:** `dev_docs/research/` — the platform research the phase 7-11
  contracts were derived from, ported de-placed from the pre-cut instance. Reference,
  not contract: a constraint that binds implementation is promoted into `dev_docs/SPEC.md`,
  and time-sensitive claims there carry an as-of date and must be re-verified before use.
- `dev_docs/` is the **framework maintainer doc** tree: the init wizard strips it from
  adopter clones and `npm run framework-docs` gates the contract (ADR 008, relocated by
  ADR 009 — the boundary is the directory, so a document added here later needs no
  edit to any strip list). Phases 0-5,
  the extraction map, the inherited-fork disposition, and ADRs 001-002 stay in instance
  #1's repository as its rebuild history. A conflict among these documents goes to the
  maintainer, never silently resolved.
- **Iron rules + where things live:** `AGENTS.md` (agent-instruction SSOT,
  genericity + English-only, framework vs instance). `CLAUDE.md` is the one-line
  `@AGENTS.md` shim.
- **Release discipline (read before cutting a release):** `CHANGELOG.md` preamble —
  every change lands with a CHANGELOG entry, breaking config changes carry an
  **Upgrade note**, instances merge tags only, instance-owned files
  (`.gitattributes merge=ours`) are never overwritten. `CHANGELOG.md` is the framework
  release log in this repo but becomes instance-owned when the init wizard replaces it.
- **Upgrade mechanics:** `docs/runbook/UPGRADE.md` + the `/sekai-upgrade` skill; ADR 004
  (tagged-release topology).

**Active architecture delta, Phase 10 (ADR 012).** Analytics is fetched ephemerally into
ignored `src/data/analytics/` during a production Pages build of `main`; no snapshot enters
git. `dev_docs/SPEC.md` §Analytics owns the provider schemas, config keys, credential
boundary, and per-source unavailable states. `dev_docs/ROADMAP.md` splits delivery into
10.2a fetchers and 10.2b CI/rendering. Future task 11.5 schedules the same verified-main
rebuild and does not open an empty data PR.

## Intent sources

- dev_docs/PRD.md
- dev_docs/SPEC.md

The dev plugin's `dev:backlog` triage reads product intent from `docs/PRD.md` and
`docs/SPEC.md` by default. Neither exists here: ADR 008 put the framework's product
and engineering SSOTs beside the code they govern, and ADR 009 relocated that tree to
`dev_docs/`. Without this section every triage run stops before its first mutation and
asks a human to approve the same two files again, which is a prompt, not a check. The
paths above are the same two documents the **Binding docs** section names; that section
is the human-facing statement of authority and this one is the machine-readable form
the plugin reads. Keep them in step: a document that becomes an intent source belongs
in both.

`.agent-toolkit/dev.md` is stripped from adopter clones by the init wizard (ADR 006), so
this section never reaches an instance. Each instance declares its own.

## Conventions

- **Genericity is machine-gated whole-tree in template mode.** The `.sekai-template`
  marker makes `npm run genericity` scan the entire repo (not just code trees), so
  `.agent-toolkit/` content is scanned too — keep dev config and rules free of
  place-name denylist terms and CJK codepoints.
- **Release = CHANGELOG entry → bump `FRAMEWORK-VERSION` → tag
  `sekai-kb-vX.Y.Z` → push the tag.** Tags are immutable and never re-pointed
  (CHANGELOG release rules). The tag suffix must equal the file's v-prefixed value.
  `package.json` is a private Node manifest, not a framework release SSOT. Tagging is
  a `dev:verify`-time step, after merge.
- **Framework-upgrade PRs in instances merge with a real merge commit, never
  squash** — the mechanics (Merge-instructions block in the PR body, post-merge
  `git merge-base --is-ancestor` ancestry assertion) live in the instance-side rule
  `upgrade-prs-merge-commit-never-squash.md`, carried in each instance's own
  `rules_dir`, not shipped in this framework repo. Framework-repo feature PRs use
  `merge_policy: squash` unless their branch history is itself the deliverable.
- **Dev-plugin state is instance-owned and adopter-stripped.** `.agent-toolkit/**`
  and `AGENTS.md` carry `merge=ours`; the init wizard strips `.agent-toolkit/` and
  the `AGENTS.md` reference line from adopter clones (ADR 006). Rules here are
  lessons from developing the framework's `src/`/`scripts/`; adopters never touch
  those trees, so they never ship. `merge=ours` protects content, not absence: an
  adopter's stripped state is preserved by `scripts/upgrade/dev-plugin-state.mjs`,
  which `/sekai-upgrade` runs before and after every tag merge (ADR 006 addendum). A
  change to this tree's shape must keep that helper's `stripped`/`installed`
  definitions true — `scripts/upgrade/check-upgrade-state.sh` is the gate.
- **Framework and instance changelogs are separate.** Releases update this repo's
  `CHANGELOG.md`. `npm run init` writes an instance-only changelog at the same path and
  `merge=ours` preserves it. `/sekai-upgrade` reads framework notes from the target tag with
  `git show <tag>:CHANGELOG.md`; it never copies the framework log over the instance log.
  `FRAMEWORK-VERSION` is also instance-owned: the merge preserves it, then `/sekai-upgrade`
  bumps it explicitly after verification.
- **Version domains never overlap.** `VERSION` is the adopter's release SSOT and
  carries `merge=ours`; `FRAMEWORK-VERSION` is the adopted Sekai release SSOT.
  Neither value is stored in `package.json`.

## Rules

Promoted engineering lessons (`dev:retro`) in `rules_dir`, one file per rule.
Project bootstrap **discovers** rules by walking `rules_dir` and reading each
file's `tier` frontmatter — it does not `@`-import a registry list, so nothing
below is a bare `@path` line (a leftover `@` import would make a harness inline
every gotcha each session, defeating the triggers). Every Markdown file under
`rules_dir` must declare a valid `tier`; an unclassified file fails the bootstrap
closed rather than being silently dropped. See the dev plugin's
`runtime_contracts/project-bootstrap.md` for the loading contract and trigger
matching.

- **`tier: doctrine`** — always selected by project bootstrap; standing judgment
  inlined into every session.
- **`tier: gotcha`** — selected only when a `triggers:` entry matches the task: a
  `paths` glob against the changed files, or an `objective` / `definition_of_done`
  case-insensitive substring. A gotcha needs at least one trigger.
- **`tier: none`** — a non-rule Markdown file that stays in place, loaded by nothing.

CI gates complete classification with the dev plugin's own checker
(`resolve_project_rules.py --check`), run through the upstream composite action
declared by `dev_plugin_repository` and `dev_plugin_release` in this file's
frontmatter. This repository vendors no second copy of that checker. The
`npm run dev-plugin:check` gate fails if a `check-rules` workflow reference drifts
from that declaration. `--check` is stricter than a lifecycle run in one place: a
bare `@path` line under `## Rules` is an error here, where a lifecycle run only
warns.

The step lives in the `test` job of `.github/workflows/deploy.yml`, which runs on
every pull request and every push to `main`. What enforces it is the job graph:
`build` needs `test` and `deploy` needs `build`, so a red `test` blocks the Pages
deploy no matter how branch protection is configured. (Checked 2026-08-17:
repository ruleset `main` (id 19710528) requires all four of these jobs as status
checks on the default branch, so they also block the merge. Query it with
`gh api repos/wilsonkichoi/sekai-kb/rulesets` — the classic
`branches/main/protection` endpoint returns 404 under a ruleset. That is a
repository setting, changeable without a commit here, which is why the job graph
is what this paragraph relies on. A required context is matched by job `name:`,
so renaming a job in `deploy.yml` without updating the ruleset leaves every PR
unmergeable.)

The action detects `.agent-toolkit/dev.md` itself and skips with exit 0 when it is
absent, so an adopter stripped by `npm run init` needs no shell guard on the gate;
the `init-check` job proves that against a tree the wizard really stripped. The
non-vacuity fixture in `test` — which proves the wiring still fails an unclassified
rule file — *is* guarded on that file, because a stripped adopter has no rules for
it to prove anything about.

Neither tier is indexed below. Doctrine rules are inlined into every dev session,
so a summary line would restate content already in context; gotchas load only on a
trigger match, and a hand-written index of them is a second description of each rule
that drifts. The resolver's source of truth is each rule file either way.

### Gotchas

Not indexed here. The resolver discovers every Markdown file under
`.agent-toolkit/rules/` and reads its `tier` and `triggers` frontmatter; the file's
heading and body describe the rule for humans. Read the directory to see the current
set (the former list had already lost a rule).
