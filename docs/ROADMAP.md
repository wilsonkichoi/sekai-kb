# ROADMAP: LagunaBeach.md / Sekai KB

**Derived 2026-07-07 from `.fable/STRATEGIC-DIRECTION.md` §E.** Milestones = Linear
project milestones on "LB Rebuild", one per phase. Task packets are converted from §E's
blocks by `/dev:plan`, never re-derived; §E's Steps/Acceptance text governs packet detail.
Every phase transition is a Wilson gate — `/dev:plan` for phase n+1 runs only after Wilson
confirms phase n closed. Estimates carried from §E (`AI implement+review | Human`).

**Status (2026-07-11):** Phases 0-4 are complete and Wilson-confirmed. Phase 5 is next
to plan; its packets convert from §E 5.1-5.5 plus the "Phase 5 amendment" appendix below
(task 5.6 + packet-shaping notes recorded at Phase-4 close).

**Extension (Wilson-approved 2026-07-07):** milestones 9-11 extend beyond the frozen §E
(MCP delivery, analytics perception, autonomous routines — see ADR 005). Their task blocks
live in this file's "Extension task blocks" appendix, in §E's format; `/dev:plan` converts
packets from those blocks exactly as it does from §E. STRATEGIC-DIRECTION.md is unchanged
(frozen source of record); this is an intentional, tracked extension, not a conflict.

| # | Milestone | Outcome | Scope (§E tasks) | Exit gate | Est |
|---|---|---|---|---|---|
| 0 | Fresh repo + CI | New repo scaffolded (Astro 6, place.config.ts, extracted styles), deployed preview, genericity gate live | 0.1 ✅ (done 2026-07-07, by hand) · 0.2 · 0.3 | CI genericity gate proven (a planted "Laguna" in src/ fails CI); Wilson phase confirm | AI 4.25h \| Human 1h |
| 1 | Core pages at design parity | Layout, home, article, category hub, explore/search, latest, about/contribute/changelog, `/kb/` + llms.txt, prebuild chain | 1.1a-c · 1.2a-c · 1.3 · 1.4 | **Wilson design sign-off on 1.1c side-by-side package** (§G risk 1); phase confirm | AI 19.5h \| Human 1h |
| 2 | Visual features | Leaflet map with boundary overlay; D3 knowledge graph | 2.1 · 2.2 | Mobile map check on real device (2.1); Wilson phase confirm | AI 5h \| Human 0.25h |
| 3 | Content migration + cutover | Full corpus (16 articles + About + INBOX) on the new site; lagunabeach.md serves it | 3.1 · 3.2 | **Wilson domain cutover (3.2)**; v1 archived after 14 stable days; phase confirm | AI 1.25h \| Human 1h |
| 4 | Quality tooling | article-health, frontmatter tests, pre-commit, dashboard-lite, visual-regression baselines; `test_command` updated in `.claude/dev.md` (4.1) | 4.1 · 4.2 | Health scores match fork baseline; `npm run visual:check` clean; Wilson phase confirm | AI 5h \| Human 0h |
| 5 | Framework cut (sekai-kb v1) — **blocks 6-7** | Template repo with demo place, init wizard, `/adopt` + `/seed-articles` + `/upgrade`, generic content skills (`/write` `/validate` `/factcheck` + router), playbook/runbook, release discipline, LB re-based on tags, SystemDiagram | 5.1 · 5.2a-c · 5.3 · 5.4 · 5.5 · 5.6 (amendment, appendix below) | **Wilson dana-point proof (5.2c: fresh clone → deployed < 1h)**; clean tag-merge via /upgrade (5.4); phase confirm | AI 21h \| Human 1.5h |
| 6 | Social + engagement | Feedback (Worker + D1 + widget + triage), snippet pipeline, soundscape | 6.1a-b · 6.2 · 6.3 | Live submission → D1 → GitHub issue; Wilson recordings (6.3); phase confirm | AI 9.5h \| Human 2.5h |
| 7 | Differentiators | On-demand OG worker, RAG chat (bge-m3 + Workers AI + Claude API), QR flow | 7.1 · 7.2a-c · 7.3 | Eval set answered with citations, no hallucinated places (7.2c); phase confirm | AI 12.25h \| Human 1.75h |
| 8 | Semiont plugin layer | Organ architecture in sekai-kb (config.json manifest, core organs); LB enables core + MANIFESTO | 8.1 · 8.2 | Site builds with `semiont/` deleted; organs toggle via config only; phase confirm | AI 4.25h \| Human 0h |
| 9 | MCP + AI delivery | Remote MCP server (`workers/mcp/`) exposing list_topics/get_article/search/semantic_search; AI-access page + `/kb/agent.md` boot file; adopter upgrade playbook proven on the first real post-cut feature release | 9.1 · 9.2 · 9.3 | MCP client connected to `lagunabeach.md/mcp` answers an LB question via tools, no clone; phase shipped as sekai-kb tag → LB `/upgrade` clean (9.3); Wilson phase confirm | AI 6h \| Human 0.75h |
| 10 | Perception (analytics) | GA4 + Search Console + Cloudflare Web Analytics live behind `features.analytics`; signal fetchers ported; dashboard analytics panels | 10.1 · 10.2 | Dashboard renders real traffic/search data from a fetch run; zero analytics IDs in `src/` outside place.config; sekai-kb tag → LB `/upgrade` clean; Wilson phase confirm | AI 4.25h \| Human 1h |
| 11 | Autonomous routines | ROUTINE organ activated: routine contract + `/schedule` skill; embeddings/index refresh (CI); maintainer (content PR review + link/health audits); feedback-triage; data-refresh; trend-discovery; social-publish; rewrite | 11.1-11.8 | Two routines live ≥ 1 week shipping only via PRs, zero direct pushes to main; sekai-kb tag → LB `/upgrade` clean; Wilson phase confirm | AI 16.5h \| Human 0.75h |

