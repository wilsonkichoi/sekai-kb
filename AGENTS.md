# AGENTS.md

Instructions for AI agent CLIs (codex-cli, and any tool that reads this file).

> This file is **instance-owned from clone time** (`merge=ours` in
> `.gitattributes`): framework upgrades never overwrite it. Edit it freely to
> describe your instance and how your agents should work in it.

**Read [`CLAUDE.md`](./CLAUDE.md) — it is the boot document for this repository,
regardless of which agent CLI you are running.** Everything there applies to you:
where things live, how the site builds, the iron rules (SSOT, genericity +
English-only, framework vs instance), the language support boundary, and the
semiont probe rule.

Beyond that, the working set for any agent session:

- **Writing or editing content:** follow
  [`docs/playbook/ARTICLE-PLAYBOOK.md`](./docs/playbook/ARTICLE-PLAYBOOK.md) and
  the stage sequence in
  [`docs/playbook/REWRITE-PIPELINE.md`](./docs/playbook/REWRITE-PIPELINE.md).
  Edit only `knowledge/` — never the derived `src/content/`.
- **Verifying claims:** [`docs/playbook/FACTCHECK-PIPELINE.md`](./docs/playbook/FACTCHECK-PIPELINE.md).
  Never fabricate a fact, a source, or a quote.
- **Build, toolchain, deploy commands:** [`docs/runbook/DEPLOY.md`](./docs/runbook/DEPLOY.md).
  Python tooling always runs through `uv` (`uv sync`, `uv run`); never `pip`.
- **Before committing:** `npm run test`, the relevant
  `npm run article-health -- <file> --profile=...` gate, and `npm run build`
  must pass. The pre-commit hook enforces a subset; don't rely on it as the
  first check.

<!-- dev-plugin:start — the init wizard (scripts/init) strips this block, and the
     .agent-toolkit/ tree it points at, from adopter clones. Framework state only. -->
## Framework development

This repository is developed with the **agent-toolkit dev plugin** (its own
task/PR/CI/review/verify lifecycle). Adopters do not need any of this — the init
wizard strips the `.agent-toolkit/` tree and the reference line below when you
adopt the template, so a fresh instance ships zero dev-plugin state.

Dev workflow (agent-toolkit dev plugin): @.agent-toolkit/dev.md
<!-- dev-plugin:end -->

