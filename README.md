# sekai-kb

A reusable template for building **place knowledge bases**: plain Markdown content
rendered as a fast, AI-native static site. Built with [Astro](https://astro.build/).
Content lives as Markdown under `knowledge/` and is the single source of truth;
everything the site renders is derived from it at build time.

This repository is a **GitHub template**. It ships with a fictional demo place,
**Marisol Cove**, so it builds and deploys out of the box — then you replace the demo
with your own place.

> **🚧 Early framework.** sekai-kb is being cut from its first instance and is still
> stabilizing. Interfaces may move between tagged releases.

## Prerequisites

- **Node.js ≥ 22.12** (and npm)
- **[uv](https://docs.astral.sh/uv/)** — runs the Python editorial tooling; it
  fetches Python ≥ 3.12 itself
- **[gh](https://cli.github.com/)** — the GitHub CLI, for Pages setup and CI

Full install table with version checks:
[`docs/runbook/DEPLOY.md`](./docs/runbook/DEPLOY.md).

## From template to deployed site (< 1 hour)

1. **Create your repo** — GitHub "Use this template", then:

   ```sh
   git clone <your-repo> && cd <your-repo>
   npm ci --force && uv sync
   npm run dev            # the demo place, at http://localhost:4321
   ```

2. **Make it your place.** The primary path is AI-assisted, in an agent CLI
   (Claude Code or codex-cli — see [`AGENTS.md`](./AGENTS.md)):

   - **`/adopt`** — an interview about your place; writes `place.config.ts`
     (name, categories, map, links) and swaps out the demo content.
   - **`/seed-articles`** — drafts your first articles from source material you
     supply, following the editorial playbook, behind your approval.

   The no-AI path is the wizard: **`npm run init`** asks the same core questions
   at the terminal, writes `place.config.ts`, and seeds empty category folders —
   you write the articles yourself.

3. **Deploy.** Enable GitHub Pages (Source: GitHub Actions) and push — the
   included workflow builds and publishes on every push to `main`. Custom domain
   and Cloudflare DNS steps: [`docs/runbook/DEPLOY.md`](./docs/runbook/DEPLOY.md).

## Writing articles

The editorial canon lives in [`docs/playbook/`](./docs/playbook/):
[ARTICLE-PLAYBOOK.md](./docs/playbook/ARTICLE-PLAYBOOK.md) (voice, structure, the
quality bar), [REWRITE-PIPELINE.md](./docs/playbook/REWRITE-PIPELINE.md) (the
write/rewrite process), and
[FACTCHECK-PIPELINE.md](./docs/playbook/FACTCHECK-PIPELINE.md) (fact-check
methodology). The `article-health` linter machine-enforces the mechanical parts.

## What's in the box

- **`place.config.ts`** — the single ingress for place identity (name, categories,
  map, features, links, home-page copy).
- **`knowledge/`** — your content, one folder per category. The single source of truth.
- **`docs/playbook/` + `docs/runbook/`** — editorial canon and operations runbook.
- **`src/` + `scripts/`** — the framework: templates, build pipeline, prebuild/postbuild
  contract checks. Framework-owned; customize through config and content, not by editing.
- **`scripts/tools/`** — the Python `article-health` editorial linter (runs via
  [uv](https://docs.astral.sh/uv/); Python ≥ 3.12).
- **`docs/diagrams/`** — architecture diagrams (draw.io), the engineering source of truth.
- **`scripts/visual/`** — visual regression tooling (`npm run visual:baseline` to
  capture, `npm run visual:check` to diff). Run `visual:baseline` once first.
- **`.claude/rules/`** — framework engineering rules that keep the build green.

## Genericity

`src/`, `scripts/`, and `tests/` carry **zero place-specific strings** — all place
identity flows through `place.config.ts`, `knowledge/`, and `public/media/`. This is
machine-enforced (`npm run genericity`) and is the structural guarantee that one
config file re-places the whole site.

## Language support

UI strings and editorial tooling are English-calibrated; Latin-script content
largely works (plain word tokenization; article-health prose thresholds may need
retuning per instance); CJK content is unsupported until the post-project
multi-language revisit.

## License

Dual-licensed (see [`LICENSE`](./LICENSE)):

- **Content** (`knowledge/`, `public/media/`) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/):
  free to share and adapt with attribution, share-alike.
- **Code** (everything else) — MIT.
