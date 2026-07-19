# Marisol Cove (sekai-kb demo instance)

Knowledge base for the fictional coastal town of **Marisol Cove** — the demo place
that ships with the **sekai-kb** framework template. Built with Astro; content is
plain Markdown under `knowledge/`. Replace this demo with your own place by running
`npm run init` (or the `/adopt` skill).

> This file is **instance-owned** (`merge=ours` in `.gitattributes`): framework
> upgrades never overwrite it. Edit it freely to describe your instance.

## Where things live

- **Place identity (the one file to edit):** `place.config.ts` — name, tagline,
  domain, categories, map, feature toggles, links, and home-page copy.
- **Content (single source of truth):** `knowledge/{Category}/*.md` — plain Markdown.
  Everything the site renders is derived from this at build time. Article ideas
  queue in `knowledge/INBOX.md`.
- **Media:** `public/media/` and other `public/` assets.
- **Editorial canon:** `docs/playbook/` — [ARTICLE-PLAYBOOK.md](docs/playbook/ARTICLE-PLAYBOOK.md)
  (voice, structure, quality bar), [REWRITE-PIPELINE.md](docs/playbook/REWRITE-PIPELINE.md)
  (the write/rewrite process), [FACTCHECK-PIPELINE.md](docs/playbook/FACTCHECK-PIPELINE.md)
  (fact-check methodology).
- **Operations:** `docs/runbook/` — [DEPLOY.md](docs/runbook/DEPLOY.md) (install,
  toolchain, CI, GitHub Pages, custom domain; every command copy-pasteable).
- **Architecture diagrams (engineering SSOT):** `docs/diagrams/*.drawio`.
- **Engineering rules:** `.agent-toolkit/rules/` — framework-owned lessons that keep
  the build green (Astro/Vite gotchas, prebuild ordering, shell portability,
  lockfile). Dev-plugin state, indexed in `.agent-toolkit/dev.md`; stripped from
  adopter clones by the init wizard.

## How the site builds

`knowledge/` → `sync.sh` → parallel prebuild (kb-index, search, content-dates,
git-info, related, changelog, map-markers, dashboard-lite) → `astro build` →
post-build contract checks. `src/content/` and `src/data/` are derived, gitignored
projections of `knowledge/` — never edit them directly.

## Writing an article

Read [docs/playbook/ARTICLE-PLAYBOOK.md](docs/playbook/ARTICLE-PLAYBOOK.md) first,
then follow [REWRITE-PIPELINE.md](docs/playbook/REWRITE-PIPELINE.md) stage by stage.
The short loop: draft in `knowledge/{Category}/{slug}.md` → self-check against the
playbook's quality gate →
`npm run article-health -- <file> --profile=ci-deploy` (the mandatory ship gate;
for a media-complete depth article also run the `--profile=rewrite-stage-4`
self-check per [ARTICLE-PLAYBOOK.md §7.4](docs/playbook/ARTICLE-PLAYBOOK.md)) →
`npm run sync` → `npm run build` → commit (the pre-commit hook re-validates staged
content).

## Iron rules

1. **SSOT:** `knowledge/` is the only content source of truth; `src/content/` is
   derived (gitignored, written by sync) and never edited directly.
2. **Genericity + English-only:** zero place-specific strings and zero CJK/multi-language
   code paths in any code tree — `src/`, `scripts/`, `tests/`, future `workers/`/plugin
   code; test fixtures are code. Place identity flows only from `place.config.ts` +
   `knowledge/` + `public/media/`. Machine-gated by `npm run genericity`
   (`scripts/ci/check-genericity.sh` + `scripts/ci/check-english-only.mjs`).
3. **Framework vs instance:** `src/` and `scripts/` are framework-owned — customize
   through config, content, and media. Anything more is upstreamed to sekai-kb and
   pulled back as a tagged release. The genericity gate is the structural guarantee.

## Skill ownership

The skills under `.claude/skills/` — `/write`, `/validate`, `/factcheck`, the
`/kb` router, plus `/adopt`, `/seed-articles` (and `/upgrade` when it ships) — are
**framework-owned**, the same class as `src/` and `scripts/`. They are managed
through framework upgrades; customize them the way you customize `src/`: through
`place.config.ts`, `knowledge/`, and the playbook, not by editing the skill
bodies.

- **Adding a skill is free.** A new skill is a new directory under
  `.claude/skills/`, so it never conflicts on `/upgrade`. The `/kb` router lists
  it automatically (it enumerates the directory, not a hardcoded set).
- **Overriding a framework skill** means either upstreaming the change to
  sekai-kb first (so every instance gets it), or accepting a conflict-managed
  local fork that `/upgrade` flags on each release.

Both machine gates (`npm run genericity`) scan `.claude/skills/` — agent-executed
prose is code for the genericity + English-only doctrine.

## Language support boundary

UI strings and editorial tooling are English-calibrated; Latin-script content
largely works (plain word tokenization; article-health prose thresholds may need
retuning per instance); CJK content is unsupported until the post-project
multi-language revisit. `place.locale` and `place.languages[]` are declared but
dormant schema seams — don't build on them.

## Semiont probe

`semiont/config.json` at the repo root configures the autonomous-organ layer
(memory, routines — arrives in a later framework release). Skills and scripts that
look for it must **no-op gracefully when it is absent**. It is absent in this
release; nothing should require it.

## Template mode

This repo carries a `.sekai-template` marker at its root, which switches the
genericity + English-only gates to scan the **whole tree** (so the template ships
zero real-place strings). `npm run init` removes the marker when you adopt the
template, reverting the gates to scanning the code trees only — your `knowledge/`
and `place.config.ts` then legitimately carry your place's identity.

## Dev workflow

The agent-toolkit dev plugin drives framework development (tasks, PRs, CI, review,
verify). Its config and promoted rules live in `.agent-toolkit/`; the entry point is
`AGENTS.md` (Codex reads it natively). Claude Code reaches the same chain through the
import below. This dev-plugin state is stripped from adopter clones by the init
wizard — adopters never see it.

@AGENTS.md