**Totals:** §E (phases 0-8) AI ≈ 79h (implement + review) | Human ≈ 9h; the Phase 5
amendment (5.6, 2026-07-11) adds AI 2.5h; extension (phases 9-11) adds AI ≈ 26.75h |
Human ≈ 2.5h → grand total AI ≈ 108.5h | Human ≈ 11.5h.
Phases 0-4 ≈ 1.5-2 weeks at 2-4 tasks/day; phases 0-8 ≈ 4-6 weeks elapsed (3.2's 14-day
archive wait overlaps Phases 4-5); phases 9-11 add ≈ 1.5-2 weeks.

**Language policy (2026-07-11, scope fixed 2026-07-11 (b)):** every phase ships
English-only; sekai-kb v1 (Phase 5) carries no CJK/multi-language code path, language
profile, or gate — in ANY code tree (`src/`, `scripts/`, `tests/`, `workers/`, plugin
code), test fixtures included, never just the directory a DoD happens to name. Language
support is a post-project revisit after Phase 11 (PRD non-goals; STRATEGIC-DIRECTION
2026-07-11 notes). `/dev:plan` must not emit packets that retain CJK code for
hypothetical adopters. Enforcement is machine: the genericity gate scans all code trees
and the CI job includes a CJK-codepoint scan (both from LB-20).
**Adopter-facing boundary (2026-07-11 (c)):** sekai-kb v1's adopter docs (task 5.3:
README, framework CLAUDE.md, playbook) state the support boundary explicitly rather than
coding around it — UI strings and editorial tooling are English-calibrated; Latin-script
content largely works (plain word tokenization; article-health prose thresholds may need
retuning per instance); CJK content is unsupported until the post-project multi-language
revisit (LB-24). The schema seams (`place.locale`, `place.languages[]`) stay declared but
dormant.

