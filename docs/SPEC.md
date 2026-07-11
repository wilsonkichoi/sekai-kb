# SPEC: LagunaBeach.md / Sekai KB

**Derived 2026-07-07 from `.fable/STRATEGIC-DIRECTION.md` §B (architecture PDR), §C
(extraction map), §D (build-new list).** This document is the operative spec for
dev-plugin skills; the strategic direction is the frozen source of record — where this
spec compresses, the cited section governs detail. Conflicts go to Wilson (see
`.claude/dev.md`). Engineering diagrams (SSOT): `docs/diagrams/architecture.drawio`,
`data-flow.drawio`, `repo-topology.drawio` — updated in the same PR as any architecture
change they depict (§B).

## Stack (§B "Stack")

- **Astro 6.x + Tailwind 4.x**, zero client-side frameworks; vanilla JS on interactive
  pages. Node ≥ 22.12.
- **MiniSearch** client-side search, index prebuilt; plain word tokenization (English-only
  site, no CJK code path).
- **D3 from CDN** for the knowledge graph only; **Chart.js from CDN** only if the dashboard
  needs it.
- **Leaflet + OSM tiles** for the map (deviation from upstream's D3/TopoJSON SVG map),
  CDN-loaded, page-scoped.
- **Python ≥ 3.12 via uv** for editorial tooling (added Phase 4): `article-health.py` and
  its pytest suite run through `uv run`; `pyproject.toml` + `uv.lock` ship with the
  framework, and `npm run prebuild:dashboard` shells into the tool (absent-safe: `|| true`).
  The 5.3 runbook documents uv setup for adopters.
- **Cloudflare Workers (free tier)** for all dynamic capability: feedback (Worker + D1),
  on-demand OG (Satori + resvg-wasm), RAG chat. RAG model space: **bge-m3, 1024-dim** for
  both corpus (offline: 4090 or Workers AI) and query (Workers AI `@cf/baai/bge-m3` —
  mandatory, the 4090 is unreachable at request time). At LB scale, retrieval is in-worker
  cosine over static JSON vectors; Vectorize is the documented path at ~4k+ vectors.
  Worker skeleton/chunking/CPU-limit details: v0 research §"RAG Chatbot" (mandatory
  pre-read for 7.2 executors, see `.claude/dev.md` binding references).

## Repo topology (§B "Repo topology", diagram `repo-topology.drawio`)

Phases 0-4: one repo (`lagunabeach-md`). After Phase 5: `sekai-kb` (framework SSOT, GitHub
template repo) + `lagunabeach-md` (instance #1, re-based onto it). Instances merge **tagged
releases only, never framework main**; determinism guaranteed by (a) immutable semver tags
+ CHANGELOG upgrade notes, (b) zero place content in the template, (c) `merge=ours` on
instance-owned files (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`,
`CLAUDE.md`), (d) the **ownership rule**: instance `src/` and `scripts/` are
framework-owned — customization flows through config/content/media; anything more is
upstreamed to sekai-kb first and pulled back as a release. `FRAMEWORK-VERSION` records the
instance's version; the `/upgrade` skill wraps fetch → merge tag → build-verify → conflict
report. Directory shape: §B's tree (same shape for framework and instances).

> **Skill ownership (2026-07-11 (c), task 5.6):** the framework skills under
> `.claude/skills/` (`/write`, `/validate`, `/factcheck`, router, plus `/adopt`,
> `/seed-articles`, `/upgrade`) are framework-owned, same class as `src/`. Adopters ADD
> new skills freely — new files never conflict on upgrade. Overriding a framework skill
> means upstreaming the change to sekai-kb first, or accepting a conflict-managed local
> fork that `/upgrade` flags on every release. The 5.4 `merge=ours` list extends beyond
> §B's five instance-owned files with `docs/baselines/**` and
> `scripts/ci/genericity-denylist.local.txt` (final list minted in the 5.4 packet).

> **Release train for post-cut feature phases (9-11, ADR 005):** those phases execute in
> `sekai-kb`; each ships as a tagged release, and instances (LB first) adopt via
> `/upgrade` per `docs/runbook/UPGRADE.md` (task 9.3). The upgrade pull into LB is part of
> each phase's exit gate.

## `place.config.ts` (§B — THE ingress for place identity)

Schema (full version in §B): `place {name, tagline, domain, locale, languages}`,
`categories[] {slug, title, icon, description}` (5-14), `map {center, zoom, maxBounds}`,
`features {graph, map, dashboard, soundscape, feedback, chat, social, analytics}`,
`links {repo, email, social {twitter?, threads?, instagram?}}`,
`seo {defaultOgImage, twitterHandle?}`. Init-time: written only by the `npm run init`
wizard (~8 prompts, or `--answers <json>` from `/adopt` — single writer, no drift).
Runtime-toggleable: `features`, languages, semiont organs.

> **`links` (added 1.1a):** the shell's Footer/SEO/Header need a GitHub repo URL,
> contact email, and social handles, which STRATEGIC-DIRECTION §B's schema does not
> define. Wilson approved extending the schema here rather than dropping the links.
> `links.social.*` render only when `features.social` is true. This intentionally
> diverges from §B (frozen source of record); the init wizard (5.2) must add `links`
> prompts. Tracked on LB-3.

> **Phase 9-11 extensions (approved 2026-07-07, ADR 005):** `features.mcp` (task 9.1)
> and `analytics` IDs (GA4 measurement ID, CF Web Analytics token — task 10.1) extend the
> schema under the same intentional-divergence pattern as `links`; init-wizard prompts
> tracked on the citing tasks (or Backlog stubs if 5.2 is closed when they land).
> **Absent-safe rule (spec invariant):** every new `place.config` key must default to
> feature-off when missing, so existing instances upgrade across framework releases
> without config edits.

> **`home` (added 1.1b):** the entire home-page copy surface — hero, stats, doors, cover
> story, exhibition halls, feature cards, section headings — lives in the config as a
> `home` block (~230 lines for LB). This keeps `src/` string-free (genericity win) but
> exceeds any init interview: the wizard (5.2a) writes generic defaults for `home.*`, and
> `/adopt` may draft place-specific copy behind the same human-approval gate as
> `/seed-articles`. The 5.1 demo place ships authored demo copy. Same
> intentional-divergence pattern as `links`.

## Content model (§B — unchanged and non-negotiable)

`knowledge/` is SSOT (plain Markdown + YAML frontmatter, `[[wiki-links]]`);
`scripts/core/sync.sh` projects it into gitignored `src/content/`, never edited directly.
Wiki-links resolve at build time into hyperlinks + graph edges. Map frontmatter key is
`geo: Name,lat,lng,Area` (the fork's actual schema — there is no `coordinates:` key).
Multi-language: 3-line wrapper pages per language importing `src/templates/*` bodies;
adding a language = wrapper dir + `languages` entry + `knowledge/{lang}/` content. The
translation cascade/babel tooling is NOT ported (§B, §F). This is a design sketch only:
the site is English-only through the current roadmap and language support is a
post-project revisit (PRD non-goals; STRATEGIC-DIRECTION 2026-07-11 revision note).
Adopter-facing boundary (2026-07-11 (c)): v1 tooling is English-calibrated; Latin-script
content largely works (plain tokenization; article-health prose thresholds may need
per-instance retuning); CJK is unsupported until that revisit (LB-24). Task 5.3 states
this in the adopter docs — documented honestly, never patched with code.

## Build pipeline (§B)

`sync.sh` → parallel prebuild (`run-p`: kb-index, search, content-dates, git-info,
related, changelog, map-markers, dashboard-lite) → latest → `astro build` → post-build
contract checks (`run-s`: smoke, internal-links, map-markers, graph, dashboard). Target
< 60s at 50 articles. The dashboard-lite job shells into article-health (uv) absent-safe.

**Static-endpoint naming: `/kb/`, not `/api/`** — `/kb/topics.json`,
`/kb/articles/{slug}.md`, `/kb/search-index.json`, plus `/llms.txt` at root. This is the
vendor-agnostic lazy-loading knowledge protocol: any browsing-capable AI reads `llms.txt`
→ `topics.json` → fetches only the articles it needs. `generate-api.js` ports as
`build-kb-index.mjs` with `/kb/` output paths.

## Pages (LB v1 complete list, §D)

`index`, `[category]/index`, `[category]/[slug]`, `explore`, `graph`, `map` (Leaflet, new),
`latest`, `about`, `contribute`, `changelog`, `dashboard`, `404`, `feed.xml`/`rss.xml`,
`llms.txt`, `/kb/*`. Phase 6 adds `soundscape` + feedback widget; Phase 7 adds `/chat`.

## New builds (§D, summarized — §D governs detail)

Leaflet map with GeoJSON markers + municipal boundary overlay (sourcing researched, v0
research §"Laguna Beach GIS"); feedback capability (Worker + D1 + ~100-line widget +
triage skill — replaces the 89-file Supabase harvest orchestrator); snippet social
pipeline (concept from spores, zero spore code); soundscape (native HTML5 audio);
on-demand OG worker; RAG chat + QR flow; framework scaffolding (init wizard, `/adopt`,
`/seed-articles`, `/upgrade`, playbook, runbook, template README + AGENTS.md pointer, and
the generic content-lifecycle skills `/write` `/validate` `/factcheck` + router — Phase 5
amendment 5.6, ROADMAP appendix); semiont plugin layer (§A3: default-on
core = boot identity <150 lines, MEMORY, REFLEXES; everything else opt-in; no
cross-organ dependencies).

## Extension capabilities — Phases 9-11 (ROADMAP extension blocks govern detail; ADR 005)

### MCP delivery (`workers/mcp/`, Phase 9)

Stateless Streamable-HTTP MCP server on Cloudflare Workers (createMcpHandler pattern, no
Durable Objects at LB scale — free-tier verified 2026-07, ADR 005; McpAgent/DO documented
as the scale-up path for adopters needing sessions). Tools: `list_topics`
(/kb/topics.json), `get_article` (/kb/articles/{slug}.md), `search` (keyword over
/kb/search-index.json), `semantic_search` (query embed via Workers AI `@cf/baai/bge-m3` +
in-worker cosine over the 7.2a vectors — same model space as chat, §Stack). Retrieval
code shared with `workers/chat/` lives in `workers/lib/`. Behind `features.mcp`. The
`/ai` page + `/kb/agent.md` boot file (task 9.2) document every AI consumption path;
cross-ref v0 research §"MCP Server and Alternative Knowledge Delivery" (mandatory
pre-read for 9.1/9.2 executors, same rule as the 7.2 pre-reads in `.claude/dev.md`).

### Analytics (`features.analytics`, Phase 10)

Full stack: GA4 + Google Search Console + Cloudflare Web Analytics (ADR 005). Beacon/gtag
injected by HeadInlineScripts only when the flag is on; IDs live in `place.config.ts`,
never in `src/`. Fetchers (ported from the v1 archive per §F's port-on-trigger) emit
`src/data/analytics/*.json` behind `npm run fetch:analytics`; dashboard renders panels
from them and the build stays green when they are absent. Credentials via local env /
Actions secrets, documented in the runbook.

### Autonomous routines (Phase 11)

Hybrid substrate (ADR 005): deterministic pipelines (embeddings/index refresh, analytics
fetch) run as GitHub Actions cron/push-triggers; AI routines (maintainer, feedback-triage,
trend-discovery, social-publish, rewrite) run as Claude Code native scheduled tasks on
Wilson's machine. `semiont/organs/routine/ROUTINE.md` is the SSOT — each routine =
`{id, substrate, schedule, skill, model, depends, ship-mode}`; the `/schedule` skill
registers/unregisters against the declared substrate. Lifecycle contract (taiwan-md's 5
stages with PR discipline replacing direct push): sync main → run skill → ship via PR per
ship-mode (`auto-merge-data` for data-only artifacts, `human-merge` for content) → finale
writes the MEMORY organ. Kill switch: disabling the routine organ in
`semiont/config.json` stops all routines.

## Extraction map — the implementation contract (§C)

Extraction source rule: **prefer the fork's copy** (`${SRC_HOME}/lagunabeach-md-v1`)
where de-Taiwan work is done; upstream (`${SRC_HOME}/taiwan-md`) is design reference
only. §C's lists are the contract: 6 CSS files verbatim-then-font-swap (byte-diff
verifiable); ~16 named components + `home/`/`timeline/` subdirs with a genericity pass;
10 template bodies; `graph.astro` whole; ~10 `scripts/core/` ports (incl. `generate-api.js`
→ `build-kb-index.mjs`); editorial tooling (`article-health.py` + config,
`verify-internal-links.sh`, `refresh-llms-txt.py`, visual-regression scripts, pre-commit
hooks); fork's `EDITORIAL.md` + `QUALITY-CHECKLIST.md` seed the playbook. `CATEGORY_MAP`
dies; categories come from `place.config.ts`. Dispositions for everything else: §F
(rewrite-now / delete-now / port-on-named-trigger — no "dormant").

> **article-health language policy (2026-07-11, LB-20):** the tool ports English-only.
> §C's "parameterize the CJK-specific checks by language" is superseded
> (STRATEGIC-DIRECTION 2026-07-07 (b), extended 2026-07-11): checks with a mixed
> language implementation keep their English core only; pure-CJK checks (`cjk_punct`,
> zh-TW pattern sets) are not carried. No language profile or `APPLIES_TO` gate exists.
> Scope fix (2026-07-11 (b)): the doctrine is whole-project — `tests/` fixtures are
> code and ship English-only with no fork place-brand strings; the tool's target set
> is exactly `knowledge/{Category}/*.md` (never spore/semiont/memory/report paths, which
> do not exist in this repo's content model — dead fork path-skips are removed).

## Deployment (§B)

GitHub Pages via Actions + Cloudflare DNS/CDN. Workers deploy via `wrangler` from
`workers/`, documented in the runbook. No paid services.

## Negative requirements

- **Genericity + English-only (CI-gated from 0.3; scope extended in LB-20):** zero
  place-specific strings in any code tree — `src/`, `scripts/`, `tests/`, and future
  `workers/`/plugin code; `scripts/ci/check-genericity.sh` fails the build on denylist
  hits, and the CI gate additionally fails on any CJK codepoint in those trees
  (English-only doctrine, machine-enforced — §A2, §E 0.3; STRATEGIC-DIRECTION
  2026-07-11 (b)). `.claude/skills/` joins both gates' scan roots when the framework
  skills land (task 5.6) — agent-executed prose is code for doctrine purposes.
- **No build-time OG generation ever** (§B); static default until the Phase 7 worker.
- **Site builds with `semiont/` deleted**; no organ reads another organ's files (§A3).
- **CI must run on pull requests**: build + genericity jobs trigger on `pull_request`
  (deploy job only on push to `main`) — every task PR gets CI (dev-plugin adoption
  amendment, 2026-07-07).
- **Phases 6-7 depend on 5.4**: no LB fun-features before the framework ships (§A2,
  §G risk 3).
- **Routines never push main directly** (Phase 11, ADR 005): every routine ships via a
  PR behind CI — `auto-merge-data` on green for data-only artifacts, `human-merge` for
  content. The dev-plugin iron rule (no work done outside a verified merge) applies to
  automation, not just humans.
- **New `place.config` keys must be absent-safe**: a missing key means the feature is
  off; framework upgrades never require config surgery on existing instances.
- **Design parity fallback**: if any page misses the visual bar, copy that page's fork
  implementation wholesale and re-genericize — never re-prompt from description (§G risk 1).
