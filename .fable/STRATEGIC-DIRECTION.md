# Strategic Direction: LagunaBeach.md → Sekai KB

**Author:** Fable 5, acting as senior technical architect. **Date:** 2026-07-04.
**Status:** Binding. Executed by Opus 4.8 / Sonnet 5 without further consultation.
**Verified against:** `${SRC_HOME}/lagunabeach-md-v1` (fork) and `${SRC_HOME}/taiwan-md` (upstream), both read locally on 2026-07-04. All file paths cited below were confirmed to exist.
**Third reference input:** `${SRC_HOME}/lagunabeach-md-v0/_research/taiwan-md-research.md` and `taiwan-md-llm-wiki.md`, the v0-era deep research on upstream. Executors of Phases 2, 5, and 7 must read the relevant sections before starting (specific pointers inline below); the RAG worker, OG worker, and QR flow are already substantially designed there.
**Revised 2026-07-05** (Fable 5, with Wilson): framework renamed `place-md` → `sekai-kb`; `/adopt` AI-interview made the primary adopter bootstrap path (§D.7, 5.2a-c); tagged-release upgrade discipline added (§B topology, 5.4: semver tags, CHANGELOG, FRAMEWORK-VERSION, `/upgrade` skill, ownership rule); architecture diagrams added (`.fable/diagrams/*.drawio` staged now → `docs/diagrams/` in the new repo, plus new task 5.5 SystemDiagram.astro); `features.analytics` toggle added to the config schema.
**Revised 2026-07-07 (b)** (Wilson's call): CJK bigram tokenizer is **not kept**. The "kept behind language flag for CJK adopters" language in §B Stack, §C extraction map (line 728), and §E task 3.1 step 1 slipped through from the fork unintentionally. This is an English-only site; no non-EN language gate exists or is planned. The tokenizer code is removed (LB-13); future search (task 3.1) uses plain word tokenization only. If a future sekai-kb adopter needs CJK, they build it fresh at that time, not carry dead fork code forward. Affected sections: §B "MiniSearch" bullet, §C extraction table row "CJK bigram tokenizer", §E [3.1] step 1, §C "article-health.py" parenthetical. Read those lines as superseded by this note.
**Revised 2026-07-11** (Wilson's call, during LB-20 review): the 2026-07-07 (b) English-only doctrine extends to the article-health sections its affected-list missed — §E task [4.1] step 1 ("CJK-specific checks move behind a language profile so Latin corpora skip them") and §C Editorial/quality tooling's "parameterize the CJK-specific checks by language". Read both as superseded: article-health ports **English-only** — checks with a mixed language implementation keep their English core; pure-CJK checks (`cjk_punct`, the zh-TW pattern sets) are not carried at all. No language profile, no `APPLIES_TO` gate, no per-check CJK exception exists in this repo. Doctrine scope confirmed: **sekai-kb v1 (Phase 5) ships English-only**; multi-language support (CJK included) is a post-project revisit after the current roadmap completes, built fresh at that time — the `lagunabeach-md-v1` archive retains the fork's CJK implementations for reference. No task may retain or re-add a CJK code path by citing a hypothetical Phase-5 CJK adopter; §B's "Multi-language design" section remains a design sketch whose trigger moves to that post-project revisit.
**Revised 2026-07-11 (b)** (Wilson's call, LB-20 review round 2): the English-only doctrine and the genericity rule are **whole-project**, never per-directory. The earlier same-day amendment scoped LB-20 DoD-3's CJK grep to `scripts/` only; that reading let fork place-brand strings (`author: 'Taiwan.md'`) and zh-TW fixture bodies ship in `tests/` while the gate stayed green. Corrected: no CJK/multi-language code path, language profile, `APPLIES_TO` gate, CJK fixture, or fork place-brand string in ANY committed code or test tree — `src/`, `scripts/`, `tests/`, `workers/`, plugin code, every present and future code directory. Test fixtures are code. Prose documentation is exempt only where it records fork history or the Sekai (世界) brand etymology; `knowledge/` content is governed by the editorial playbook, not this rule. Enforcement is machine, not prose: `scripts/ci/check-genericity.sh` extends its denylist scan to `tests/` and the CI gate gains a CJK-codepoint scan over the same trees (both land in LB-20). Corollary rulings: the fork's spore/harvest apparatus (`SPORE-BLUEPRINTS/`, `SPORE-HARVESTS/`) is delete-now per §F and never returns as content paths — the Phase-6 snippet pipeline is rebuilt from concept with zero spore code; the Phase-8 semiont organ tree is never an article-health target (the tool scans `knowledge/{Category}/*.md` only, and the site must build with `semiont/` deleted). Path-skip branches for spore/memory/diary/reports paths in ported tooling are dead fork code, removed under the clean-rebuild rule.
**Revised 2026-07-11 (c)** (Wilson's call, Phase-4 close review): §F's `lb-*` skills row is superseded. Its "Port now" list was never executed — no §E task carried the port, and `.claude/skills/` does not exist in the rebuild repo at Phase-4 close. Re-disposition: the content-lifecycle trio ports as new Phase 5 task **5.6** (task block in `docs/ROADMAP.md`'s "Phase 5 amendment" appendix, same tracked-extension mechanism as Phases 9-11) — `/write`, `/validate`, `/factcheck` plus a thin router, genericized at port time (place identity from `place.config.ts`, pipelines from `docs/playbook/`, no `lb-` prefix survives in any name or prose) and shipped **framework-owned in the sekai-kb template**: per §B's tree the skills are framework code, not instance content — adopters add new skills freely (new files never conflict on upgrade), but overriding a framework skill means upstreaming to sekai-kb first or accepting a conflict-managed local fork that `/upgrade` flags each release. The rest of the old "Port now" list: `lb-translate` → post-project multi-language revisit (LB-24; doctrine notes above); `lb-become` → Phase 8.1 (semiont loader); `lb-refresh`/`lb-news-lens`/`lb-peer`/`lb-media-audit` → not ported as skills, their concepts return as Phase 11 routines (11.8, 11.6, 11.3); `lb-sync`/`lb-search` → documented npm-command workflows in the 5.3 runbook. Companion ruling (same session): sekai-kb v1's adopter-facing docs (5.3) must state the language support boundary explicitly — tooling is English-calibrated, Latin-script content largely works, CJK is unsupported until the post-project revisit — with zero code change; the 2026-07-11/(b) doctrine is unchanged.
**Revised 2026-07-07** (Fable 5, Wilson's call): the §E.0 execution protocol (`.handoff/` two-session loop, `lb-implement`/`lb-review` skills) is REPLACED by the **dev plugin** lifecycle (agent-toolkit `plugins/dev`). Tracker: **Linear** (workspace `sekai-kb`, team `LB`, project "LB Rebuild") as the single source of truth for task state; one PR per task behind CI; lifecycle `/dev:execute` → `/dev:review-pr` → `/dev:verify`; mid-flight changes via `/dev:backlog`; retros via `/dev:retro`. The `.handoff/` files and `lb-implement`/`lb-review` skills are not used and were not copied into this repo (they remain readable in the `lagunabeach-md-v1` archive). §E's task CONTENT remains the source for task packets — converted by `/dev:plan`, never re-derived. Wilson gates in §E (1.1c design sign-off, 3.2 domain cutover, 5.2c dana-point proof, every phase transition) become manual DoD criteria on their tasks plus Linear milestone boundaries. Per-task `Executor:` model lines become advisory version-less `Model:` notes in packet bodies (Wilson picks each session's model); §E.0's reviewer-model policy becomes `Review-Model: Opus` notes on 1.1c, 1.2b, and each phase-closing task (reviews default Sonnet otherwise). Operative-doc rule: once `docs/PRD.md`/`docs/SPEC.md`/`docs/ROADMAP.md` are approved, they are the operative docs for dev-plugin skills; this file is the frozen source of record; conflicts go to Wilson, never silently resolved. Everything else in this document stays binding as written.

---

## A. Strategic Decisions

### A1. Codebase: Hybrid rebuild in a fresh repo. Not fork continuation, not blind greenfield.

**Decision:** Stop maintaining the fork. Create a fresh Astro project and extract into it, as literal files, the design system (7 CSS files, ~2,500 lines), a curated subset of ~15 components, ~10 build scripts, and the editorial tooling. Write new page shells and everything else clean.

**Justification:** The v0 greenfield failed because design was *described in prompts*; the hybrid copies the actual `tokens.css`, `global.css`, `article-modules.css`, and component files, so the failure mode that killed v0 does not apply. The fork's ongoing cost is structural, not incidental: the last upstream merge alone (297 commits) required 3 phases of de-Taiwan work, and 34 `.astro` files in the current fork still hardcode "Laguna" while upstream assumptions (CJK bigram recall paths, 3000-article expectations) keep resurfacing. The genuinely valuable inheritance is ~30 files out of 1,519; extraction is a bounded 2-3 day job, whereas de-Taiwan maintenance is unbounded. Upstream merging ends permanently with this decision; future Taiwan.md improvements are cherry-picked by hand if ever wanted (see Risk 5).

### A2. Build order: One repo, framework architecture from day one, framework *cut* as a scheduled phase before any Horizon-2 LB feature.

**Decision:** Build the new code in the fresh `lagunabeach-md` repo under a hard genericity rule: **zero place-specific strings in `src/` or `scripts/`; all place identity flows from `place.config.ts` + `knowledge/` + `public/media/`**, enforced by a CI grep gate from day one. When LB reaches content parity and domain cutover (end of Phase 4), the framework repo **`sekai-kb`** is cut from this codebase as Phase 5: strip LB content, add the init wizard, seed-article skill, playbook, runbook, and AI onboarding boot file. Phase 5 completes before Phase 6 (social/soundscape/feedback) or Phase 7 (RAG/QR) begin. LB's fun features wait behind the framework; that ordering is the anti-deferral guarantee.

**Justification:** Framework-first with zero working instances repeats Taiwan.md's coupling mistake in mirror image: you would guess at the config surface instead of deriving it from a real second place. Two-repo simultaneous development doubles merge traffic during exactly the highest-churn period. Instance-first-with-extraction-"later" is the deferral trap Wilson has been burned by; this plan closes it by making the cut a numbered phase with acceptance criteria, sequenced *ahead* of the features Wilson personally wants most. The genericity CI gate is what makes late extraction safe: nothing LB-specific can bake into the shared code because the build fails if it does.

**Name:** `sekai-kb` (repo), **Sekai KB** (brand; renamed from the earlier working name `place-md`/Place.md, 2026-07-05, Wilson's call). Sekai (世界, "world"): the framework is the world-level knowledge-base system; each instance is one place in that world. Instances remain places — `place.config.ts` and the `place:` config key keep their names. The eventual CLI is `create-sekai-kb`, but framework v1 ships as a GitHub template repo + in-repo `npm run init` wizard, which delivers the full zero-to-deployed-in-an-hour capability without npm publishing ceremony. Publish `create-sekai-kb` to npm when the second external adopter appears or the template flow shows friction, whichever first.

### A3. Semiont: Modular plugin layer. Minimal core on by default, every other organ opt-in.

**Decision:** Semiont becomes a `semiont/` directory that the site build never imports from (the site must build with the directory deleted). A `semiont/config.json` manifest lists enabled organs. **Default-on core (3 organs):** boot identity (a <150-line replacement for the 753-line BECOME protocol), MEMORY (session handoff), REFLEXES (accumulated don't-do rules). **Opt-in organs:** MANIFESTO (voice/identity guard), DIARY, ROUTINE (cron config SSOT), INTROSPECTION pack (longings, unknowns, consciousness snapshot, DNA map). Organs may not require each other; skills probe for organ existence and no-op gracefully when absent. LB enables core + MANIFESTO at launch, DIARY when Wilson wants it, ROUTINE when the first cron routine activates.

**Justification:** The audit in the brief is correct: memory/reflexes/manifesto/routine earn their keep; the introspection organs are art. Laguna Beach is an art town and Wilson values the experiment, so the art stays available as a plugin rather than being killed or being mandatory. The hard architectural requirement is the no-cross-dependency rule plus the site-builds-without-it rule; those two constraints are what Taiwan.md's monolith violates and what makes plug-and-play real rather than aspirational.

---

## B. Architecture PDR

**Diagrams** (drawio sources + PNG exports, added 2026-07-05; staged at `.fable/diagrams/` in the v1 repo, copied to `docs/diagrams/` in the new repo at 0.1 step 4): `architecture.drawio` (full system: SSOT → build pipeline → static site → readers/AI consumers/workers), `data-flow.drawio` (content lifecycle: research → gates → knowledge/ → consumption → feedback signals → back to curation), `repo-topology.drawio` (framework/instance split, tag-based upgrade flow). The reader-facing rendering of the architecture is task 5.5's SystemDiagram.astro; the drawio files are the engineering SSOT and are updated in the same round as any architecture change they depict.

### Stack (confirmed, one deviation)

- **Astro 6.x + Tailwind 4.x**, zero client-side frameworks, vanilla JS on interactive pages. Node ≥22.12. Unchanged from upstream.
- **MiniSearch** client-side search, index prebuilt. The CJK bigram tokenizer in `scripts/core/build-search-index.mjs` is kept as a code path gated by `place.config.languages` (costs nothing, CJK adopters need it); Latin-only places get plain word tokenization.
- **D3 from CDN** for the knowledge graph only.
- **Leaflet + OSM tiles** for the map (deviation from upstream's D3/TopoJSON SVG island map, per §4 of the brief). CDN-loaded, page-scoped.
- **Chart.js from CDN** for the dashboard, if and only if the dashboard page needs it.
- **Cloudflare Workers (free tier)** for all dynamic capabilities: feedback intake (Worker + D1), on-demand OG (Worker + Satori + resvg-wasm), RAG chat. RAG specifics: corpus embeddings are built offline (Wilson's 4090 or Workers AI, either way model **bge-m3, 1024-dim**); query-time embedding MUST go through Workers AI `@cf/baai/bge-m3` because the 4090 is not reachable at request time, and corpus + query vectors must share the same model space. At LB scale (16-50 articles, a few hundred chunks) retrieval is in-worker cosine similarity over a static JSON vector file cached in global scope; Cloudflare Vectorize becomes the right store at Taiwan scale (~4k+ vectors), and the framework documents both paths. Full worker skeleton, chunking strategy (300-500 tokens, split on `##` headings), RRF hybrid-search option, and V8 CPU-limit caveats: `lagunabeach-md-v0/_research/taiwan-md-research.md` §"RAG Chatbot: Architecture for a Static Site".

### Repo topology and directory structure

**During Phases 0-4** there is one repo, the new `lagunabeach-md`. **After Phase 5** there are two: `sekai-kb` (framework SSOT, GitHub template repo) and `lagunabeach-md` (instance #1, re-based onto the template). Instances receive framework updates by merging **tagged releases, never a moving main**: `git remote add framework … && git fetch framework && git merge sekai-kb-vX.Y.Z`. The merge is deterministic by construction: (a) the merge target is an immutable semver tag with a `CHANGELOG.md` entry (breaking config changes carry an upgrade note); (b) the template contains no place content; (c) instance-owned files (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`) carry `.gitattributes merge=ours` (the mechanism already proven on the fork's CLAUDE.md); (d) the **ownership rule**: in an instance, `src/` and `scripts/` are framework-owned — instance-local edits to them are what break merge determinism, so customization goes through `place.config.ts`/`knowledge/`/`public/media/`, and anything beyond that is upstreamed to `sekai-kb` first, then pulled back as a release (rule enforced by the review-loop checklist, see §G risk 4). Instances record their framework version in a `FRAMEWORK-VERSION` file (written by init, bumped by the `/upgrade` skill, which wraps fetch → merge tag → build-verify → conflict report). Repo-topology and upgrade-flow diagram: `docs/diagrams/repo-topology.drawio` (staged pre-cut at `.fable/diagrams/`).

```
sekai-kb/  (and every instance, same shape)
├── place.config.ts          # THE ingress for place identity (see below)
├── knowledge/               # SSOT content. Instance-owned. Template ships demo place.
│   ├── {Category}/…*.md     #   plain Markdown + YAML frontmatter, [[wiki-links]]
│   ├── About/
│   └── INBOX.md
├── src/
│   ├── components/          # ~15 extracted + new. Generic: reads place.config only.
│   ├── layouts/Layout.astro
│   ├── templates/           # page bodies as components (upstream pattern, kept)
│   ├── pages/               # thin wrappers importing templates; en-only at v1
│   ├── styles/              # tokens.css, global.css, article-modules.css, dark-polish.css,
│   │                        #   dashboard.css, shot-mode.css  (extracted verbatim, fonts swapped)
│   ├── content/             # DERIVED, gitignored, written by sync.sh. Never edited.
│   └── data/                # DERIVED build JSONs (search index, related, markers…)
├── scripts/
│   ├── core/                # ~10 ported scripts (list in §C)
│   ├── tools/               # article-health.py + config, verify-internal-links, visual/
│   └── ci/check-genericity.sh   # NEW: fails build on place-specific strings in src|scripts
├── workers/                 # Cloudflare Workers: feedback/, og/, chat/  (Phases 6-7)
├── semiont/                 # OPTIONAL plugin layer; site builds with this deleted
│   ├── config.json          # { "organs": { "memory": true, "reflexes": true, … } }
│   └── organs/{memory,reflexes,manifesto,diary,routine,introspection}/
├── .claude/skills/          # generic skills: write, validate, factcheck, sync, search,
│                            #   become (reads semiont/), implement/review loop, adopt (framework)
├── docs/
│   ├── playbook/            # ARTICLE-PLAYBOOK.md, EDITORIAL.md, QUALITY-CHECKLIST.md
│   └── runbook/             # DEPLOY.md (GH Pages, Cloudflare, domain, CI, pre-commit)
└── CLAUDE.md                # AI onboarding boot file (adopter need #6), <150 lines
```

### `place.config.ts` (what is configurable at init vs runtime)

```ts
export default {
  place: { name, tagline, domain, locale: "en", languages: ["en"] },
  categories: [ { slug, title, icon, description } ],       // 5-14 supported
  map: { center: [lat, lng], zoom, maxBounds },              // Leaflet init
  features: { graph: true, map: true, dashboard: true,       // per-feature toggles;
              soundscape: false, feedback: false, chat: false, social: false,
              analytics: false },                             // GA4/SC fetchers port on trigger (§F)
  seo: { defaultOgImage, twitterHandle? },
}
```

Init-time (the `npm run init` wizard asks ~8 questions and writes this file + seeds `knowledge/` category directories + generates `CLAUDE.md` header + `CNAME`): place name, tagline, domain, default language, categories, map center/zoom. Runtime-toggleable: everything under `features`, languages (append + add wrapper pages), semiont organs.

### Build pipeline

`sync.sh` → parallel prebuild (kb-index, search, map-markers, related, content-dates, git-info, latest, dashboard-lite) → `astro build` → post-build smoke + internal-link check. Target < 60s at 50 articles. No build-time OG generation ever (static default image until the Phase 7 worker). The fork's 20-job prebuild chain shrinks to ~9 jobs; each dropped job's disposition is in §F.

**Static-endpoint naming: `/kb/`, not `/api/`.** These are static JSON/markdown files, not an application programming interface; upstream's `/api/` convention is not carried forward. Layout: `/kb/topics.json` (lightweight index: slug, title, description, url), `/kb/articles/{slug}.md` (raw markdown per article), `/kb/search-index.json`, plus `/llms.txt` at root. This doubles as the vendor-agnostic lazy-loading knowledge protocol from the v0 research (`taiwan-md-research.md` §"Alternative: URL-driven lazy-loading knowledge protocol"): any browsing-capable AI reads `llms.txt` → `topics.json` → fetches only the articles it needs, one HTTP request each, no MCP and no clone required. `generate-api.js` is ported but renamed `build-kb-index.mjs` with output paths changed accordingly.

### Content model

Unchanged and non-negotiable: `knowledge/` is SSOT, `scripts/core/sync.sh` projects into gitignored `src/content/`, wiki-links `[[Title]]` resolve at build time into hyperlinks + graph edges. The fork's 16 articles + 3 About pages + `INBOX.md` move over as-is. (Correction 2026-07-04: `knowledge/zh-TW/` does not exist in the fork — zero translated files were found on re-verification. Multi-language content starts empty; the zh-TW carry-over described in an earlier draft is void.)

### Multi-language design (framework capability, LB trigger: first second-language launch)

Upstream's pattern is verified clean: `src/pages/en/explore.astro` is a 3-line wrapper importing `src/templates/explore.template.astro`. Keep exactly this. Adding a language = new wrapper directory + `languages` entry + translated content under `knowledge/{lang}/`. The 4-tier translation cascade, lang-sync tooling, and babel batch system are NOT ported (they exist for censorship-bypass at 843-article scale); translation at LB/framework scale is the single-article `lb-translate` pipeline.

### Deployment

GitHub Pages via Actions + Cloudflare DNS/CDN, unchanged. Workers deploy via `wrangler` from `workers/`, documented in the runbook. No paid services.

---

## C. What to Extract from Taiwan.md (verified paths)

Extraction source rule: **prefer the fork's copy** (`${SRC_HOME}/lagunabeach-md-v1`) where de-Taiwan work is already done and correct; fall back to upstream (`${SRC_HOME}/taiwan-md`) as design reference. Both repos hold the same filenames for everything below (verified).

**Design system, copy verbatim then swap fonts (Opus does the swap):**
- `src/styles/tokens.css` (120 lines, the design SSOT: container widths, spacing, radius, shadows, type scale). Replace the four CJK font stacks (`jf-jinxuanlatte`, `jf-lanyangming`, Noto TC families) with a Latin pairing; keep every non-font token untouched.
- `src/styles/global.css` (640), `src/styles/article-modules.css` (1,238), `src/styles/dark-polish.css` (505), `src/styles/dashboard.css`, `src/styles/shot-mode.css`.
- Skip `src/styles/semiont.css` until/unless a semiont page ships.

**Components (from `src/components/`), extract now:** `Header.astro`, `Footer.astro`, `SEO.astro`, `HeadInlineScripts.astro`, `ArticleCard.astro`, `ArticleHero.astro`, `ArticleSidebar.astro`, `TableOfContents.astro`, `CategoryGrid.astro`, `PageHero.astro`, `Banner.astro`, `BrandMark.astro`, `FeatureCards.astro`, `HeroStats.astro`, `ReaderSettings.astro`, `TopicCard.astro`, plus the `home/` and `timeline/` subdirectories (home hero + changelog timeline). Each gets a genericity pass: strings and links come from `place.config.ts`, not literals.

**Templates (from `src/templates/`), extract as design bodies, rewrite data wiring:** `home.template.astro`, `article.template.astro`, `category-hub.template.astro`, `explore.template.astro`, `latest.template.astro`, `about.template.astro`, `contribute.template.astro`, `changelog.template.astro`, `dashboard.template.astro`. `map.template.astro` is extracted for its page chrome only; the map body is new Leaflet code. `soundscape.template.astro` (upstream) is design reference for Phase 6.

**Pages:** `src/pages/graph.astro` (contains the wikilink-regex graph builder inline at ~line 223-250; port whole, parameterize hub list from categories). Thin wrapper pages are rewritten fresh (they are 3 lines each).

**Build scripts (`scripts/core/`), port now:** `sync.sh`, `build-search-index.mjs` (tokenizer behind language flag), `generate-map-markers.js` (rewrite output to GeoJSON for Leaflet), `build-related-tagoverlap.mjs` (fork-only, upstream core lacks it), `build-git-info.mjs`, `build-content-dates.mjs`, `build-latest.mjs`, `generate-api.js` (ported as `build-kb-index.mjs` emitting `/kb/*` per §B naming; raw-markdown + llms endpoints are core to AI-native positioning), `post-build-check.mjs`, `test-frontmatter.mjs`.

**Editorial/quality tooling (`scripts/tools/`), port now:** `article-health.py` + `article-health.config.toml` (parameterize the CJK-specific checks by language; the fork's copy is the base), `verify-internal-links.sh`, `refresh-llms-txt.py`, `scripts/visual/capture-baseline.mjs` + `diff.mjs` (fork-only; used during the rebuild itself for design-parity checks), pre-commit hooks (credential scan + frontmatter validation).

**Docs, port now:** fork's `docs/editorial/EDITORIAL.md` (English), `QUALITY-CHECKLIST.md`; these seed the framework playbook.

**Made generic (parameterized by place/categories/language):** every component above, `article-health.config.toml` profiles, search tokenizer selection, map-marker frontmatter schema (correction 2026-07-04: the actual key is `geo: Name,lat,lng,Area` — 14 of the 16 LB articles already carry it; there is no `coordinates:` key; `geo:` stays), CATEGORY_MAP (dies entirely; categories come from `place.config.ts`).

**Copied as-is (no parameterization needed):** the six CSS files (post font-swap), `sync.sh`, `test-frontmatter.mjs`, visual-regression scripts.

---

## D. What to Build New

**Pages (LB v1 complete list):** `index`, `[category]/index`, `[category]/[slug]` (article), `explore` (search), `graph`, `map` (Leaflet, new), `latest`, `about`, `contribute`, `changelog`, `dashboard`, `404`, `feed.xml`/`rss.xml`, `llms.txt`, `kb/topics.json` + `kb/articles/[slug].md` (static knowledge endpoints for AI consumers, per §B naming). Phase 6 adds `soundscape` and the feedback widget on article pages; Phase 7 adds `/chat` (QR landing).

**New features, not in Taiwan.md:**
1. **Leaflet map** with GeoJSON markers from article frontmatter, category-colored, popup → article link, plus the Laguna Beach municipal boundary as a GeoJSON overlay. Boundary sourcing is already researched (`taiwan-md-research.md` §"Laguna Beach GIS & TopoJSON Notes"): Overpass Turbo query `relation["name"="Laguna Beach"]["boundary"="administrative"]`, or Orange County GIS Portal (data-ocpw.opendata.arcgis.com), or US Census TIGER/Line Places; simplify via Mapshaper. Leaflet consumes GeoJSON directly, so skip the TopoJSON conversion step described there.
2. **Feedback capability** (Phase 6): `FeedbackWidget.astro` (new, ~100 lines) posting to `workers/feedback/` (CF Worker + D1). Triage skill reads D1, files GitHub issues. Replaces the 89-file Supabase harvest orchestrator outright.
3. **Social publishing pipeline** (Phase 6): generic "snippet" concept (pick article → generate short-form → human-approve → publish), one skill + one queue file (`knowledge/SNIPPET-INBOX.md`), platform adapters added when LB accounts exist. Rebuilt from the spore *concept*, zero spore code.
4. **Soundscape** (Phase 6): native HTML5 audio page, `knowledge/sounds/` manifest, community-sourced recordings.
5. **On-demand OG** (Phase 7): `workers/og/` with Satori + resvg-wasm, keyed by slug, cached at Cloudflare edge.
6. **RAG chatbot + QR flow** (Phase 7): corpus embeddings built on the 4090 (`build-embeddings.mjs` ported then, model bge-m3 to match the Workers AI query path per §B), vectors shipped as static JSON to `workers/chat/`, which embeds the query via Workers AI `@cf/baai/bge-m3`, does in-worker cosine retrieval, and calls the Claude API with citation-required prompting; QR codes at physical locations deep-link `/chat?ctx=<location>`. Implementation base: the worker skeleton, chunking table, and cost analysis in `taiwan-md-research.md` §"RAG Chatbot", adapted from Vectorize to static-JSON retrieval at LB scale.
7. **Framework scaffolding** (Phase 5). The primary adopter path is **template + AI interview** (decided 2026-07-05): GitHub "Use this template" → open Claude Code in the clone → `/adopt` interviews the adopter — place name, tagline, domain, map center (geocode suggestion from the place name), default language, categories, and *any existing material about their place* (files/URLs to ground seed articles) — then writes config by calling `npm run init --answers <json>` non-interactively and offers `/seed-articles`. Components: `npm run init` wizard (~8 prompts interactive, plus the `--answers` mode; the wizard is the single writer of `place.config.ts` so the AI and non-AI paths cannot drift — it also seeds category dirs, CNAME, CLAUDE.md header), `/seed-articles` skill (AI drafts 5 starter articles about the adopter's place — grounded in adopter-supplied source material when provided, AI research otherwise — health-checked, human-approval gate before commit), `/adopt` skill (the interview + guided walkthrough above, referencing the runbook), `/upgrade` skill (per §B: merge a framework release tag, build-verify, conflict report), `docs/playbook/` + `docs/runbook/` written for a first-timer with exact commands.

**Semiont plugin (Phase 8, architecture per §A3):** organ loader is the boot section of `CLAUDE.md` reading `semiont/config.json`. Minimal config = memory + reflexes (two markdown files, one boot paragraph). Maximal = all organs + cron routines registered via the `schedule` skill, each routine an independent opt-in. Toggling = editing `config.json`; no organ deletion required, no organ may read another organ's files.

---

## E. Task List (expanded 2026-07-04 by Fable 5; §E.0 execution protocol added same day; executors follow as written, no further expansion pass)

Grounding notes from the expansion pass (fork re-read 2026-07-04): (a) `knowledge/zh-TW/` does not exist — the zh-TW carry-over is void, see corrected §B; (b) the map frontmatter key is `geo: Name,lat,lng,Area`, present on 14 of 16 articles, not `coordinates:` — see corrected §C; (c) the fork's font stacks (`tokens.css:51-54`) are already Latin-first (Georgia / Inter) with CJK fallbacks, so the "font swap" is deleting the CJK fallback families, not choosing a new pairing — and Inter loads via a Google Fonts `<link>` in `Layout.astro:143-154` (Noto TC families ride the same URL), not self-hosted woff2; (d) task **1.4 is new** — the skeleton had no task building about/contribute/changelog, which §D lists as v1 pages; (e) same-day revision: §E.0 added below; the L/XL tasks are split into session-sized sub-units (1.1a-c, 1.2a-c, 5.2a-c, 6.1a-b, 7.2a-c) with `Est:` lines and phase subtotals. The "no further expansion pass" clause applies to this revised list.

### E.0 Execution protocol (governs every task below)

> **SUPERSEDED 2026-07-07** (see the revision note at the top): execution now runs through the dev plugin (Linear tracker, PR-per-task, `/dev:*` lifecycle). This section is kept as the source for what the protocol must preserve — session-sized sub-units, rules-at-point-of-use (now: self-contained task packets), machine gates, the model policy, the binding-references table, and the Wilson gates — but the `.handoff/` loop mechanics and `lb-implement`/`lb-review` skills it describes are not in use.

Added 2026-07-04. Motivation: no model executes a §E phase in one sitting, and the v1 fork's two-session loop — which shipped ~30 rounds through Horizon 0.6 — is proven in shape only: in practice the implementer model often missed or ignored rules stated in skill prose, costing send-back rounds. This protocol keeps the loop's shape and fixes the compliance mechanics.

**Session-unit rule.** The unit of execution is one sub-unit: one implementer session producing one reviewable commit group — roughly ≤6 files of new/changed logic, or one page surface. Tasks marked Effort S/M are one sub-unit as written; every L/XL task is pre-split below into lettered sub-units (1.1a, 1.1b, …). If a queued sub-unit still doesn't fit one session, the REVIEWER splits it further at queue time; the implementer never re-scopes its own task.

**The loop.** Every sub-unit is one round of the two-session loop carried over from the v1 fork (`.claude/skills/lb-implement`, `.claude/skills/lb-review`, `.handoff/`). Operating pattern (Wilson's): two terminals stay open — implementer and reviewer — and he alternates `/lb-implement`, `/lb-review`, `/lb-implement`, …, clearing context between rounds. Every round is therefore fully self-contained: each skill invocation reconstructs all state from the `.handoff/` files; nothing depends on prior session memory.
1. Reviewer queues the round to `.handoff/TO-IMPLEMENTER.md`: the sub-unit's §E block quoted in full (steps + acceptance verbatim), the concrete rules for THIS round restated from §E.0, and measured counts (`ls`/`grep`) where relevant.
2. Implementer session (`/lb-implement`): does the work in-session (no subagents), builds, commits, writes the report to `.handoff/TO-REVIEWER.md` ending with the self-check block, appends one line to `.handoff/LEDGER.md`.
3. Reviewer session (`/lb-review`): re-verifies every claim against the repo (grep/ls/build — never trusts report prose), checks each §E acceptance criterion against evidence, ticks the finished task in `.handoff/PROGRESS.md`, then queues the next sub-unit or sends the round back. Judgment calls that change scope or design go to Wilson, not decided unilaterally.

State files: `LEDGER.md` — append-only work log. `PROGRESS.md` — the full §E task checklist in dependency order; the reviewer ticks completions and picks the next task as the first unchecked entry whose dependencies are all checked (this is how "what's next" is derived after a context clear — never from memory). `BACKLOG.md` — discovered work: the implementer appends anything out of the queued round's scope instead of doing it; the reviewer triages each entry (blocking → fold into the next round; new scope → hold and surface to Wilson at the next phase gate, where he accepts it into §E/PROGRESS or drops it). The two `TO-*` files hold exactly one live round at a time. If loop state is ever lost (both `TO-*` files consumed/empty), `/lb-review` runs recovery: verify the last LEDGER round against the repo, then queue from PROGRESS.md.

**Skill port is port-and-refine, not copy.** The v1 skills' observed failure mode is rules-in-prose: a 100-line skill read once at session start, rules dropped by mid-session. The rebuild copies (pre-authored by Fable 5 at `.fable/skills/`, copied in at 0.1 step 4) apply four fixes:
- **Rules live in the queued task, not the skill.** The skill keeps ≤5 universal rules (no subagents; build before report; commit only task files; no fabricated facts; report in the template). Everything task-specific — genericity, extraction-source, verbatim-copy verification — is restated by the reviewer in `TO-IMPLEMENTER.md` every round, at point of use.
- **Mandatory self-check block** ends every implementer report: build output pasted? genericity grep run and clean? files touched == files the task names? each acceptance criterion quoted with its evidence (command + output)? A blank or hand-waved entry is an automatic send-back.
- **Machine gates over prose rules.** The CI genericity check (0.3), post-build smoke, and internal-link check enforce the most-violated rules regardless of model attention. When reviews keep catching the same rule violation, prefer adding a check to `scripts/ci/` over adding a paragraph to the skill.
- **Rebuild rules replace migration rules.** Task SSOT is this file's §E, not `ROADMAP.md`; the KEEP-CJK classification and 7% broken-ratio gate do not carry over. What carries unchanged: reviewer re-verifies everything; minimal change; every changed line traces to the queued task.

**Bootstrap (Round 1).** The execution payload is pre-authored (Fable 5, 2026-07-04) in the v1 repo at `.fable/`: the refined `lb-implement`/`lb-review` skills (`.fable/skills/`), the `.handoff/` skeleton with Round 1 (task 0.2) already seeded in `TO-IMPLEMENTER.md`, `PROGRESS.md` listing all §E tasks, and this document. Wilson copies the payload into the fresh clone at 0.1 step 4 per `.fable/README.md` (mapping: `skills/*` → `.claude/skills/*`, `handoff/*` → `.handoff/*`, doc stays at `.fable/`). Round 1 then starts by just running `/lb-implement` — no manual seeding session needed. The `lb-` skill names stay through Phases 0-4; the Phase 5.1 strip renames them generic.

**Model policy.** Implementer model is fixed per task line (Opus 4.8 for extraction/genericity/design-sensitive work, Sonnet 5 for mechanical ports). Reviewer is Sonnet 5 by default; use Opus 4.8 for design-parity acceptance rounds (1.1c, 1.2b) and for the review that closes each phase. No silent model substitution; a swap is a Wilson call.

**Binding references.**

| Reference | Role | Rule |
|---|---|---|
| `.fable/STRATEGIC-DIRECTION.md` (this file, in-repo from 0.2) | binding spec | every round names the sub-unit it executes |
| `${SRC_HOME}/lagunabeach-md-v1` (the renamed fork checkout) | extraction source | §C prefers the fork's copy; reviewer verifies extraction claims against this tree, byte-diff where §C says verbatim |
| `${SRC_HOME}/taiwan-md` | design reference | consult for design rationale; never a content source |
| `${SRC_HOME}/lagunabeach-md-v0/_research/taiwan-md-research.md` + `taiwan-md-llm-wiki.md` | v0 deep research | the section pointers in §B/§D are mandatory pre-reads for the executor of the citing task (2.1 boundary sourcing, Phase 5 adopter needs, 7.1/7.2 worker designs) |
| v1 archive `MIGRATION.md` | lessons only | not process; the migration apparatus is dead per §F |

An implementer loads only the references its round cites — nothing else.

**Wilson gates.** Human-gated moments: 0.1 (repo rename), 1.1c (Phase 1 design sign-off), 3.2 (domain cutover), 5.2c (dana-point proof), and EVERY phase transition: when a phase's last review passes, the reviewer writes `PHASE <n> DONE — PHASE <n+1> READY, confirm with Wilson` to `TO-IMPLEMENTER.md` and stops. No auto-advance across phases.

**Estimate legend.** Every task/sub-unit carries `Est: AI <implement>h + <review>h | Human <n>h (<what>)`. AI hours are wall-clock session time; human hours cover only real human acts (renames, DNS, sign-offs, recordings, approvals) and are omitted when zero. Calibration: S ≈ 1h + 0.25h; M ≈ 2-2.5h + 0.5h; L/XL sub-units ≈ 1.5-2.5h + 0.5h each. A sent-back round costs roughly one extra implement session; the subtotals below assume ~1 send-back per phase is absorbed in the ranges.

**Phase 0: Fresh repo + rename mechanics**
```
[0.1] Rename GitHub repo lagunabeach-md → lagunabeach-md-v1; create fresh lagunabeach-md
  Effort: S | Executor: Human (Wilson) | Depends: none
  Est: AI 0h | Human 0.5h (rename, verify Pages still serves, clone)
  Steps:
    1. GitHub Settings → rename lagunabeach-md → lagunabeach-md-v1. GitHub auto-redirects
       remotes and Pages; verify lagunabeach.md still serves afterward.
    2. Create fresh public repo lagunabeach-md, uninitialized (no README) so first push is clean.
    3. Locally: rename checkout dir to lagunabeach-md-v1, `git remote set-url` to the new name
       (redirect works, explicit is cleaner). Clone the fresh repo alongside.
    4. Copy the execution payload from ../lagunabeach-md-v1/.fable/ into the new clone per
       .fable/README.md: skills/ → .claude/skills/, handoff/ → .handoff/,
       STRATEGIC-DIRECTION.md + README.md → .fable/, diagrams/ → docs/diagrams/
       (architecture, data-flow, repo-topology; .drawio sources + .png exports).
       Commit as the repo's first commit.
  Acceptance: old repo renamed and still serving lagunabeach.md; new empty repo exists;
    local checkouts point at the right remotes; payload committed so `/lb-implement` picks
    up the pre-seeded Round 1
[0.2] Astro 6 scaffold + place.config.ts + extracted styles + loop bootstrap
  Effort: M | Executor: Opus 4.8 | Depends: 0.1
  Est: AI 2.5h + 0.5h review | Human 0.25h (start Round 1: run /lb-implement in the new clone)
  Steps:
    1. Verify the execution payload is in place (copied by Wilson at 0.1 step 4):
       .fable/STRATEGIC-DIRECTION.md, .claude/skills/lb-implement + lb-review,
       .handoff/{TO-IMPLEMENTER,TO-REVIEWER,LEDGER,PROGRESS,BACKLOG}.md,
       docs/diagrams/ (3 .drawio + 3 .png). If anything is missing, copy it from
       ../lagunabeach-md-v1/.fable/ per that README before starting.
    2. `npm create astro@latest` (minimal template, strict TS); pin `engines.node >=22.12.0`,
       Astro ^6. Deps mirror the fork's package.json minus @supabase/supabase-js:
       @astrojs/rss, @astrojs/sitemap, @tailwindcss/vite, tailwindcss ^4, gray-matter, marked,
       minisearch, remark-wiki-link, rehype-external-links, npm-run-all.
    3. Write place.config.ts per §B schema with LB values: name/tagline, domain lagunabeach.md,
       locale en, languages ["en"], the 8 categories (History, Art & Galleries, Nature & Marine
       Life, Food, Beaches, Trails, Events & Festivals, Neighborhoods) with slugs/icons/
       descriptions lifted from the fork's CATEGORY_MAP (src/utils/category-static-paths.ts);
       map center [33.5427, -117.7854], zoom 13, maxBounds around the city; features:
       graph/map/dashboard true, soundscape/feedback/chat/social false.
    4. Copy 6 CSS files verbatim from fork src/styles/: tokens.css, global.css,
       article-modules.css, dark-polish.css, dashboard.css, shot-mode.css. Skip semiont.css.
       Then neutralize the 4 upstream-credit comment lines containing "Taiwan" (verified
       2026-07-04: tokens.css:2 and :50, global.css:84, article-modules.css:29) — comment
       wording only, zero rule changes; left as-is they trip the 0.3 genericity gate.
    5. Font swap, the ONLY rule edit: tokens.css:51-54 — delete the CJK fallback families
       (Noto Serif/Sans TC, Source Han, PingFang TC), keep Georgia + Inter. Keep line 56's
       `--font-editorial` alias (still referenced). Note: the fork loads Inter via a Google
       Fonts <link> in Layout.astro:143-154 with the Noto TC families on the same URL; the
       trimmed Inter-only link (or self-hosted woff2 if preferred) lands with the real
       Layout in 1.1a — nothing to do here beyond tokens.css.
    6. Minimal Layout.astro + placeholder index.astro so the build emits a page (real layout
       lands in 1.1a).
  Acceptance: `astro build` green; tokens.css diff vs fork = the four --font-* lines + its
    two comment lines; global.css + article-modules.css diff = one comment line each;
    dark-polish/dashboard/shot-mode byte-identical to the fork; .fable/ + .handoff/ + both
    skills present so Round 2 runs through the loop
[0.3] CI: GH Actions build+deploy to Pages + check-genericity.sh gate
  Effort: S | Executor: Sonnet 5 | Depends: 0.2
  Est: AI 1h + 0.25h review | Human 0.25h (verify Pages settings on first deploy)
  Steps:
    1. .github/workflows/deploy.yml: Node 22, npm ci, build, deploy via actions/deploy-pages.
       Fork's deploy.yml is structural reference only — no i18n/translation jobs carried.
    2. scripts/ci/check-genericity.sh: case-insensitive grep over src/ and scripts/ for terms in
       scripts/ci/genericity-denylist.txt (seed: laguna, lagunabeach, taiwan, twmd). Scan
       excludes place.config.ts, knowledge/, public/media/, docs/, and the denylist itself.
    3. Wire the genericity check as a CI job that runs before build on every push.
  Acceptance: push → live github.io preview URL; a test commit containing "Laguna" in src/
    fails CI; the clean scaffold passes
```

_Phase 0 subtotal: AI 4.25h | Human 1h_

**Phase 1: Core pages (design parity is the exit gate)**
```
[1.1a] Layout shell: Layout.astro + Header/Footer/SEO + fonts  (sub-unit of 1.1)
  Effort: M | Executor: Opus 4.8 | Depends: 0.2
  Est: AI 2h + 0.5h review
  Steps:
    1. Extract from fork: Layout.astro; components Header, Footer, SEO, HeadInlineScripts,
       BrandMark, ReaderSettings (Layout imports it — verified 2026-07-04).
    2. Genericity pass: site name/tagline/domain/nav labels read from place.config.ts.
       Delete Taiwan-era props and imports (spore/diary/supporter references) at
       extraction time — no dead imports carried.
    3. Fonts: trim the fork's Google Fonts <link> (Layout.astro:143-154) to Inter-only —
       the Noto TC families ride the same URL and get dropped here (matches the 0.2
       tokens.css font swap).
  Acceptance: build green; placeholder index renders with real header/footer, styles from
    the 0.2 CSS; genericity CI green
[1.1b] Home page: home.template + hero/category components + default OG  (sub-unit of 1.1)
  Effort: M | Executor: Opus 4.8 | Depends: 1.1a
  Est: AI 2h + 0.5h review
  Steps:
    1. Extract components Banner, PageHero, FeatureCards, HeroStats, CategoryGrid, the
       home/ subdirectory; templates/home.template.astro. Genericity pass as in 1.1a
       (category entries + hero-stat sources from place.config.ts).
    2. Static default OG image public/og-default.png (1200×630, brand tokens); SEO.astro
       points at it (per §F: no build-time OG generation ever).
    3. pages/index.astro = thin wrapper on home.template.
  Acceptance: home renders fully config-driven and visually faithful to the v1 fork's home
    on manual inspection (the formal parity gate is 1.1c)
[1.1c] Design-parity instrument + Phase 1 sign-off package  (sub-unit of 1.1)
  Effort: S | Executor: Opus 4.8 | Depends: 1.1b
  Est: AI 1.5h + 0.5h review (Opus review — design parity) | Human 1h (Wilson sign-off)
  Steps:
    1. Port scripts/visual/capture-baseline.mjs + diff.mjs (§F schedules them Phase 0-1);
       capture the v1 fork's home as the comparison baseline.
    2. Produce the side-by-side package: new home vs taiwan.md home vs v1 fork home.
  Acceptance: side-by-side screenshots meet the same visual bar; Wilson sign-off gates
    Phase 1 exit (per §G risk 1: parity failure → copy that page's fork implementation
    wholesale and re-genericize, never re-prompt from description)
[1.2a] Content pipeline: sync.sh + collection schema + wiki-links + fixtures  (sub-unit of 1.2)
  Effort: M | Executor: Opus 4.8 | Depends: 1.1a
  Est: AI 2h + 0.5h review
  Steps:
    1. Port scripts/core/sync.sh as-is; the enabled-language list derives from place.config.ts
       (replacing the fork's src/config/languages.mjs as SSOT for langs).
    2. Content-collection schema (src/content.config.ts) matching real article frontmatter:
       title, description, date, category, tags, subcategory, author, featured, lastVerified,
       lastHumanReview, geo (optional string), source (list).
    3. Wiki-links: same remark-wiki-link wiring as the fork's astro.config; [[Title]] resolves
       to a hyperlink at build time.
    4. Copy 2-3 real fork articles into knowledge/ as fixtures (full corpus lands 3.1).
  Acceptance: sync projects the fixtures into src/content/; build green with the collection
    loaded; schema accepts all fixtures unmodified
[1.2b] Article page: article.template + Hero/Sidebar/TOC + article route  (sub-unit of 1.2)
  Effort: M | Executor: Opus 4.8 | Depends: 1.2a
  Est: AI 2h + 0.5h review (Opus review — design parity)
  Steps:
    1. Extract templates/article.template.astro; components ArticleHero, ArticleSidebar,
       TableOfContents. Genericity pass as in 1.1a.
    2. Dynamic route pages/[category]/[slug].astro; static paths derive from
       place.config.categories.
  Acceptance: fixture article renders pixel-comparable to the v1 fork's version; [[links]]
    hyperlink correctly
[1.2c] Category hub: category-hub.template + ArticleCard/TopicCard + hub route  (sub-unit of 1.2)
  Effort: M | Executor: Opus 4.8 | Depends: 1.2b
  Est: AI 1.5h + 0.5h review
  Steps:
    1. Extract templates/category-hub.template.astro; components ArticleCard, TopicCard.
       Genericity pass.
    2. Dynamic route pages/[category]/index.astro from place.config.categories
       (CATEGORY_MAP dies here).
  Acceptance: category hub lists the fixtures; the category set comes only from
    place.config.ts
[1.3] Explore/search + latest + 404 + rss + /kb + llms.txt + prebuild chain assembly
  Effort: M | Executor: Sonnet 5 | Depends: 1.2a, 1.2c
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Port build-search-index.mjs; CJK bigram tokenizer stays as a code path gated on
       place.config.languages (Latin default = plain word tokenization).
    2. Extract explore.template.astro + MiniSearch client wiring. Extract TopicsMasonry.astro
       only if the explore/home bodies import it — check imports, don't assume.
    3. Port build-latest.mjs + latest page; 404 page; feed.xml/rss.xml via @astrojs/rss.
    4. Port generate-api.js as build-kb-index.mjs emitting /kb/topics.json,
       /kb/articles/{slug}.md, /kb/search-index.json (§B naming); port refresh-llms-txt.py
       emitting /llms.txt.
    5. Assemble the package.json prebuild chain (target ~9 jobs): sync → parallel (kb-index,
       search, content-dates, git-info, latest, related) → astro build → postbuild smoke +
       internal-link check. Ports of build-git-info.mjs, build-content-dates.mjs,
       build-related-tagoverlap.mjs (feeds ArticleSidebar related list), post-build-check.mjs
       land here; map-markers joins in 2.1, dashboard-lite in 4.2.
  Acceptance: search returns correct results for all articles present; llms.txt and
    /kb/topics.json list them; full build < 60s
[1.4] Secondary pages: about + contribute + changelog  (NEW — skeleton gap; §D lists all three as v1 pages)
  Effort: M | Executor: Sonnet 5 | Depends: 1.1a, 1.1b
  Est: AI 2h + 0.5h review
  Steps:
    1. Extract about.template.astro + contribute.template.astro; genericity pass (prose comes
       from knowledge/About/ content and place.config, not literals).
    2. Extract changelog.template.astro + the timeline/ component subdirectory; port
       generate-changelog-data.js (git-history reader; omitted from §C's list — corrected here)
       into the prebuild chain.
  Acceptance: all three pages render at the Phase-1 visual bar; changelog shows real commits
    from the new repo
```

_Phase 1 subtotal: AI 19.5h | Human 1h_

**Phase 2: Visual features**
```
[2.1] Leaflet map page + marker GeoJSON + municipal boundary overlay
  Effort: M | Executor: Opus 4.8 | Depends: 1.1a, 1.2a
  Est: AI 2.5h + 0.5h review | Human 0.25h (mobile check on a real device)
  Steps:
    1. Rewrite generate-map-markers.js to parse `geo: Name,lat,lng,Area` frontmatter (the
       fork's actual schema, on 14/16 LB articles) and emit a GeoJSON FeatureCollection to
       src/data/map-markers.geojson with properties {slug, title, category, description, area}.
       Drop the fork's jitter logic unless marker collisions actually occur at LB density.
    2. Map page: extract map.template.astro for page chrome only; body is new — Leaflet from
       CDN, page-scoped script, center/zoom/maxBounds from place.config.map, OSM tiles with
       attribution, markers colored by category (token colors), popup = title + one-liner +
       article link.
    3. Boundary: source per §D.1 (Overpass relation query, OC GIS portal, or TIGER/Line);
       simplify with Mapshaper to ≤100 KB; commit as public/data/boundary.geojson (place data
       outside src/, so the genericity gate is unaffected); render as a subtle stroke overlay.
    4. Audit the 2 geo-less articles; add `geo:` only if place-anchored (conceptual articles
       legitimately have none).
  Acceptance: every geo-carrying article renders as a popup linking to its article; city
    boundary visible; pinch-zoom and popup tap work on mobile; no coordinates hardcoded in
    src/ outside place.config
[2.2] Knowledge graph (port graph.astro, categories as hubs)
  Effort: M | Executor: Sonnet 5 | Depends: 1.2a
  Est: AI 1.5h + 0.5h review
  Steps:
    1. Port pages/graph.astro whole — the inline wikilink-regex graph builder (~lines 223-250)
       comes with it; D3 stays CDN-loaded and page-scoped.
    2. Parameterize the hub-node list from place.config.categories.
  Acceptance: D3 graph shows all article nodes (16 after 3.1) + wikilink edges; clicking a
    node navigates to the article
```

_Phase 2 subtotal: AI 5h | Human 0.25h_

**Phase 3: Content migration + cutover**
```
[3.1] Move knowledge/ (16 articles + 3 About + INBOX) + sync + full build verify
  Effort: S | Executor: Sonnet 5 | Depends: 1.3, 1.4
  Est: AI 1h + 0.25h review
  Steps:
    1. Copy knowledge/ wholesale from the fork: 16 articles across the 8 category dirs,
       About/ (3 files), INBOX.md. Delete the 1.2a fixtures. No zh-TW content exists to
       migrate (corrected §B); any translations produced before this task ride along
       unsynced under the same rule.
    2. Record the fork's article-health baseline (run it fork-side if 4.1 hasn't landed yet).
    3. sync + full build; postbuild smoke + internal-link check green.
  Acceptance: article-health scores match the fork baseline; zero broken internal links;
    all 16 articles reachable via category hubs, search, graph, and map
[3.2] Domain cutover lagunabeach.md → new repo; v1 repo archived after 14 stable days
  Effort: S | Executor: Human (Wilson) | Depends: 3.1, 2.1, 2.2
  Est: AI 0h | Human 1h (CNAME/DNS/HTTPS + archive step; plus the 14-day calendar wait)
  Steps:
    1. Add CNAME to the new repo, set the Pages custom domain, verify HTTPS re-provisions.
    2. Retire the old repo's Pages site (or leave it preview-only, unlinked).
    3. After 14 stable days: archive lagunabeach-md-v1 (read-only).
  Acceptance: domain serves the new site; old preview URL 301s or is retired
```

_Phase 3 subtotal: AI 1.25h | Human 1h_

**Phase 4: Quality tooling**
```
[4.1] Port article-health.py + test-frontmatter + pre-commit + CI wiring
  Effort: M | Executor: Sonnet 5 | Depends: 3.1
  Est: AI 2h + 0.5h review
  Steps:
    1. Port article-health.py + article-health.config.toml (fork copy is the base);
       CJK-specific checks move behind a language profile so Latin corpora skip them;
       wire `npm run article-health`.
    2. Port test-frontmatter.mjs (`npm run test` / `test:ci`).
    3. Pre-commit via husky: port the substance of the fork's .husky/pre-commit — credential
       scan + frontmatter validation. Drop Taiwan-era hook steps (spore/i18n checks).
    4. CI: add test:ci + article-health as gates in deploy.yml alongside check-genericity.
  Acceptance: `npm run article-health` matches fork scores; pre-commit blocks a bad
    frontmatter file and a planted fake credential
[4.2] Dashboard-lite page + visual-regression baselines
  Effort: M | Executor: Sonnet 5 | Depends: 4.1
  Est: AI 2h + 0.5h review
  Steps:
    1. Extract dashboard.template.astro (dashboard.css landed in 0.2). New
       build-dashboard-lite.mjs producing one JSON: article-health rollup + immune score.
       Salvage logic from generate-dashboard-data.js / generate-dashboard-immune.py; drop the
       GA4/Search-Console/Cloudflare/spore/i18n panels (port-on-trigger per §F).
    2. Capture visual-regression baselines for every v1 page (home, article, category hub,
       explore, latest, graph, map, dashboard, about, contribute, changelog).
  Acceptance: dashboard renders the health JSON; `npm run visual:check` passes on a clean tree
```

_Phase 4 subtotal: AI 5h | Human 0h_

**Phase 5: Framework cut (sekai-kb v1, all six adopter needs; blocks Phases 6-7)**
```
[5.1] Cut sekai-kb template repo: strip LB content, demo place seeded, genericity CI green
  Effort: M | Executor: Opus 4.8 | Depends: 4.2
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Create sekai-kb from the lagunabeach-md tree at the 4.2-green commit, with FRESH git
       history (single init commit; a template repo should not carry LB commit noise).
    2. Strip LB: knowledge/ → small fictional demo place (3-5 short articles; fictional so
       the template never owes real-place accuracy upkeep); public/media/ → neutral assets;
       place.config.ts → demo values; CNAME removed.
    3. Extend the genericity denylist to include laguna terms repo-wide (not just src/ —
       in the template they must be absent everywhere). Enable "Template repository" on GitHub.
  Acceptance: template builds + deploys with demo content; zero "Laguna" strings anywhere
[5.2a] npm run init wizard  (sub-unit of 5.2)
  Effort: M | Executor: Opus 4.8 | Depends: 5.1
  Est: AI 2h + 0.5h review
  Steps:
    1. scripts/init/ interactive Node wizard behind `npm run init`, ~8 prompts: place name,
       tagline, domain, default language, categories (preset menu + custom), map center/zoom,
       feature toggles. Writes place.config.ts; seeds knowledge/{Category}/ dirs + INBOX.md;
       writes CNAME + the CLAUDE.md header block + FRAMEWORK-VERSION (per §B).
    2. Non-interactive mode: `npm run init -- --answers <json>` accepts the same fields as a
       JSON payload and writes identical output — this is the /adopt skill's entry point, and
       the wizard stays the single writer of place.config.ts (no config drift between the AI
       and non-AI paths).
  Acceptance: wizard run on a scratch clone yields a building site with the chosen config;
    the same answers via --answers produce a byte-identical place.config.ts
[5.2b] /seed-articles + /adopt skills  (sub-unit of 5.2)
  Effort: M | Executor: Opus 4.8 | Depends: 5.2a
  Est: AI 2h + 0.5h review
  Steps:
    1. /seed-articles skill: AI drafts 5 starter articles about the adopter's place — grounded
       in adopter-supplied source material (files/URLs collected by /adopt) when provided, AI
       research otherwise — runs article-health on them, human-approval gate before commit.
    2. /adopt skill (the PRIMARY adopter path per §D.7): interviews the adopter (place name,
       tagline, domain, map center via geocode suggestion, language, categories, existing
       material about their place), calls `npm run init -- --answers` with the collected
       answers, then walks the rest (seed → deploy), referencing the runbook.
  Acceptance: both skills execute end-to-end on a scratch clone; /adopt with supplied source
    material yields seed drafts that cite it
[5.2c] End-to-end proof: dana-point demo, timed  (sub-unit of 5.2)
  Effort: S | Executor: Opus 4.8 | Depends: 5.2b, 5.3
  Est: AI 1.5h + 0.5h review | Human 1h (Wilson runs the flow as an adopter, approves seed articles)
  Steps:
    1. Stand up the dana-point demo from a fresh clone and time it, going through /adopt
       (the primary path) — not the bare wizard — so the interview → init → seed → deploy
       chain is what gets proven.
  Acceptance: fresh clone → /adopt interview → 5 AI-seeded articles → deployed on GH Pages
    in <1 hour, executed for real on dana-point
[5.3] Playbook + runbook + framework CLAUDE.md (AI onboarding)
  Effort: M | Executor: Opus 4.8 | Depends: 5.1
  Est: AI 2.5h + 0.5h review | Human 0.5h (runbook read-through as first-timer proxy)
  Steps:
    1. docs/playbook/: ARTICLE-PLAYBOOK.md seeded from the fork's EDITORIAL.md +
       QUALITY-CHECKLIST.md, rewritten place-generic.
    2. docs/runbook/DEPLOY.md: GH Pages, Cloudflare DNS, custom domain, CI, pre-commit —
       exact commands, written for a first-timer.
    3. Framework CLAUDE.md <150 lines: what this is, the SSOT rule, where config lives,
       links to playbook/runbook, semiont/config.json probe (no-op if absent).
  Acceptance: a Claude session in a fresh instance answers "how do I write my first article"
    correctly from docs alone
[5.4] Re-base lagunabeach-md onto sekai-kb + release discipline (tags, CHANGELOG, /upgrade)
  Effort: M | Executor: Sonnet 5 | Depends: 5.2c
  Est: AI 2h + 0.5h review
  Steps:
    1. Release discipline in sekai-kb: tag `sekai-kb-v1.0.0` (semver); add CHANGELOG.md with
       the rule that every framework change lands with an entry and breaking config changes
       carry an upgrade note. Instances merge tags only, never framework main (per §B).
    2. In lagunabeach-md: `git remote add framework <sekai-kb>`; establish the merge base
       (graft or subtree-merge; document the chosen mechanics in the runbook).
    3. .gitattributes merge=ours on instance-owned files: place.config.ts, knowledge/**,
       public/media/**, CNAME, CLAUDE.md. FRAMEWORK-VERSION file recorded (v1.0.0).
    4. /upgrade skill: `git fetch framework` → merge the requested tag → build-verify →
       report conflicts alongside the tag's CHANGELOG entry → bump FRAMEWORK-VERSION.
       Runbook documents the same flow as manual commands for non-AI users.
    5. Prove the flow: land a trivial commit in sekai-kb, tag v1.0.1, run /upgrade in LB.
  Acceptance: /upgrade merges a framework release into LB with zero conflicts on
    content/config, build green, FRAMEWORK-VERSION bumped
[5.5] SystemDiagram.astro — organism-style architecture diagram, config-driven
  Effort: M | Executor: Opus 4.8 | Depends: 5.3
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Build SystemDiagram.astro in sekai-kb: animated SVG architecture diagram of the
       framework (pipes/particles/legend), design-based on the v1 archive's
       src/components/semiont/SemiontOrganismDiagram.astro (design reference only — that
       component is Taiwan-inherited: i18n useTranslations, CJK fonts, hardcoded LB
       boundary path; none of that carries).
    2. Generic by construction: node labels + categories from place.config.ts; center
       shape rendered from public/data/boundary.geojson (fallback: brand circle when no
       boundary file); en-only, no i18n dependency; loops shown = the target architecture,
       with features currently off in place.config.features rendered dimmed.
    3. Wire into the about page (or a /system page — executor's call at build time,
       documented in the round report). The drawio sources in docs/diagrams/ stay the
       engineering SSOT; this component is the reader-facing rendering.
  Acceptance: diagram renders from config alone on both the demo place and LB; toggling
    a feature flag dims/undims its loop; genericity CI green
```

_Phase 5 subtotal: AI 18.5h | Human 1.5h_

**Phase 6: Social + engagement**
```
[6.1a] Feedback backend: workers/feedback (CF Worker + D1)  (sub-unit of 6.1)
  Effort: M | Executor: Opus 4.8 | Depends: 5.4
  Est: AI 2h + 0.5h review | Human 0.5h (Cloudflare account, wrangler auth, secrets)
  Steps:
    1. workers/feedback/: Worker + D1; schema feedback(id, created_at, page, category, message,
       contact, user_agent, status). POST endpoint with honeypot field + per-IP rate limit +
       CORS locked to the site origin. wrangler.toml checked in; deploy steps in the runbook.
  Acceptance: a curl POST against the deployed worker lands a row in D1; honeypot and
    rate-limit paths verified
[6.1b] Feedback frontend: widget + triage skill  (sub-unit of 6.1)
  Effort: M | Executor: Opus 4.8 | Depends: 6.1a
  Est: AI 2h + 0.5h review
  Steps:
    1. FeedbackWidget.astro (new, ~100 lines) on article pages behind features.feedback.
       Zero code reuse from the fork's Supabase widget (per §F).
    2. Triage skill: reads D1 (`wrangler d1 execute`), dedupes/classifies, files GitHub issues
       linking the article.
  Acceptance: a submission on the live site lands in D1; triage produces a GitHub issue
[6.2] Snippet pipeline (skill + inbox + adapter interface)
  Effort: M | Executor: Sonnet 5 | Depends: 5.4
  Est: AI 2h + 0.5h review
  Steps:
    1. /snippet skill: pick article → generate short-form draft → append to
       knowledge/SNIPPET-INBOX.md with status pending. Human flips pending → approved.
    2. Define the platform-adapter interface; write NO adapter until an LB account exists
       (then one adapter per platform, added on account creation).
  Acceptance: /snippet <article> yields an approved-queue entry; publish posts once an
    account is wired
[6.3] Soundscape page + first 3 recordings
  Effort: M | Executor: Sonnet 5 + Human (recordings) | Depends: 5.4
  Est: AI 1.5h + 0.5h review | Human 2h (record + convert 3 recordings)
  Steps:
    1. Page built new with upstream's soundscape.template as design reference (per §F);
       behind features.soundscape.
    2. knowledge/sounds/ manifest per recording: title, location, credit, file. Native HTML5
       audio, no player library.
    3. Wilson supplies the first 3 recordings.
  Acceptance: audio plays on mobile Safari; page passes the visual bar
```

_Phase 6 subtotal: AI 9.5h | Human 2.5h_

**Phase 7: Differentiators**
```
[7.1] On-demand OG worker (Satori + resvg-wasm)
  Effort: M | Executor: Sonnet 5 | Depends: 5.4
  Est: AI 2.5h + 0.5h review
  Steps:
    1. workers/og/: GET /og/{slug}.png; card template renders title + category color + site
       brand from /kb/topics.json data; Satori → resvg-wasm → PNG; long-lived cache headers,
       cached at the Cloudflare edge.
    2. SEO.astro switches og:image to the worker URL behind a feature flag, static
       og-default.png remains the fallback.
  Acceptance: og:image URLs render per-article cards; <200ms when cached
[7.2a] Corpus embeddings: build-embeddings.mjs + static vectors  (sub-unit of 7.2; read taiwan-md-research.md §"RAG Chatbot" FIRST)
  Effort: M | Executor: Opus 4.8 | Depends: 7.1
  Est: AI 2h + 0.5h review | Human 0.5h (4090 embedding run, if local path chosen)
  Steps:
    1. Port build-embeddings.mjs from the v1 archive: chunk articles 300-500 tokens split on
       ## headings; embed with bge-m3 (1024-dim) on the 4090 (or Workers AI — same model
       either way, per §B the model space must match the query path); emit static vectors
       JSON into workers/chat/.
  Acceptance: vectors JSON covers every article; chunk metadata carries {title, url,
    category, heading}
[7.2b] Chat worker: query embed + cosine retrieval + Claude API  (sub-unit of 7.2)
  Effort: M | Executor: Opus 4.8 | Depends: 7.2a
  Est: AI 2.5h + 0.5h review | Human 0.25h (Claude API key + Workers AI binding)
  Steps:
    1. workers/chat/: embed the query via Workers AI @cf/baai/bge-m3; in-worker cosine over
       the vectors file cached in global scope; top-k chunks → Claude API with
       citation-required prompting; stream the response.
  Acceptance: deployed worker answers a test query from article content, streamed, with
    citations
[7.2c] /chat page + eval set  (sub-unit of 7.2)
  Effort: M | Executor: Opus 4.8 | Depends: 7.2b
  Est: AI 2h + 0.5h review | Human 1h (review eval answers)
  Steps:
    1. /chat page: vanilla JS, minimal UI, answers cite article links.
    2. Eval: 10-question set checked into workers/chat/eval/, run against the live worker.
  Acceptance: eval set answered from articles with citations; no hallucinated places
[7.3] QR flow: location-context deep links + printable codes
  Effort: S | Executor: Sonnet 5 | Depends: 7.2c
  Est: AI 1h + 0.25h review
  Steps:
    1. ctx-param map: location slug → location-aware greeting + retrieval context hint.
    2. Printable QR sheet (script or page) generating codes for the physical locations.
  Acceptance: scan → /chat?ctx=main-beach opens with a location-aware greeting
```

_Phase 7 subtotal: AI 12.25h | Human 1.75h_

**Phase 8: Semiont plugin layer**
```
[8.1] Organ architecture in sekai-kb: semiont/config.json + loader + core organs
  Effort: M | Executor: Opus 4.8 | Depends: 5.4
  Est: AI 2.5h + 0.5h review
  Steps:
    1. semiont/config.json manifest + organs/{memory,reflexes,manifesto,diary,routine,
       introspection}/ scaffolds in sekai-kb. The site build never imports from semiont/ —
       add a CI check that deletes the dir and builds green.
    2. CLAUDE.md boot section reads config.json and loads only enabled organs. Core organs:
       memory (session-handoff MEMORY.md) + reflexes (accumulated don't-do REFLEXES.md),
       each one markdown file + one boot paragraph; total boot read <150 lines.
    3. Enforce §A3's constraints: no organ reads another organ's files; skills probe for
       organ existence and no-op gracefully when absent.
  Acceptance: site builds with semiont/ deleted; disabling an organ removes its boot cost
[8.2] LB enables core + MANIFESTO; DIARY/ROUTINE stay off
  Effort: S | Executor: Sonnet 5 | Depends: 8.1
  Est: AI 1h + 0.25h review
  Steps:
    1. Enable memory + reflexes + manifesto in LB's semiont/config.json.
    2. Salvage MANIFESTO prose by hand from the v1 archive's docs/semiont/MANIFESTO.md
       (prose is work product; the organ shell is new).
  Acceptance: lb-become boots in <150 lines read; organs toggle via config only
```

_Phase 8 subtotal: AI 4.25h | Human 0h_

**Grand total: AI ≈ 79h (implement + review) | Human ≈ 9h.** (Revised 2026-07-05: 5.4 grew to M for release discipline, 5.5 added.) Phases 0-4 (through domain cutover + quality tooling): AI 35h, Human 3.25h. Calendar expectation at 2-4 rounds/day: Phases 0-4 ≈ 1.5-2 weeks; full plan ≈ 4-6 weeks elapsed (the 3.2 archive step alone adds a 14-day stability wait that overlaps Phases 4-5 work).

---

## F. Disposition of the Inherited Fork (per subsystem, no "dormant")

The fork becomes the read-only `lagunabeach-md-v1` archive at Phase 3.2. "Delete-now" below means: not extracted, no successor planned, dies with the archive. Every deferred item carries a named trigger.

| Subsystem | Disposition | Detail |
|---|---|---|
| Design CSS (7 files, `src/styles/`) | **rewrite-for-LB-now** | Extracted verbatim Phase 0.2, fonts swapped. |
| Component library (33 upstream components) | **split** | 16+ named in §C extracted now. `EventTracker`, `ProticoScript`, `SporeFootprint`, `SupporterGrid/Timeline`, `DiaryTeaser`, `RelatedDiaries`, `LifeTree`, `Perspectives`, `TextToSpeech`, `ReadingPath`, `semiont/`, `commits/`: **delete-now** (Taiwan-wired backends or Taiwan-specific concepts). |
| Template bodies (`src/templates/`) | **rewrite-for-LB-now** | 10 named in §C. `bench`, `companies`, `elections-2026`, `taiwan-shape`, `opendata`, `assets`, `data`, `mcp`, semiont-* templates: **delete-now** (§4 explicit don't-needs). `soundscape.template`: design reference for Phase 6.3 rebuild. |
| Locale wrapper dirs (`src/pages/{en,es,fr,ja,ko}`) | **delete-now** | Multi-lang path is redesigned (3-line wrappers, kept as pattern). Trigger to add a language: Wilson decides to launch one; cost is one wrapper dir + config entry by design. |
| `knowledge/zh-TW/` LB translations | **void** | Correction 2026-07-04: this directory does not exist in the fork (zero files verified). Nothing to carry. If translations are produced before Phase 3.1, they ride along under the same rule (stay in `knowledge/`, unsynced until the language is enabled). |
| Harvest orchestrator (89 files, repo-root `harvest/`) | **delete-now** | Capability (feedback + social) rebuilt new in Phase 6 on CF Worker + D1 and the snippet pipeline. Zero harvest code survives; Supabase dependency ends. |
| `twmd-*` skills (28) | **delete-now** | Taiwan's business logic; canonical pipelines remain readable in the upstream repo forever. Nothing to port: LB equivalents exist or are rebuilt (snippets ≠ spores). |
| `lb-*` skills (19) | **split** | Port now: lb-write, lb-validate, lb-factcheck, lb-sync, lb-search, lb-become, lb-translate, lb-refresh, lb-news-lens, lb-peer, lb-media-audit, lb (router). lb-implement + lb-review: already refined per §E.0 and staged at `.fable/skills/` (2026-07-04, Fable 5) — the v1 `.claude/skills/` copies lost rounds to rule drift and are NOT the port source; copy from `.fable/` at 0.1 step 4. lb-embeddings: port at Phase 7.2a. lb-migration-* (3): **delete-now**, obsolete once upstream merging ends. |
| `SemiontOrganismDiagram.astro` (organism diagram v2) | **design reference for 5.5** | Not extracted (i18n-wired, CJK fonts, hardcoded boundary path). SystemDiagram.astro (5.5) rebuilds it config-driven; the LB boundary shape returns via `public/data/boundary.geojson` from 2.1. |
| Semiont organ docs (25 emptied shells) | **delete-now** | Phase 8 builds the plugin layer fresh. MANIFESTO and REFLEXES prose salvaged by hand in 8.2. Introspection organs become opt-in plugins, not carried shells. |
| `heartbeat` skill + 4.5-beat rhythm | **delete-now** | Successor is the ROUTINE organ (opt-in, Phase 8); trigger to activate: first real cron routine LB needs. |
| Data-viz pages (data, companies, elections, taiwan-shape, opendata) + `bench` | **delete-now** | §4 explicit don't-needs, including sovereignty benchmark. No trigger; a future LB data page would be designed fresh against LB data. |
| Build-time OG (`generate-og-images.mjs` + Playwright) | **delete-now** | Static default OG image ships Phase 1.1b; per-article OG returns as the Phase 7.1 worker. |
| Dashboard suite (immune/alerts/GA4/Search-Console/Cloudflare fetchers) | **split** | Dashboard-lite (health + immune score) rebuilt Phase 4.2. Analytics fetchers **port-on-trigger**: GA4/Search Console/Cloudflare accounts exist for lagunabeach.md. |
| Embeddings + RAG (`build-embeddings.mjs`, `rag-query.mjs`) | **port-on-named-trigger** | Trigger is Phase 7.2a itself (scheduled, not vague). Until then related-articles = tag-overlap (ported now). |
| Feedback widget (`FeedbackWidget.astro`, `scripts/feedback/`) | **delete-now** | Rebuilt new Phase 6.1a/6.1b; Supabase-shaped code not worth adapting to D1. |
| Visual regression (`scripts/visual/`) | **rewrite-for-LB-now** | Ported Phase 0-1; it is the design-parity instrument for the rebuild itself. |
| i18n toolchain (lang-sync, sync-translations, babel cascade, i18n-coverage) | **delete-now** | Censorship-cascade rationale doesn't transfer. Multi-lang trigger uses lb-translate + wrappers. |
| Cron/ROUTINE system (16 upstream routines) | **delete-now** as implementation | Concept returns as per-routine opt-ins via the ROUTINE organ + `schedule` skill, Phase 8; trigger per routine: a named recurring need (e.g. weekly news-lens run). |
| CJK bigram tokenizer | **rewrite-for-LB-now** | Kept behind language flag in the ported search script; framework needs it for CJK adopters. |
| `fork-graph` page | **delete-now** | Trigger to rebuild in sekai-kb: 3+ live instances exist (a speciation graph with 1 node is noise). |
| `graph.astro` knowledge graph | **rewrite-for-LB-now** | Phase 2.2. |
| MCP page/endpoint | **port-on-named-trigger** | Trigger: Phase 7.2c ships; expose the RAG corpus via MCP alongside the chat worker. |
| Pre-commit hooks, `test-frontmatter.mjs`, internal-link verify | **rewrite-for-LB-now** | Phase 4.1. |
| MIGRATION.md + ledger + `.handoff/` history | **delete-now** (stays in archive) | The 13 rules' *lessons* inform sekai-kb docs; the migration apparatus itself is obsolete by design of this plan. Two-session loop skills port (see lb-* row). |
| `scripts/deprecated/`, `scripts/bench/`, contributors/supporters/spore prebuild jobs | **delete-now** | Supporters/spores are Taiwan's; contributors script **port-on-trigger**: second human contributor lands a merged PR. |

---

## G. Risk Assessment

1. **Design-parity failure repeats (the v0 ghost).** Highest-consequence risk. Mitigation: the design is copied as files, not described; Phase 1 tasks carry explicit side-by-side screenshot acceptance against taiwan.md and the v1 fork, with Wilson sign-off gating Phase 1 exit; the ported visual-regression scripts capture baselines from day one. If parity fails on any page, the fallback is copying that page's fork implementation wholesale and re-genericizing, never re-prompting from description.
2. **Genericity erodes and the framework cut becomes painful (the trap that motivated everything).** Mitigation: `check-genericity.sh` in CI from Phase 0.3, denylist seeded from place names; `place.config.ts` is the single ingress; Phase 5.2c's acceptance requires standing up a real second place end-to-end, which empirically proves the cut instead of asserting it.
3. **Phase 5 slips because LB features are more fun (the deferral trap).** Mitigation is structural: Phases 6 and 7 declare `Depends: 5.4`, so the executor cannot legally start the RAG chatbot or social pipeline before the framework ships. Any proposal to reorder is a scope change requiring Wilson's explicit call.
4. **Two-repo drift after the cut.** Mitigation: template contains zero place content by CI-enforced construction; instance-owned files carry `merge=ours`; instances merge immutable release tags, never framework main, so an upgrade is reproducible on every instance at the same version; 5.4's acceptance is a demonstrated clean tag merge via /upgrade. The ownership rule (§B) closes the remaining hole: instances do not locally edit `src/` or `scripts/` — framework changes land in sekai-kb first, LB pulls; the reverse flow (LB invents, upstreams to sekai-kb) is allowed but must land in sekai-kb within the same work item, enforced by the lb-review loop checklist.
5. **Losing future Taiwan.md improvements.** Accepted cost, priced consciously: upstream stays readable at `${SRC_HOME}/taiwan-md` and on GitHub; adoption becomes deliberate cherry-pick of *ideas* (re-implemented generic) rather than merges. Trigger to look: upstream tagged releases, skimmed quarterly; nothing automatic.
6. **Framework over-engineering for hypothetical adopters.** Mitigation rule: a framework feature exists only if LB uses it OR it is one of the six named adopter needs. Anything else waits for the second real adopter to ask.

---

## Final note to executors

Read this once, then execute Phases 0-4 without further strategic consultation. §E.0 defines how: one session-sized sub-unit per round, through the implement/review loop, rules restated in each queued task. The Wilson-gated moments are 0.1/3.2 (repo rename, domain cutover), 1.1c (Phase 1 design sign-off), 5.2c (dana-point proof), and every phase transition. Every other decision in this document is made. Do not re-open fork-vs-rewrite, do not restore anything marked delete-now, and do not start Phase 6+ before 5.4 is green.