**Ordering rules (structural, not preference):** Phases 6 and 7 declare `Depends: 5.4` —
the framework ships before LB's fun features (§A2, §G risk 3). Phase 9 depends on 7.2c
(§F's named MCP trigger honored); Phase 11 depends on 8.1 (ROUTINE organ architecture)
plus per-routine feature deps. Reordering is a scope change requiring Wilson's explicit
call.

**Execution repo flow for phases 9-11 (post-5.4 ownership rule, ADR 004/005):** every
code task executes in the `sekai-kb` repo; each phase closes with a tagged sekai-kb
release (CHANGELOG entry + upgrade note for any config-schema addition), and LB adopts it
via `/upgrade` — that pull is part of each phase's exit gate. The only LB-side commits are
instance-owned: feature flags in `place.config.ts`, analytics IDs, ROUTINE.md entries,
wrangler secrets. New `place.config` keys must be absent-safe (missing key = feature off)
so existing adopter instances upgrade without config surgery.

---

## Phase 5 amendment — approved by Wilson 2026-07-11 at Phase-4 close (STRATEGIC-DIRECTION 2026-07-11 (c))

Same mechanism as the Phases 9-11 extension: `/dev:plan` converts the block below exactly
as it does §E blocks; the packet-shaping notes amend §E 5.1-5.5's Steps/Acceptance detail
with repo realities §E (written 2026-07-04) could not know.

**New task block:**
```
[5.6] Generic content-lifecycle skills: /write, /validate, /factcheck + router
  Effort: M | Model: Opus | Depends: 5.1, 5.3 (the playbook is the pipeline SSOT the
    skills reference)
  Est: AI 2h + 0.5h review
  Steps:
    1. Port from the v1 archive's lb-write / lb-validate / lb-factcheck, genericized at
       port time: place identity + category set from place.config.ts, pipeline/editorial
       rules referenced from docs/playbook/ (never fork doc paths); land under
       .claude/skills/ with generic names (write, validate, factcheck) — no lb- prefix
       survives in any directory name, file name, or prose.
    2. Thin router skill (successor to the fork's `lb` router): lists the shipped skills
       + their triggers; probes semiont/config.json and no-ops gracefully when absent
       (organ substance arrives Phase 8).
    3. Extend both machine gates' scan scope to .claude/skills/ (agent-executed prose is
       code for doctrine purposes): check-genericity.sh SCAN_ROOTS and
       check-english-only.mjs SCAN_ROOTS.
    4. Document the skill ownership rule in SPEC + framework CLAUDE.md: framework skills
       are framework-owned (upgrade-managed, same class as src/); adopters ADD new skills
       freely (new files never conflict on upgrade); overriding a framework skill =
       upstream to sekai-kb first, or accept a conflict-managed local fork that /upgrade
       flags each release.
  Acceptance: on the demo place, /write produces an article that passes /validate and
    article-health; both gates green with .claude/skills/ in scope; the router lists
    exactly the shipped skills; zero place-specific strings in any skill
  Downstream: 8.1 (router's semiont probe), 11.3/11.8 (maintainer + rewrite routines
    invoke the validate/write pipelines)
```

**Not ported** (rulings recorded in STRATEGIC-DIRECTION 2026-07-11 (c)): `lb-translate`
(post-project, LB-24), `lb-become` (Phase 8.1), `lb-refresh`/`lb-news-lens`/`lb-peer`/
`lb-media-audit` (concepts return as Phase 11 routines 11.8/11.6/11.3), `lb-sync`/
`lb-search` (documented npm-command workflows in the 5.3 runbook).

**Packet-shaping notes for §E 5.1-5.4** (recorded 2026-07-11; facts verified in-repo):

- **5.1 strip list additions** beyond §E's (knowledge/, public/media/, place.config,
  CNAME): `reports/`, `research/`, `.claude/dev.md` (LB's tracker/process config — the
  template ships none), `public/data/boundary.geojson` (map overlay and 5.5's
  SystemDiagram both degrade gracefully without it — verified), LB visual baselines
  (recapture against the demo place), `docs/baselines/article-health-fork.md` + the
  `article-health:baseline` fork-parity check (LB-specific; re-point to a demo-place
  baseline or drop the npm script in the template). `.claude/rules/` gets a split pass:
  framework-relevant engineering rules (astro-*, prebuild-*, gray-matter, shell
  portability, GH-Actions least-privilege, lockfile) ship in the template; LB-process
  rules (dod-is-the-scope, visual-parity target, fork-sweep, clean-rebuild) stay
  instance-side — executor proposes the split in the PR.
- **5.1 build sanity on fresh history:** `build-dashboard-lite.mjs` computes immune
  dimensions from git log; on the template's single-init-commit history it must produce
  sane output (no crash, no degenerate scores) — acceptance-check it.
