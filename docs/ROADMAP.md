# ROADMAP: Sekai KB

**Framework maintainer document.** This is the delivery-plan SSOT for the framework's
feature phases. Milestones are tracker project milestones, one per phase. Task packets
are converted from this document's detailed blocks by `/dev:plan`, never re-derived;
their Steps/Acceptance text governs packet detail.
Every phase transition is a maintainer gate — `/dev:plan` for phase n+1 runs only after
the maintainer confirms phase n closed. Estimates use `AI implement+review | Human`.

> **Stripped at adoption.** `npm run init` removes this file along with `docs/PRD.md`,
> `docs/SPEC.md`, and `docs/adr/`. It plans the framework's own development, not an
> adopted instance's work (ADR 008).

**Scope of this document (2026-07-28, ADR 008).** Phases 0-5 built the first instance and
cut the framework out of it. That history — the extraction map, the inherited-fork
disposition, the per-task packet-shaping notes, and the phase-0-through-5 table — is
instance #1's rebuild record and stays in its repository. What moved here are the phases
whose code executes in `sekai-kb`: **6 through 11**, plus the amendments and ordering
rules that govern them. The tracker remains a single project spanning both repositories,
so task ids (`LB-*`) are continuous across the split.

| # | Milestone | Outcome | Scope (tasks) | Exit gate | Est |
|---|---|---|---|---|---|
| 6 | Social + engagement | Feedback (Worker + D1 + widget + triage), snippet pipeline, soundscape | 6.1a-c · 6.2 · 6.3 · 6.3b · 6.3c · 6.3d · 6.4 | Live submission → D1 → GitHub issue; three real recordings and the tag adoption in 6.4; phase confirm | AI 20.25h \| Human 3h |
| 7 | Differentiators | On-demand OG worker, RAG chat (bge-m3 + Workers AI + Claude API), QR flow | 7.1 · 7.2a-c · 7.3 | Eval set answered with citations, no hallucinated places (7.2c); phase confirm | AI 12.25h \| Human 1.75h |
| 8 | Semiont plugin layer | Organ architecture in sekai-kb (config.json manifest, core organs); instance #1 enables core + MANIFESTO | 8.1 · 8.2 | Site builds with `semiont/` deleted; organs toggle via config only; phase confirm | AI 4.25h \| Human 0h |
| 9 | MCP + AI delivery | Remote MCP server (`workers/mcp/`) exposing list_topics/get_article/search/semantic_search; AI-access page + `/kb/agent.md` boot file; adopter upgrade playbook proven on the first real post-cut feature release | 9.1 · 9.2 · 9.3 | An MCP client connected to the instance's `/mcp` endpoint answers a question about its place via tools, no clone; phase shipped as a sekai-kb tag → instance `/sekai-upgrade` clean (9.3); maintainer phase confirm | AI 6h \| Human 0.75h |
| 10 | Perception (analytics) | GA4 + Search Console + Cloudflare Web Analytics live behind `features.analytics`; signal fetchers ported; dashboard analytics panels | 10.1 · 10.2 | Dashboard renders real traffic/search data from a fetch run; zero analytics IDs in `src/` outside place.config; sekai-kb tag → instance `/sekai-upgrade` clean; maintainer phase confirm | AI 4.25h \| Human 1h |
| 11 | Autonomous routines | ROUTINE organ activated: routine contract + `/schedule` skill; embeddings/index refresh (CI); maintainer (content PR review + link/health audits); feedback-triage; data-refresh; trend-discovery; social-publish; rewrite | 11.1-11.8 | Two routines live >= 1 week shipping only via PRs, zero direct pushes to main; sekai-kb tag → instance `/sekai-upgrade` clean; maintainer phase confirm | AI 16.5h \| Human 0.75h |

**Totals for these phases:** AI ≈ 59.25h | Human ≈ 7.25h. Phases 6-8 close the original
plan (AI ≈ 32.5h | Human ≈ 3h); the extension phases 9-11 add AI ≈ 26.75h | Human ≈ 2.5h
and roughly 1.5-2 weeks elapsed. Phase 6's numbers are the 2026-07-29 planning amendment's,
not the original block estimates. Phases 0-5, and therefore the grand totals for the whole
programme, are recorded in instance #1's roadmap.

