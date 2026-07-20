---
tracker: linear
linear_team: LB
linear_project: "LB Rebuild"
test_command: "npm run genericity && npm run test:ci && npm run article-health:test && npm run article-health -- --all --profile=ci-deploy && npm run build"
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

## Binding docs

- **Iron rules + where things live:** `AGENTS.md` (agent-instruction SSOT,
  genericity + English-only, framework vs instance). `CLAUDE.md` is the one-line
  `@AGENTS.md` shim.
- **Release discipline (read before cutting a release):** `CHANGELOG.md` preamble —
  every change lands with a CHANGELOG entry, breaking config changes carry an
  **Upgrade note**, instances merge tags only, instance-owned files
  (`.gitattributes merge=ours`) are never overwritten.
- **Upgrade mechanics:** `docs/runbook/UPGRADE.md` + the `/upgrade` skill; ADR 004
  (tagged-release topology).

## Conventions

- **Genericity is machine-gated whole-tree in template mode.** The `.sekai-template`
  marker makes `npm run genericity` scan the entire repo (not just code trees), so
  `.agent-toolkit/` content is scanned too — keep dev config and rules free of
  place-name denylist terms and CJK codepoints.
- **Release = CHANGELOG entry → bump `package.json` `version` → tag
  `sekai-kb-vX.Y.Z` → push the tag.** Tags are immutable and never re-pointed
  (CHANGELOG release rules). Tagging is a `dev:verify`-time step, after merge.
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
  those trees, so they never ship.

## Rules

Promoted engineering lessons (`dev:retro`) in `rules_dir`. All are gotcha-tier —
indexed by path + trigger hook, not `@`-imported: each is a narrow, CI-gated
build gotcha that a session opens only when its trigger matches, not standing
doctrine to inline every session. Open the file when its hook fires.

- `.agent-toolkit/rules/astro-geojson-import-raw.md` — build-time import of a `.geojson` (or other non-JSON data extension): use `?raw` + `JSON.parse`; Vite has no loader for the bare extension.
- `.agent-toolkit/rules/astro-json-island-escape.md` — emitting build-time JSON into a `set:html` `<script type="application/json">` island: escape every `<` to its `\u003c` form (`JSON.stringify` does not), or a `</script>` inside a string value breaks out of the island.
- `.agent-toolkit/rules/astro-static-paths-scope.md` — `getStaticPaths` helpers must be inlined or exported; non-exported frontmatter helpers are tree-shaken from the prerender chunk and throw at build.
- `.agent-toolkit/rules/external-link-arrow-exclusion.md` — adding a `target="_blank"` link inside an article surface: give it `class="no-external-icon"` or global CSS appends a stray ↗.
- `.agent-toolkit/rules/github-actions-least-privilege.md` — a workflow that runs PR code sets `permissions: contents: read` top-level; grant write scopes only on the job that needs them.
- `.agent-toolkit/rules/gray-matter-date-normalization.md` — normalize `matter().data.date` to an ISO string immediately; gray-matter silently coerces unquoted YAML dates to `Date`, breaking sort/`slice`.
- `.agent-toolkit/rules/lockfile-cross-platform.md` — after a dependency change verify `rm -rf node_modules && npm ci`; fully regenerate the lockfile when a package has platform-conditional native bindings.
- `.agent-toolkit/rules/optional-build-time-json-readfilesync.md` — an optional (maybe-absent) build-time JSON file: read it with `readFileSync` + `try/catch`, never `await import()` (Rollup fails to resolve before the catch runs).
- `.agent-toolkit/rules/prebuild-parallel-no-sibling-rm.md` — a `run-p` prebuild script cleans only its own output subtree, never a shared parent dir a sibling writes into concurrently.
- `.agent-toolkit/rules/prebuild-scripts-compute-not-fabricate.md` — prebuild scripts have full fs/git access: compute values from real repo data; hardcoding constants (with a "no access" comment) is fabricated data and a review blocker.
- `.agent-toolkit/rules/remark-plugin-no-dynamic-import.md` — remark/rehype plugins can't dynamically `import()` project config inside Vite's module runner; pass project data as plugin options from `astro.config.ts`.
- `.agent-toolkit/rules/shell-script-portability.md` — `scripts/**` must run on macOS bash 3.2 and CI bash 5: no `mapfile`/`readarray`, `unset CDPATH` before `cd`-in-`$()`.