- **5.2a wizard scope grew beyond §E's ~8 prompts:** must also cover `links`
  (repo/email/social — the LB-3 schema divergence) and the `home` block (~230 lines of
  home-page copy now lives in place.config; see SPEC). The wizard writes generic defaults
  for `home.*`; `/adopt` MAY draft place-specific copy behind the same human-approval
  gate as `/seed-articles`. The wizard also appends the adopter's place name to a new
  instance-owned `scripts/ci/genericity-denylist.local.txt`, read additively by
  check-genericity.sh — the framework denylist file stays framework-owned so upgrades
  never conflict.
- **5.3 doc scope additions:** runbook covers the Python toolchain (uv + Python ≥3.12;
  article-health and its pytest suite run via `uv run`; `pyproject.toml` + `uv.lock` ship
  in the template). A template **README** is a named deliverable (the "Use this template"
  landing surface: what this is, the <1h adopt path, links to playbook/runbook). Ship an
  **AGENTS.md** pointer to CLAUDE.md so codex-cli and other agent CLIs boot the same
  instructions. State the language support boundary (see Language policy above).
- **5.4 instance-owned list extends** beyond §B's five files: `docs/baselines/**` and
  `scripts/ci/genericity-denylist.local.txt` (final `merge=ours` list minted in the
  packet). LB's squash-merge history makes the §E step-2 graft/subtree-merge choice
  load-bearing — document the chosen mechanics in the runbook as §E already requires.

---

## Extension task blocks (Phases 9-11) — approved by Wilson 2026-07-07, extends beyond frozen §E

Same format and conventions as §E blocks (`/dev:plan` converts packets from here; Steps/
Acceptance text governs packet detail). Model policy: all execution Opus (Wilson,
2026-07-07); reviews follow `.claude/dev.md` defaults. Decisions behind these blocks
(scheduler substrate, ship mode, analytics stack, release train): ADR 005.

**Phase 9: MCP + AI delivery**
```
[9.1] MCP server worker (workers/mcp/)
  Effort: M | Model: Opus | Depends: 7.2c (§F named trigger honored)
  Est: AI 2.5h + 0.5h review | Human 0.25h (wrangler route, client test)
  Steps:
    1. Stateless Streamable-HTTP MCP server on Cloudflare Workers (createMcpHandler
       pattern; no Durable Objects at LB scale — verified free-tier viable 2026-07, see
       ADR 005; document McpAgent/DO as the scale-up path for adopters needing sessions).
    2. Tools: list_topics (serves /kb/topics.json), get_article (slug →
       /kb/articles/{slug}.md), search (keyword over /kb/search-index.json),
       semantic_search (query embed via Workers AI @cf/baai/bge-m3 + in-worker cosine
       over the 7.2a vectors).
    3. Factor the retrieval code shared with workers/chat into workers/lib/; surgical
       refactor of the chat worker to consume it.
    4. Place identity from config; new feature flag features.mcp (absent-safe schema
       extension, links-precedent note in SPEC; init-wizard prompt tracked).
  Acceptance: an MCP client connected to the deployed endpoint answers an LB question via
    tool calls; genericity CI green; chat worker eval (7.2c set) still passes post-refactor
  Downstream: 9.2, 11.2 (vector redeploy path)
[9.2] AI-access page + agent boot file
  Effort: S | Model: Opus | Depends: 9.1
  Est: AI 1h + 0.25h review
  Steps:
    1. /ai page (successor to §F's "MCP page" row) documenting every AI consumption path
       — llms.txt, /kb/ protocol, MCP endpoint + client config snippets, /chat — all
       generated from place.config.
    2. build-kb-index.mjs additionally emits /kb/agent.md: a vendor-agnostic boot file
       (identity, voice, topic index, fetch instructions — the v0 research's BECOME-file
       concept, genericized); llms.txt links it.
  Acceptance: a browsing AI given only the domain can enumerate and use all access paths;
    genericity CI green
  Downstream: none
[9.3] Adopter upgrade playbook (docs/runbook/UPGRADE.md) + first real feature-release proof
  Effort: S | Model: Opus | Depends: 9.1, 9.2, 5.4
  Est: AI 1.5h + 0.25h review | Human 0.5h (Wilson runs the LB upgrade as the adopter)
  Steps:
    1. Ship Phase 9 as sekai-kb release vX.Y: CHANGELOG entry with the features.mcp
       upgrade note — the first real config-schema addition since the cut.
    2. Run /upgrade in lagunabeach-md against the tag as the proof.
    3. Write docs/runbook/UPGRADE.md for adopters FROM that real run: discover releases
       (watch tags / CHANGELOG), read upgrade notes, run /upgrade (AI path) or the manual
       fetch → merge-tag → build commands (non-AI path, extending 5.4's runbook section),
       handle conflict reports, enable newly added feature flags (absent-safe: skipping
       the flag = feature stays off), verify FRAMEWORK-VERSION bumped.
    4. Add the absent-safe schema rule to the framework CLAUDE.md + playbook so future
       sekai-kb changes preserve it.
  Acceptance: LB runs the real Phase-9 upgrade clean end-to-end; a first-timer following
    UPGRADE.md alone can state the exact commands and the flag to flip for MCP
  Downstream: every later framework release (10, 11, and beyond) ships against this playbook
```