**Language policy:** every phase ships English-only. The framework carries no
CJK/multi-language code path, language profile, or gate — in ANY code tree (`src/`,
`scripts/`, `tests/`, `workers/`, `.agents/skills/`), test fixtures included, never just
the directory a DoD happens to name. Language support is a post-project revisit after
Phase 11 (PRD non-goals). `/dev:plan` must not emit packets that retain CJK code for
hypothetical adopters. Enforcement is machine: the genericity gate scans all code trees
and CI includes a CJK-codepoint scan.
**Adopter-facing boundary:** the adopter docs (README, the wizard-emitted `AGENTS.md`,
the playbook) state the support boundary explicitly rather than coding around it — UI
strings and editorial tooling are English-calibrated; Latin-script content largely works
(plain word tokenization; article-health prose thresholds may need retuning per
instance); CJK content is unsupported until the post-project multi-language revisit. The
schema seams (`place.locale`, `place.languages[]`) stay declared but dormant.

**Ordering rules (structural, not preference):** Phases 6 and 7 depend on the framework
cut — the framework ships before instance fun-features (ADR 002, held in instance #1's
history; SPEC `Risk controls`). Phase 9 depends on 7.2c (the inherited-fork
disposition's named MCP trigger); Phase 11 depends on 8.1 (ROUTINE organ architecture)
plus per-routine feature deps. Reordering is a scope change requiring the maintainer's
explicit call.

**Execution repo flow (post-cut ownership rule, ADR 004/005):** every
code task in these phases executes in the `sekai-kb` repository; each phase closes with a
tagged sekai-kb release (CHANGELOG entry + upgrade note for any config-schema addition),
and instance #1 adopts it via `/sekai-upgrade` — that pull is part of each phase's exit
gate. The only instance-side commits are instance-owned: feature flags in
`place.config.ts`, analytics IDs, ROUTINE.md entries, wrangler secrets. New
`place.config` keys must be absent-safe (missing key = feature off) so existing adopter
instances upgrade without config surgery.

---

## Agent-toolkit migration amendment — approved 2026-07-19

Records the future-phase deltas from the dev-plugin 0.0.55 migration (ADR 006 +
addendum): `AGENTS.md` is the agent-instruction SSOT and adopter/instance-owned
(`merge=ours`); `CLAUDE.md` is a byte-exact one-line `@AGENTS.md` shim, never
content-bearing; all rules are dev-plugin state in `.agent-toolkit/rules/` and the
template ships none. These rulings govern packet conversion for the
affected phases. **Phases 6-7 and 10-11 need no changes** — their blocks touch none of
the migrated surfaces.

- **8.1 organ-loader ruling (supersedes task 8.1 step 2's "CLAUDE.md boot section" and
  ADR 003's original loader location):** the loader is a stable one-paragraph boot hook
  seeded into the starter `AGENTS.md` by the init wizard — read `semiont/config.json`,
  load enabled organs' boot files, no-op gracefully when the config is absent. All
  evolving loader logic and organ substance live in framework-owned `semiont/` files, so
  the adopter-owned hook rarely changes; when it must, the change reaches existing
  instances via `/sekai-upgrade`'s conversational starter-diff step, never a silent merge
  (same pattern as the dev-plugin reference line in `AGENTS.md`). Boot-time organ
  loading — MEMORY/REFLEXES inlined each session, ADR 003's core-organ intent — is
  preserved. The `/dev:plan` packet for 8.1 cites this ruling, not the superseded wording.
- **8.2 naming:** the acceptance's "become skill boots" reads as the 8.1 boot hook (the
  inherited `become` skill was re-dispositioned into 8.1 by the 2026-07-11 ruling).
- **9.3 corrections (applied inline in the extension block below):**
  `docs/runbook/UPGRADE.md` already exists (written in Phase 5), so 9.3
  extends and proves it rather than writing it; and the absent-safe schema rule lands
  in sekai-kb's `AGENTS.md` + playbook, not "the framework CLAUDE.md".

---

## Phase 6 planning amendment — approved 2026-07-29

Records the `/dev:plan` conversion decisions for Phase 6. The blocks below carry them
inline; this section is the rationale, and the packet bodies cite it.

- **6.1b splits into 6.1b + 6.1c.** The original block bundled the widget (frontend plus a
  `place.config` schema addition) with the triage skill (`wrangler` + `gh` ops tooling behind
  a human-approval loop). Different surfaces, different failure modes, independently
  verifiable, and keeping them together chained the widget behind the triage skill's manual
  criterion. Both still depend only on 6.1a, so they run in parallel.
- **Skill names take the `sekai-` prefix.** The block's `/snippet` and "a triage skill" become
  `/sekai-snippet` and `/sekai-triage-feedback` (`AGENTS.md` §Skill discovery and ownership:
  the namespace prevents collisions with adopter and tool-provided skills).
- **6.4 is a new packet, not an untracked gate.** The milestone's exit gate is real work with
  human steps, and Phase 5 tracked its closer the same way. It is the only Phase 6 packet
  whose `Execution repo:` is the instance.
- **6.3's "first three recordings" splits by repository (decision D1).** The template is a
  fictional place and cannot own field recordings, so the framework ships three synthesized
  demo clips that make the player and the visual bar provable, credited as synthesized rather
  than field-recorded, and stripped by the wizard at adoption. The three real recordings are
  6.4's instance-side work, which is where the block's Human 2h actually falls.
- **`workers/` joins the place-name gate's instance-mode scan roots in 6.1a (decision D2).**
  `.agent-toolkit/rules/genericity-gate-scope.md` recorded the gap as a deferral "for when
  that tree arrives"; 6.1a is the task that makes it arrive. Whole-tree template mode hides
  the hole in this repository, so shipping `workers/` without closing it would leave adopted
  instances with an unguarded place-identity ingress in framework-owned code. The change is
  one `SCAN_ROOTS` line plus the 13 statements `scripts/ci/check-scan-root-docs.mjs`
  registers for that gate, which fails CI on any site missed.
- **6.2 ships the runner and a manual sink, still zero platform adapters (decision D3).** The
  queue format documents `status: posted`; with an interface alone nothing can ever set it,
  so the lifecycle contract would ship with an unreachable state and 11.7 would inherit both
  the runner and the first adapter. The shipped sink is not a platform client: it prints the
  post text for the operator to paste and records the resulting URL, which is what happens
  before any account automation exists. `docs/PRD.md`'s "no framework features for
  hypothetical adopters" is satisfied — no platform API client is built.
- **Estimates:** Phase 6 becomes AI ≈ 11.75h | Human ≈ 3h (was AI 9.5h | Human 2.5h), from
  the split, 6.4, D2, and D3.

---

## Phase 6 planning amendment — approved 2026-07-31

Records the one block added after 6.3 shipped. Same form as the 2026-07-29 amendment: the
block below carries the decision inline, this section is the rationale.

- **6.3b is a new block, inserted between 6.3 and 6.4.** 6.3 shipped `/soundscape` as a flat
  single-column list. The reference implementation of this page on the first instance's live
  site carries ordered categories, a card grid, per-category wishlists of sounds still wanted,
  and a contribute block; that shape is what makes the page a collection rather than a file
  listing. `docs/PRD.md`'s "no framework features for hypothetical adopters" is satisfied by
  the same test 6.2's decision D3 used: a real instance runs this page shape in production, so
  the need is demonstrated rather than speculative.
- **It blocks 6.4 rather than following it.** 6.4 step 3 commits the instance's three real
  recordings as manifest entries against the tag cut in step 1. Landing the schema change
  after that tag would write those entries in the flat shape and rewrite them into categories
  on the next tag, and would confirm the phase exit gate's visual bar against a layout already
  scheduled to change. Ordering it before 6.4 costs the block's estimate and buys one write.
- **The manifest stays the single source.** Categories, wishlist entries, and the richer
  per-recording fields are declared in `knowledge/sounds/_manifest.md`, never in a data module
  under `src/` — the place-name and English-only gates scan that tree, and the reference
  instance's equivalent file could not exist here. A flat `sounds:` list keeps rendering, so
  an adopter's existing manifest is not broken by the release.
- **Estimates:** Phase 6 becomes AI ≈ 16h | Human ≈ 3h (was AI ≈ 11.75h | Human ≈ 3h), from
  6.3b alone.

---

## Phase 6 planning amendment — approved 2026-08-03

Records the one block added after 6.3b shipped. Same form as the 2026-07-31 amendment: the
block below carries the decision inline, this section is the rationale.

- **6.3c is a new block, inserted between 6.3b and 6.4.** 6.3 shipped the soundscape reader
  (`src/lib/sounds.ts`) and 6.3b shipped the categorized layout, but neither shipped a writer
  or a validation gate. Every other Phase 6 content surface has both: 6.2 ships
  `scripts/tools/snippet/publish.mjs` plus `npm run test:snippet` in CI, the feedback worker
  carries its own D1 schema and test suite, and the manifest itself is the one surface with no
  check at all — a typo'd `file`, a missing mp3, or a missing required field is silently
  dropped and CI says nothing. The writer (`npm run sounds:add`) and gate (`npm run
  sounds:check`) close that asymmetry.
- **It blocks 6.4 rather than following it.** 6.4 DoD 6 requires committing the instance's
  three real recordings through `npm run sounds:add`. Hand-writing the entries and shipping the
  tool later writes them twice and validates the exit gate against a path the framework does
  not support. Ordering the tool before 6.4 costs this block's estimate and buys one write
  — the same tradeoff the 2026-07-31 amendment made for 6.3b.
- **Estimates:** Phase 6 becomes AI ≈ 18.5h | Human ≈ 3h (was AI ≈ 16h | Human ≈ 3h), from
  6.3c alone.

---

## Phase 6 planning amendment — approved 2026-08-03

Records the one block added after 6.3c shipped. Same form as the amendment above: the block
carries the decision inline, this section is the rationale.

- **6.3d is a new block, inserted between 6.3c and 6.4.** 6.3c shipped the ingest writer and
  the manifest validation gate, but the writer published the recording verbatim. Consumer
  phones write capture coordinates, capture timestamp, device make and model, and OS version
  into the container; ffmpeg copies input metadata to its output by default and Astro copies
  `public/` into `dist/` byte-for-byte, so nothing between the recording and the published
  asset removed any of it. Found by `/dev:review-pr` on the instance's exit-gate PR, where
  three of the four committed recordings carried GPS to roughly ten metres. This is a
  framework defect: every adopter running `sounds:add` publishes the same data, and one
  recording near home publishes their home coordinates.
- **The writer fix alone does not close it.** Hand-placing a file into
  `public/media/sounds/` and hand-writing the manifest entry is a documented, supported path,
  so `sounds:check` gains the matching gate. Same asymmetry 6.3c closed for the manifest,
  applied to the published bytes.
- **It blocks 6.4 rather than following it.** 6.4 DoD 6 commits the instance's real
  recordings through `npm run sounds:add`. Shipping the exit gate before the strip publishes
  the coordinates first and scrubs them second, which is not a state a public site should
  pass through. Ordering the fix before 6.4 costs this block's estimate; 6.4 then adopts the
  tag and re-ingests or scrubs the four already-committed assets.
- **Estimates:** Phase 6 becomes AI ≈ 20.25h | Human ≈ 3h (was AI ≈ 18.5h | Human ≈ 3h),
  from 6.3d alone.

---

## Detailed task blocks: Phases 6-8

These are the active source blocks for `/dev:plan`. Model names are advisory and
version-less; the maintainer chooses the session model. Every task executes in
`sekai-kb`, ships in a tagged release, and reaches an instance through `/sekai-upgrade`
unless its packet names an instance-owned edit — 6.4 is the one block that does, and it
names the instance in its own `Execution repo:` line.

**Phase 6: Social + engagement**

```text
[6.1a] Feedback backend: workers/feedback (Cloudflare Worker + D1)
  Effort: M | Model: Opus | Depends: framework cut
  Est: AI 2h + 0.5h review | Human 0.5h (Cloudflare account, wrangler auth, secrets)
  Steps:
    1. Build workers/feedback/ with D1 schema feedback(id, created_at, page, category,
       message, contact, user_agent, status).
    2. Expose POST with a honeypot field, per-IP rate limiting, and CORS locked to the
       configured site origin. Check in wrangler.toml and add exact deploy steps to the
       runbook.
  Acceptance: a curl POST against the deployed worker lands a row in D1; honeypot and
    rate-limit paths are verified
  Downstream: 6.1b, 11.4

[6.1b] Feedback frontend: widget behind features.feedback + workers.feedback
  Effort: S | Model: Opus | Depends: 6.1a
  Est: AI 1h + 0.25h review
  Steps:
    1. Build FeedbackWidget.astro on article pages behind features.feedback. Reuse no
       Supabase-shaped code from the inherited fork.
    2. Add the absent-safe workers.feedback endpoint key (wizard prompt table entry; the
       wizard stays the single writer of place.config.ts).
  Acceptance: a live-site submission lands in D1; the widget is absent with either the
    flag off or the endpoint key missing
  Downstream: 6.4

[6.1c] Feedback triage: /sekai-triage-feedback (D1 -> deduplicated GitHub issues)
  Effort: S | Model: Opus | Depends: 6.1a
  Est: AI 1h + 0.25h review
  Steps:
    1. Build the skill: read status='new' rows through wrangler, classify, deduplicate,
       file GitHub issues linking the article, mark rows triaged with the issue URL.
    2. Gate every write behind explicit human approval, as /sekai-seed-articles does.
  Acceptance: triage produces a GitHub issue; a duplicate comments instead of filing a
    second one
  Downstream: 6.4, 11.4

[6.2] Snippet pipeline: skill + inbox + adapter interface + manual-sink runner
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Build /sekai-snippet: select article, generate short-form draft, append it to
       knowledge/SNIPPET-INBOX.md with status pending. A human changes pending to approved.
    2. Define the platform-adapter interface. Add no platform adapter until an instance
       account exists; then add one adapter per platform.
    3. Ship the runner plus a manual sink so approved -> posted is reachable without any
       platform API (2026-07-29 amendment, decision D3).
  Acceptance: /sekai-snippet <article> yields an approved-queue entry; the runner marks it
    posted through the manual sink; publish posts to a platform after an account and
    adapter are wired
  Downstream: 6.4, 11.7

[6.3] Soundscape page + manifest contract + demo audio
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 1.5h + 0.5h review
  Steps:
    1. Build the page from the archived soundscape template as design reference, behind
       features.soundscape.
    2. Define knowledge/sounds/ manifest entries with title, location, credit, and file.
       Use native HTML5 audio and no player library.
    3. Ship three synthesized demo clips so the player and the visual bar are provable in
       the template; the wizard strips them at adoption. The three real recordings are
       instance-side work in 6.4 (2026-07-29 amendment, decision D1).
  Acceptance: audio plays on mobile Safari; the page passes the visual bar; an absent
    manifest renders the empty state with a green build
  Downstream: 6.4

[6.3b] Soundscape layout: manifest categories, card grid, wishlist, contribute block
  Effort: M/L | Model: Opus | Depends: 6.3
  Est: AI 3.5h + 0.75h review
  Steps:
    1. Extend knowledge/sounds/_manifest.md to an ordered categories list (id, icon, title,
       optional article link), each carrying its recordings and a wishlist of sounds still
       wanted; a flat sounds list still renders as one implicit category.
    2. Normalize both shapes in src/lib/sounds.ts, validate every new field with a named
       warning, and keep the three absent-safe cases identical.
    3. Rebuild the template: hero stats, one anchored section per category, a responsive
       card grid with the richer card, per-category empty state and wishlist, and a
       contribute block. No player library, no client framework, zero script tags.
  Acceptance: the page passes the visual bar at desktop and mobile widths; an existing flat
    manifest renders unchanged; an absent manifest still renders the empty state green
  Downstream: 6.3c, 6.4

[6.3c] Soundscape ingest: npm run sounds:add, manifest validation gate, authoring playbook
  Effort: M | Model: Opus | Depends: 6.3b
  Est: AI 2.5h + 0.5h review
  Decision: hand-writing manifest entries and shipping the tool later writes them twice, and
    validates the exit gate against a path the framework does not support. Build the tool
    first; 6.4 DoD 6 uses it to produce the three real recordings.
  Steps:
    1. Build scripts/ci/check-sounds.mjs (npm run sounds:check): imports the five field
       arrays from src/lib/sounds.ts, exits nonzero on missing required fields / unresolved
       file / path-escape / duplicate category id. Orphan mp3s are reported but do not fail.
    2. Build scripts/tools/sounds/add.mjs (npm run sounds:add): takes input audio paths +
       metadata, places/converts to public/media/sounds/<slug>.mp3, appends YAML entry to
       the manifest. Strictly additive; preserves surrounding bytes.
    3. Write docs/playbook/SOUNDSCAPE-PLAYBOOK.md: record, convert, add, verify, commit.
    4. Wire sounds:check into postbuild and CI; add sounds:selftest to CI.
  Acceptance: npm run sounds:add on a fixture produces a valid manifest that passes
    sounds:check; the self-test proves every failure class; genericity passes
  Downstream: 6.3d, 6.4

[6.3d] Soundscape ingest strips recording metadata: strip on write, gate on check
  Effort: M | Model: Opus | Depends: 6.3c
  Est: AI 1.5h + 0.25h review
  Decision: stripping is unconditional, with no opt-out flag. The manifest asks for a
    human-written location string precisely so the place is described in the instance's own
    words; shipping exact coordinates underneath it contradicts that field's purpose.
  Steps:
    1. Write every published file through ffmpeg with metadata, chapter, and ID3 writing
       disabled, on the conversion path and on the mp3 path alike. mp3 input is re-muxed
       (-c:a copy, lossless) rather than copied, which makes ffmpeg an unconditional
       prerequisite of npm run sounds:add.
    2. Extend sounds:check to scan every published mp3 and fail on any metadata tag or a
       wrong container. CI has no ffmpeg, and the gate also runs from an adopter's postbuild,
       so the container read is JavaScript and never shells out to ffprobe.
    3. Share the strip arguments and the container reader between writer and gate so the
       tool and the gate that judges it cannot drift.
    4. Extend sounds:selftest with one planted case per tag container; document the strip,
       the gate, and the non-retroactive remedy in the soundscape playbook.
  Acceptance: a tagged fixture converts and re-muxes to a file with no tag; the gate fails on
    each planted tag form naming the file and the field, and passes on the shipped tree; the
    release entry carries an upgrade note, because the fix is not retroactive to assets an
    adopter has already committed
  Downstream: 6.4

[6.4] Phase 6 exit gate: ship the tag, adopt it in the instance, go live
  Effort: M | Model: Opus | Depends: 6.1b, 6.1c, 6.2, 6.3, 6.3b, 6.3c, 6.3d
  Est: AI 1h + 0.25h review | Human 2.5h (Cloudflare setup, three recordings, confirm)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 6.1a-6.3; adopt it with /sekai-upgrade (real merge
       commit, instance-owned files untouched, FRAMEWORK-VERSION bumped after verification).
    2. Enable features.feedback + workers.feedback + features.soundscape; deploy the
       instance's own worker, D1, and secrets.
    3. Record, convert, and commit the three real recordings with manifest entries.
  Acceptance: production submission -> D1 -> real GitHub issue; three recordings play on
    mobile Safari on the deployed site; maintainer phase confirm
  Downstream: Phase 7 entry
```

_Phase 6 subtotal: AI 16.25h | Human 2.5h_

**Phase 7: Differentiators**

```text
[7.1] On-demand OG worker (Satori + resvg-wasm)
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Build workers/og/: GET /og/{slug}.png. Render title, category color, and site brand
       from /kb/topics.json data through Satori and resvg-wasm. Return long-lived cache
       headers and cache at the Cloudflare edge.
    2. Switch SEO.astro og:image to the worker URL behind a feature flag; retain static
       og-default.png as fallback.
  Acceptance: og:image URLs render per-article cards; cached responses complete in <200ms
  Downstream: 7.2a

[7.2a] Corpus embeddings: build-embeddings.mjs + static vectors
  Effort: M | Model: Opus | Depends: 7.1
  Est: AI 2h + 0.5h review | Human 0.5h (offline GPU embedding run, if that path chosen)
  Steps:
    1. Port build-embeddings.mjs from the v1 archive. Chunk articles at 300-500 tokens on
       ## headings; embed with bge-m3 at 1024 dimensions on an offline GPU or Workers AI.
       Emit static vectors JSON into workers/chat/.
  Acceptance: vectors cover every article; chunk metadata includes title, url, category,
    and heading
  Downstream: 7.2b, 9.1, 11.2

[7.2b] Chat worker: query embedding + cosine retrieval + Claude API
  Effort: M | Model: Opus | Depends: 7.2a
  Est: AI 2.5h + 0.5h review | Human 0.25h (Claude API key + Workers AI binding)
  Steps:
    1. Build workers/chat/. Embed queries through Workers AI @cf/baai/bge-m3; perform
       in-worker cosine retrieval over vectors cached in global scope; pass top-k chunks
       to Claude with citation-required prompting; stream the response.
  Acceptance: the deployed worker streams an answer from article content with citations
  Downstream: 7.2c, 9.1

[7.2c] /chat page + evaluation set
  Effort: M | Model: Opus | Depends: 7.2b
  Est: AI 2h + 0.5h review | Human 1h (review evaluation answers)
  Steps:
    1. Build /chat in vanilla JS; answers cite article links.
    2. Check a 10-question evaluation set into workers/chat/eval/ and run it against the
       live worker.
  Acceptance: the evaluation set is answered from articles with citations and no
    hallucinated places
  Downstream: 7.3, 9.1

[7.3] QR flow: location-context deep links + printable codes
  Effort: S | Model: Sonnet | Depends: 7.2c
  Est: AI 1h + 0.25h review
  Steps:
    1. Add a ctx-param map from location slug to location-aware greeting and retrieval hint.
    2. Add a printable QR sheet that generates codes for physical locations.
  Acceptance: scanning a location code opens /chat with a location-aware greeting
  Downstream: none
```

_Phase 7 subtotal: AI 12.25h | Human 1.75h_

**Phase 8: Semiont plugin layer**

The agent-toolkit migration amendment above controls the `AGENTS.md` boot-hook location
and supersedes the original `CLAUDE.md` loader wording.

```text
[8.1] Organ architecture in sekai-kb: semiont/config.json + loader + core organs
  Effort: M | Model: Opus | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Add semiont/config.json plus organs/{memory,reflexes,manifesto,diary,routine,
       introspection}/ scaffolds. The site build never imports semiont/; CI must prove a
       build succeeds with the directory absent.
    2. Seed a stable one-paragraph boot hook into starter AGENTS.md. It reads config.json,
       loads enabled organ boot files, and no-ops when config is absent. Core organs are
       MEMORY.md and REFLEXES.md; total boot read remains below 150 lines.
    3. Enforce ADR 003: no organ reads another organ's files; every skill probes for organ
       existence and no-ops gracefully when absent.
  Acceptance: site builds with semiont/ absent; disabling an organ removes its boot cost
  Downstream: 8.2, 11.1

[8.2] Instance #1 enables core + MANIFESTO; DIARY and ROUTINE stay off
  Effort: S | Model: Sonnet | Depends: 8.1
  Est: AI 1h + 0.25h review
  Steps:
    1. Enable memory, reflexes, and manifesto in the instance's semiont/config.json.
    2. Salvage MANIFESTO prose by hand from the v1 archive; the organ shell is new.
  Acceptance: the AGENTS.md boot hook reads <150 lines; organs toggle through config only
  Downstream: 11.1
```

_Phase 8 subtotal: AI 4.25h | Human 0h_

---

## Detailed task blocks: Phases 9-11

`/dev:plan` converts packets from here; Steps/Acceptance text governs packet detail.
Model policy: all execution Opus (2026-07-07); reviews follow `.agent-toolkit/dev.md`
defaults. Decisions behind these blocks (scheduler substrate, ship mode, analytics stack,
release train): ADR 005.

**Phase 9: MCP + AI delivery**
```
[9.1] MCP server worker (workers/mcp/)
  Effort: M | Model: Opus | Depends: 7.2c (named MCP trigger honored)
  Est: AI 2.5h + 0.5h review | Human 0.25h (wrangler route, client test)
  Steps:
    1. Stateless Streamable-HTTP MCP server on Cloudflare Workers (createMcpHandler
       pattern; no Durable Objects at single-instance scale — verified free-tier viable
       2026-07, see ADR 005; document McpAgent/DO as the scale-up path for adopters
       needing sessions).
    2. Tools: list_topics (serves /kb/topics.json), get_article (slug →
       /kb/articles/{slug}.md), search (keyword over /kb/search-index.json),
       semantic_search (query embed via Workers AI @cf/baai/bge-m3 + in-worker cosine
       over the 7.2a vectors).
    3. Factor the retrieval code shared with workers/chat into workers/lib/; surgical
       refactor of the chat worker to consume it.
    4. Place identity from config; new feature flag features.mcp (absent-safe schema
       extension, links-precedent note in SPEC; init-wizard prompt tracked).
  Acceptance: an MCP client connected to the deployed endpoint answers a question about
    the instance's place via tool calls; genericity CI green; chat worker eval (7.2c set)
    still passes post-refactor
  Downstream: 9.2, 11.2 (vector redeploy path)
[9.2] AI-access page + agent boot file
  Effort: S | Model: Opus | Depends: 9.1
  Est: AI 1h + 0.25h review
  Steps:
    1. /ai page (successor to the inherited-fork MCP page) documenting every AI
       consumption path — llms.txt, /kb/ protocol, MCP endpoint + client config snippets,
       /chat — all generated from place.config.
    2. build-kb-index.mjs additionally emits /kb/agent.md: a vendor-agnostic boot file
       (identity, voice, topic index, fetch instructions), genericized; llms.txt links it.
  Acceptance: a browsing AI given only the domain can enumerate and use all access paths;
    genericity CI green
  Downstream: none
[9.3] Adopter upgrade playbook (docs/runbook/UPGRADE.md) + first real feature-release proof
  Effort: S | Model: Opus | Depends: 9.1, 9.2, framework cut
  Est: AI 1.5h + 0.25h review | Human 0.5h (the maintainer runs the instance upgrade as
    the adopter)
  Steps:
    1. Ship Phase 9 as sekai-kb release vX.Y: CHANGELOG entry with the features.mcp
       upgrade note — the first real config-schema addition since the cut.
    2. Run /sekai-upgrade in instance #1 against the tag as the proof.
    3. Extend docs/runbook/UPGRADE.md (exists since Phase 5) for adopters
       FROM that real run: discover releases (watch tags / CHANGELOG), read upgrade
       notes, run /sekai-upgrade (AI path) or the manual fetch → merge-tag → build commands
       (non-AI path), handle conflict reports, enable newly added feature flags
       (absent-safe: skipping the flag = feature stays off), verify FRAMEWORK-VERSION
       bumped.
    4. Add the absent-safe schema rule to sekai-kb's AGENTS.md + playbook so future
       framework changes preserve it (per ADR 006, CLAUDE.md is a one-line @AGENTS.md
       shim — never content-bearing).
  Acceptance: the instance runs the real Phase-9 upgrade clean end-to-end; a first-timer
    following UPGRADE.md alone can state the exact commands and the flag to flip for MCP
  Downstream: every later framework release (10, 11, and beyond) ships against this playbook
```

_Phase 9 subtotal: AI 6h | Human 0.75h_

**Phase 10: Perception (analytics)**
```
[10.1] Analytics wiring behind features.analytics
  Effort: S | Model: Opus | Depends: a live domain; scheduled post-9
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
  Effort: M | Model: Opus | Depends: 10.1, quality tooling
  Est: AI 2.5h + 0.5h review | Human 0.5h (API credentials/secrets)
  Steps:
    1. Port fetch-ga4.py / fetch-search-console.py / fetch-cloudflare.py from the v1
       archive (the named trigger has fired), parameterized by config; emit
       src/data/analytics/*.json behind `npm run fetch:analytics`.
    2. Dashboard gains traffic/search panels (Chart.js per SPEC `Stack` only if needed);
       build stays green when the JSONs are absent (graceful degradation).
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
       cron/push-triggers; AI routines = Claude Code native scheduled tasks on the
       operator's machine.
    2. semiont/organs/routine/ROUTINE.md is SSOT: each routine = {id, substrate:
       gh-actions|claude-cron, schedule, skill, model, depends, ship-mode:
       auto-merge-data|human-merge}. /schedule skill registers/unregisters against the
       declared substrate (writes the GH workflow or the native scheduled task).
    3. Routine lifecycle contract (five stages, PR discipline replacing direct
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
       Workers AI @cf/baai/bge-m3 (single-instance scale fits the 10k-neurons/day free
       tier; the offline GPU path stays documented as the alternative per SPEC `Stack`),
       redeploy the vectors JSON consumed by workers/chat + workers/mcp.
    2. Verify + document that search/kb/graph indexes already rebuild on every deploy
       (no gap).
  Acceptance: editing an article on main updates chat + MCP retrieval within one deploy
    cycle, no manual step
  Downstream: none
[11.3] Maintainer routine: content PR review + link/health audit
  Effort: M | Model: Opus | Depends: 11.1, quality tooling
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Content PR review workflow on pull_request touching knowledge/** — editorial +
       factcheck rubric sourced from the playbook, review comment posted; flips
       .agent-toolkit/dev.md review_action_installed: true. Least-privilege permissions per
       .agent-toolkit/rules/github-actions-least-privilege.md.
    2. Scheduled maintainer routine (claude-cron): internal-link audit + article-health
       sweep; regressions filed as tracker stubs, feeding the 11.8 rewrite queue.
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
[11.6] Trend-discovery routine (news-lens for the instance)
  Effort: M | Model: Opus | Depends: 11.1; 10.2 enriches, not required
  Est: AI 2h + 0.5h review | Human 0.25h (approve first proposals)
  Steps:
    1. Weekly claude-cron routine: scan configured local sources (the source list is a
       place-generic mechanism — knowledge/SOURCES.md; an instance seeds its own city
       news, event calendars, community forums) + analytics signals when present.
    2. Propose article ideas and snippet candidates → INBOX.md entries + tracker Backlog
       stubs with source links. Proposals only — never writes articles directly.
  Acceptance: a run yields >=3 sourced proposals in INBOX.md; zero direct article commits
  Downstream: 11.7 feed, 11.8 feed
[11.7] Social-publish routine
  Effort: S | Model: Opus | Depends: 11.1, 6.2 + a first instance account exists (named
    trigger, per 6.2's adapter contract)
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