_Phase 9 subtotal: AI 6h | Human 0.75h_

**Phase 10: Perception (analytics)**
```
[10.1] Analytics wiring behind features.analytics
  Effort: S | Model: Opus | Depends: 3.2 (live domain); scheduled post-9
  Est: AI 1h + 0.25h review | Human 0.5h (create GA4 property, verify Search Console,
    enable CF Web Analytics)
  Steps:
    1. Cloudflare Web Analytics beacon + GA4 gtag injected by HeadInlineScripts only when
       features.analytics is true; place.config gains analytics IDs (absent-safe schema
       extension, init-wizard prompt tracked).
    2. Runbook gains account-setup steps: GA4 property, Search Console verification,
       CF Web Analytics.
  Acceptance: beacons fire on the live site with the flag on, absent with it off; zero
    analytics IDs in src/ outside place.config
  Downstream: 10.2, 11.5
[10.2] Signal fetchers + dashboard analytics panels
  Effort: M | Model: Opus | Depends: 10.1, 4.2
  Est: AI 2.5h + 0.5h review | Human 0.5h (API credentials/secrets)
  Steps:
    1. Port fetch-ga4.py / fetch-search-console.py / fetch-cloudflare.py from the v1
       archive (§F port-on-trigger — trigger now fired), parameterized by config; emit
       src/data/analytics/*.json behind `npm run fetch:analytics`.
    2. Dashboard gains traffic/search panels (Chart.js per §B only if needed); build stays
       green when the JSONs are absent (graceful degradation).
    3. Credentials via local env / Actions secrets, documented in the runbook.
  Acceptance: `npm run fetch:analytics` refreshes the JSONs and the dashboard renders
    them; clean build without credentials
  Downstream: 11.5, 11.6
```

_Phase 10 subtotal: AI 4.25h | Human 1h_

**Phase 11: Autonomous routines**
```
[11.1] Routine substrate + contract (ROUTINE organ activation + /schedule skill)
  Effort: M | Model: Opus | Depends: 8.1
  Est: AI 2.5h + 0.5h review | Human 0.25h (first scheduled-task registration)
  Steps:
    1. Implement the hybrid substrate (ADR 005): deterministic pipelines = GitHub Actions
       cron/push-triggers; AI routines = Claude Code native scheduled tasks on Wilson's
       machine.
    2. semiont/organs/routine/ROUTINE.md is SSOT: each routine = {id, substrate:
       gh-actions|claude-cron, schedule, skill, model, depends, ship-mode:
       auto-merge-data|human-merge}. /schedule skill registers/unregisters against the
       declared substrate (writes the GH workflow or the native scheduled task).
    3. Routine lifecycle contract (taiwan-md's 5 stages, PR discipline replacing direct
       push): sync main → run skill → ship via PR per ship-mode → finale writes MEMORY
       organ entry. Routines NEVER push main directly.
    4. Kill switch: routine organ disabled in semiont/config.json = no routine fires.
       Collision rule: spacing documented in ROUTINE.md.
  Acceptance: a demo no-op routine registered on each substrate fires once, opens a PR,
    logs to MEMORY; disabling the organ stops both
  Downstream: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
[11.2] Embeddings + index refresh pipeline (CI-triggered, deterministic)
  Effort: S | Model: Opus | Depends: 7.2a, 9.1
  Est: AI 1.5h + 0.25h review
  Steps:
    1. GH Actions job on push-to-main touching knowledge/**: rebuild chunk vectors via
       Workers AI @cf/baai/bge-m3 (LB scale fits the 10k-neurons/day free tier; the 4090
       path stays documented as the offline alternative per §B), redeploy the vectors
       JSON consumed by workers/chat + workers/mcp.
    2. Verify + document that search/kb/graph indexes already rebuild on every deploy
       (no gap).
  Acceptance: editing an article on main updates chat + MCP retrieval within one deploy
    cycle, no manual step
  Downstream: none
[11.3] Maintainer routine: content PR review + link/health audit
  Effort: M | Model: Opus | Depends: 11.1, 4.1
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Content PR review workflow on pull_request touching knowledge/** — editorial +
       factcheck rubric sourced from the playbook, review comment posted; flips
       .claude/dev.md review_action_installed: true. Least-privilege permissions per
       .claude/rules/github-actions-least-privilege.md.
    2. Scheduled maintainer routine (claude-cron): internal-link audit + article-health
       sweep; regressions filed as issues/Linear stubs, feeding the 11.8 rewrite queue.
  Acceptance: a contributor PR receives an automated editorial review; a planted broken
    link produces an issue
  Downstream: 11.8
[11.4] Feedback-triage routine
  Effort: S | Model: Opus | Depends: 11.1, 6.1b
  Est: AI 1h + 0.25h review
  Steps:
    1. Register 6.1b's triage skill as a claude-cron routine (daily): read D1,
       dedupe/classify, file GitHub issues linking the article.
  Acceptance: a seeded D1 row becomes a GitHub issue on the next scheduled run
  Downstream: none
[11.5] Data-refresh routine
  Effort: S | Model: Opus | Depends: 11.1, 10.2
  Est: AI 1h + 0.25h review
  Steps:
    1. Register the 10.2 fetchers as a gh-actions routine (daily): fetch → data-only PR
       with auto-merge-on-green label → dashboard freshens on deploy.
  Acceptance: a scheduled run lands a merged data PR and the dashboard shows the new date
  Downstream: 11.6
[11.6] Trend-discovery routine (news-lens for LB)
  Effort: M | Model: Opus | Depends: 11.1; 10.2 enriches, not required
  Est: AI 2h + 0.5h review | Human 0.25h (approve first proposals)
  Steps:
    1. Weekly claude-cron routine: scan configured local sources (source list is a
       place-generic mechanism — knowledge/SOURCES.md; LB seeds city news, event
       calendars, community forums) + analytics signals when present.
    2. Propose article ideas and snippet candidates → INBOX.md entries + Linear Backlog
       stubs with source links. Proposals only — never writes articles directly.
  Acceptance: a run yields ≥3 sourced proposals in INBOX.md; zero direct article commits
  Downstream: 11.7 feed, 11.8 feed
[11.7] Social-publish routine
  Effort: S | Model: Opus | Depends: 11.1, 6.2 + first LB account exists (named trigger,
    per 6.2's adapter contract)
  Est: AI 1h + 0.25h review
  Steps:
    1. Register a claude-cron routine publishing approved SNIPPET-INBOX entries via the
       6.2 platform adapter; publish log appended to the inbox entry.
  Acceptance: an approved snippet posts to the wired platform on schedule;
    pending/unapproved entries never post
  Downstream: none
[11.8] Rewrite routine (KB freshness)
  Effort: M | Model: Opus | Depends: 11.1, 11.3
  Est: AI 2h + 0.5h review | Human 0.25h (merge first rewrite PR)
  Steps:
    1. Scheduled claude-cron routine: pick the lowest-health/stalest article from the
       11.3 sweep queue; rewrite per playbook (editorial bar, sources, lastVerified bump).
    2. Open a content PR (human-merge ship-mode), which the 11.3 review workflow then
       reviews.
  Acceptance: a run produces a rewrite PR whose article-health score exceeds the prior
    score; the PR carries the automated review
  Downstream: none
```

_Phase 11 subtotal: AI 16.5h | Human 0.75h_
