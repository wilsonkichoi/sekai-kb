# Changelog

All notable changes to the **sekai-kb** framework are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release discipline (read before cutting a release)

sekai-kb is the framework SSOT; instances track it by merging **immutable release
tags, never framework `main`** (ADR 004, SPEC
§Repo topology). The rules that keep two-repo upgrades deterministic:

1. **Every framework change lands with a CHANGELOG entry.** No entry, no release.
   The entry names what changed in the framework-owned trees (`src/`, `scripts/`,
   `.agents/skills/`, `docs/playbook/`, `docs/runbook/`, config).
2. **Breaking config changes carry an upgrade note.** Any change an instance must
   act on at merge time (a renamed `place.config.ts` key, a new required field, a
   moved file) goes under an explicit **Upgrade note** in that version's entry.
   New `place.config` keys MUST default to feature-off when absent (SPEC
   §Negative requirements, "New `place.config` keys must be absent-safe"), so an
   instance that ignores the note still builds — the note tells it what it is
   opting out of.
3. **Instances merge tags only.** The release flow is: land the change on `main`
   with its CHANGELOG entry → bump `FRAMEWORK-VERSION` and its npm manifest
   mirrors → tag
   `sekai-kb-vX.Y.Z` → push the tag. Instances run `/sekai-upgrade` (or the manual git
   flow in `docs/runbook/UPGRADE.md`), which merges the tag, never `main`.
4. **Instance-owned files are never overwritten.** Files an instance owns
   (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`,
   `AGENTS.md`, `README.md`, `CHANGELOG.md`, adopter-only `VERSION`, `FRAMEWORK-VERSION`,
   `scripts/ci/genericity-denylist.local.txt`, `.agent-toolkit/**`, and the
   maintainer-doc tree `dev_docs/**`) carry
   `.gitattributes merge=ours` on the instance, so a tag merge keeps the
   instance's copy. Framework changes to those paths are therefore inert on
   instances by design — do not rely on them propagating. The attribute protects
   *content on a path that exists on both sides and differs from the merge base*;
   it does not preserve an absent path (the upgrade's classify/reconcile pass owns
   that), and it does not fire on a file the instance has not edited since the
   merge base (which is why `FRAMEWORK-VERSION` is captured and restored instead).

## [Unreleased]

### Added

- **On-demand OG image worker (`workers/og/`).** Per-article social-preview cards
  rendered with Satori and resvg-wasm, cached at the Cloudflare edge. The worker
  fetches article metadata from the site's own `topics.json` and renders title,
  category, and site name with each category's accent color. A bundled Latin-subset
  Inter font keeps the deployed bundle inside the free-tier limit without R2.
- **`place.config.ts` gains `features.og` and `workers.og`.** `SEO.astro` emits the
  worker URL as the `og:image` when both are set; every other combination falls back
  to the static `og-default.png`.
- **`gen-worker-config.mjs` derives per-worker `[vars]`** for `SITE_ORIGIN`,
  `SITE_NAME`, and `CATEGORY_COLORS`, extending the feedback worker's `ALLOWED_ORIGIN`
  pattern to a second worker.
- **Runbook:** `docs/runbook/DEPLOY.md` gains an OG worker subsection with the deploy
  command, vars table, route registration, and cache-purge instructions.
- **Corpus embeddings (`npm run embeddings:build`).** `scripts/core/build-embeddings.mjs`
  chunks every `knowledge/` article at roughly 300-500 words on `##` heading boundaries,
  embeds each chunk with `@cf/baai/bge-m3` through the Workers AI REST API, and writes
  `workers/chat/vectors.json`: int8-quantized unit vectors (a consumer's dot product is
  cosine) plus per-chunk `{id, slug, title, url, category, heading, chunkIndex, text}`
  metadata, under a versioned `rag-v1` manifest. This is the retrieval substrate the chat
  worker, the MCP `semantic_search` tool, and the refresh pipeline all read.
- **The embedding index is derived and gitignored.** It carries every article's title,
  URL, and body text, so it is rebuilt at deploy time rather than committed to `workers/`.
  Both machine gates skip it by name, and `npm run worker-config:check` now fails if a
  `vectors.json` — or any generated worker artifact — is tracked by git.
- **`npm run test:embeddings`** covers the chunker's splitting rules, the int8
  quantization round-trip, the Workers AI request contract against a stubbed `fetch`, and
  the zero-chunk coverage failure. It runs in CI and needs neither network nor credentials.
- **Runbook:** `docs/runbook/DEPLOY.md` gains a Corpus embeddings subsection with the two
  environment variables, the minimum API-token scope, when to re-run, the free-tier neuron
  budget, and where the credentials live (the environment, never the repository).
- **`.env` and `.dev.vars` are gitignored.** Nothing in the framework reads either file —
  credentials reach Cloudflare through `wrangler secret put` and reach the embedding build
  through the environment. They are ignored because `.dev.vars` is wrangler's conventional
  local-secret path and `.env` is everyone else's, so a token parked in one for convenience
  is never stageable.

> **Upgrade note:** `features.og` and `workers.og` are config-schema additions.
> Both are absent-safe: missing keys leave OG on the static `og-default.png`
> fallback, so no config edit is required on upgrade. To enable per-article OG
> cards, deploy `workers/og/` per the runbook, then set both keys.

## [1.1.1] — 2026-08-04

This patch corrects the v1.1.0 upgrade note, which described a maintainer-doc relocation merge that does not occur, and rebuilds the fixture that let the false claim ship.

### Fixed

- **Corrected the v1.1.0 upgrade note, which described a merge that does not happen.**
  v1.1.0 told instances that relocating their own maintainer documents to `dev_docs/`
  before merging the tag would make the old paths "a clean two-sided delete" and the new
  tree "an add/add that the `ours` driver resolves". Both halves are wrong.

  Against a merge base carrying the *framework's* document at the old path, the framework's
  move is a high-similarity **rename** while the instance's move is a **delete plus an
  unrelated add** — the two documents share almost no text, which is ADR 008's whole
  premise. Rename on one side and delete on the other is a **rename/delete conflict**, and
  git applies **no merge driver** to those, so `merge=ours` is never consulted. The real
  upgrade produces one conflict per owned maintainer-doc path plus `.gitattributes`.

  This mattered beyond accuracy: an instance told to expect a clean merge, then facing a
  dozen conflicts, may resolve with `--theirs` and silently replace its own PRD, SPEC, and
  ROADMAP with the framework's — the exact loss ADR 008(f) exists to prevent.

  ADR 009(g) is rewritten to describe the real shape and to state the resolution: **take
  `ours` for every conflicted path under `dev_docs/`**, and `git rm` the paths conflicted
  only because the framework carried a record the instance never had.

- **`check-upgrade-state.sh` case 9 now asserts that the relocation conflicts.** The
  fixture wrote one-line documents whose similarity profile made git pair *both* sides as
  renames, yielding a tidy add/add that the driver resolved. The case passed while
  modelling a merge that cannot occur, which is how the false claim above reached a
  release. Fixture documents now carry long, side-specific bodies so the rename-detection
  asymmetry is real, and the case fails if the relocation ever merges cleanly — because
  that would make the upgrade documentation wrong again.

### Upgrade note

Supersedes the v1.1.0 note. The relocation steps are unchanged — `git mv` to `dev_docs/`,
declare `dev_docs/** merge=ours`, commit, *then* merge the tag — but **expect conflicts**,
and expect two distinct classes of framework file to deal with.

**1. Conflicted paths** — one per maintainer doc you own, plus `.gitattributes` and the
package manifests. Take yours:

```
git checkout --ours -- <each conflicted path you own under dev_docs/>
```

For a conflicted path you never owned (a framework record that lived at the old path),
`git rm` it. **Never `--theirs` on a path you own** — that is how an instance loses its own
PRD, SPEC, and ROADMAP to the framework's.

**2. Silent additions** — a framework file whose path is *new* (this release's ADR 009 and
the four `dev_docs/research/` files) does not conflict at all. It arrives as a one-sided
add and will not appear in the conflict list. `/sekai-upgrade`'s reconcile pass reports
every one; delete the ones you do not want as part of the adoption commit.

Verified end to end against a real instance holding its own documents at all four legacy
paths: 9 conflicts under `dev_docs/` plus 3 outside it, and 5 silent additions.

## [1.1.0] — 2026-08-04

This release relocates the framework maintainer documents to dev_docs/, adds the ported platform research and the constraints promoted from it, and makes every phase exit gate state its instance-adoption step.

This release moves the framework's own maintainer documents out of `docs/` into a
dedicated `dev_docs/` tree, ports the phase-7-through-11 platform research in beside them,
promotes the hard platform constraints into the SPEC, and makes each phase's exit gate
state its adoption step explicitly.

### Changed

- **Framework maintainer docs moved to `dev_docs/` (ADR 009).** `docs/PRD.md`,
  `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/adr/`, and `docs/diagrams/` are now
  `dev_docs/PRD.md`, `dev_docs/SPEC.md`, `dev_docs/ROADMAP.md`, `dev_docs/adr/`, and
  `dev_docs/diagrams/`. `docs/` now holds only `playbook/` and `runbook/` — the two
  adopter-facing trees — so `docs/` is adopter-facing by definition and `dev_docs/` is
  maintainer-only by definition.

  The strip declaration in `scripts/init/writer.mjs` collapses from four enumerated paths
  to the single directory `dev_docs`, which is the point: a maintainer document added
  later lands on the correct side of adoption without editing any list. The previous shape
  had already failed once silently — `docs/diagrams/` was never on the list, so every
  adopted instance received `.drawio` sources for the framework's own architecture.

- **`docs/diagrams/` is no longer shipped to adopters.** The three `.drawio` files document
  the framework's repo topology, build pipeline, and instance/framework split. They are
  maintainer state and are now stripped at adoption with the rest of `dev_docs/`. Existing
  instances keep whatever they already have; nothing is deleted from an instance by this
  release.

- **`merge=ours` collapses to `dev_docs/** merge=ours`.** One attribute line replaces the
  four maintainer-doc lines plus the separate `docs/baselines/**` line. It protects an
  instance's own planning documents, decision records, and captured baselines — including
  ones added after the line was written.

### Added

- **`dev_docs/research/`** — the platform research behind phases 7 through 11, ported
  de-placed at full fidelity from the pre-cut instance's archives: `platform-notes.md`
  (Workers, RAG, OG, delivery, and the autonomous-layer audit), `upstream-reference.md`
  (the prebuild pipeline, graph force parameters, routine cadence and lifecycle,
  article-health dimensions), `origin-decisions.md` (the reasoning behind the framework's
  shape), and `OMISSIONS.md`, which records every dropped passage against the non-goal that
  excludes it.

- **Hard platform constraints promoted into `dev_docs/SPEC.md`.** §Stack now records that
  Workers AI's `bge-m3` runner returns only the dense vector and Vectorize indexes neither
  sparse nor multi-vector representations — so native hybrid search is unavailable on this
  platform at any scale — that Workers are TypeScript and never Python, and that the chat
  generation model is chosen at packet time rather than pinned from archived research.
  §Negative requirements now requires corpus vectors and the search index to be parsed once
  into worker global scope, because parsing per request consumes most of the free plan's
  CPU budget.

- **`npm run roadmap-gates`** (`scripts/ci/check-roadmap-exit-gates.mjs`) — asserts that
  every ROADMAP milestone row's exit gate states the release tag, the instance adoption,
  and the maintainer confirm, and that every packet it cites is defined by a real task
  block. Template mode only; an adopted instance skips it. Ships with
  `npm run roadmap-gates:selftest`, which requires the guard to reject seven planted defect
  classes.

- **Every phase 6-11 now has a terminal adoption packet.** 6.4 and 9.3 already existed;
  7.4, 8.3, 10.3, and 11.9 are new. Adoption into instance #1 was always part of the exit
  gate in prose, but four of six rows never said so and four phases tracked no adoption
  work at all.

### Fixed

- **The wizard's own emitted text is now scanned for dangling paths.**
  `check-framework-docs.mjs` exempts `scripts/init/writer.mjs` from its dangling-reference
  scan, because a strip mechanism must name what it strips — which meant the `AGENTS.md`
  and `README.md` bodies the wizard *emits* were never checked. `scripts/init/check-init.sh`
  now asserts that the really-stripped tree contains no occurrence of any stripped path,
  with a planted inverse proving the assertion can fail.

- **`check-upgrade-state.sh` case 9 now models a relocated declaration.** Its previous form
  constructed mixed ownership by owning one declared path and not another, which a
  single-directory declaration cannot express. It now models the upgrade this release
  performs: the pre-merge wizard declares the old paths, the merged tree declares the new
  one, and the union is the mixed set. `first_doc_file` derives a concrete file from a
  directory entry rather than requiring a `*.md` entry.

### Upgrade note

**An instance that keeps its own documents at the old maintainer-doc paths must relocate
them before merging this tag, in the same branch.**

```
git mv docs/PRD.md docs/SPEC.md docs/ROADMAP.md docs/adr docs/diagrams docs/baselines dev_docs/
```

Then replace the `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/adr/**`, and
`docs/baselines/**` lines in `.gitattributes` with a single `dev_docs/** merge=ours`, commit
that, and only then run `/sekai-upgrade`.

**The order matters.** Relocating first makes the old paths a clean two-sided delete and the
new tree an add/add that the `ours` driver resolves in your favour; the reconcile pass then
recognises your relocated tree as owned because it existed at the pre-merge revision.
Merging first and relocating afterwards produces modify/delete conflicts that `merge=ours`
does not resolve, because git applies no merge driver to them.

An instance adopted by the wizard has none of these paths and needs no action: its
maintainer-doc state is absent before and after.

Note that the merge adds the framework's own `dev_docs/` files alongside yours wherever the
filenames differ (the framework's ADRs, its research port). `/sekai-upgrade` reports every
such addition; delete the ones you do not want as part of the adoption PR.

## [1.0.20] — 2026-08-03

This patch strips recording capture metadata during soundscape ingest and rejects metadata-bearing or mislabeled sound files at validation.

### Fixed

- **Soundscape ingest no longer publishes the recording's capture metadata.**
  Consumer phones write capture coordinates (to roughly ten metres), capture
  timestamp, device make and model, and OS version into the audio container.
  `ffmpeg` copies input metadata to its output by default and Astro copies
  `public/` into `dist/` byte-for-byte, so every clip added with
  `npm run sounds:add` was publishing all of it, and an adopter recording near
  home was publishing their home coordinates. `npm run sounds:add` now writes
  every published file through ffmpeg with metadata, chapter, and ID3 writing
  disabled. mp3 input is re-muxed (`-c:a copy`, so the audio frames are unchanged
  and nothing is re-encoded) rather than copied byte-for-byte, which makes ffmpeg
  an **unconditional prerequisite** of the script rather than one only non-mp3
  input needed. There is no opt-out flag: the manifest's `location` field is the
  place description readers see, and shipping exact coordinates underneath it
  contradicts that field's purpose.
- **`npm run sounds:check` rejects a published file that carries a metadata tag.**
  Hand-placing a file into `public/media/sounds/` and hand-writing its manifest
  entry is a supported path that bypasses the script, so fixing only the writer
  would have left the class open. The gate now scans every file under
  `public/media/sounds/` at any depth, whatever it is named — Astro publishes a
  file because of where it sits, not what its extension says — and fails on an
  ID3v2 tag, an ID3v1 trailer, an APE footer, or one of six recognized non-mp3
  container signatures (RIFF/WAVE, ISO base media, Ogg, FLAC, AIFF,
  Matroska/WebM), which is how a recording renamed rather than converted is
  caught. Recognition is a positive signature match, not a test for MPEG audio, so
  a container outside that list is not detected as one; the alternative would
  break an adopter's build over a valid but unusual mp3. Each finding names the
  file and the tag form, and adds the offending frame identifiers when the tag
  exposes a readable frame area — an ID3v1 trailer, an APE footer, and an ID3v2
  tag behind an extended header carry no frame list to name, and are findings all
  the same. The rule is absolute rather than a denylist of sensitive fields,
  because the page reads every displayed field from the manifest and never from
  the audio file. The scan reads the container in JavaScript
  (`scripts/lib/mp3-tags.mjs`, shared with the writer so the two cannot drift) and
  needs no ffmpeg, so it runs unchanged in every adopter's `postbuild` chain and
  in this repository's CI build job, neither of which has one. (CI's test job does
  install ffmpeg, but only so the writer's suite can exercise the real
  conversion.) Self-test coverage at `npm run sounds:selftest` grew from five
  planted defect classes to ten: one per tag container, one for a renamed
  container, and one proving the walk does not filter on a file's name.
- The three synthesized demo clips under `public/media/sounds/` were re-muxed to
  drop the encoder tag ffmpeg had written into them. Their audio is unchanged.

**Upgrade note.** The fix is not retroactive: recordings ingested before this
release keep whatever their capture device wrote, and `npm run sounds:check` will
now fail on them. For each affected file, either re-run `npm run sounds:add` on
the original recording, or strip the committed file in place with

```
ffmpeg -i <file>.mp3 -map_metadata -1 -map_chapters -1 -id3v2_version 0 -c:a copy <stripped>.mp3
```

and commit the result. Run `npm run sounds:check` to list the affected files.
Instances with no soundscape recordings need no action. ffmpeg is now required
for `npm run sounds:add` with any input format, including mp3; it is not required
to build or to run the gate.

## [1.0.19] — 2026-08-03

Soundscape ingest tooling: npm run sounds:add converts and places audio, npm run sounds:check validates manifest entries, and docs/playbook/SOUNDSCAPE-PLAYBOOK.md documents the workflow.

### Added

- **Soundscape ingest script** (`npm run sounds:add`): converts and places audio into `public/media/sounds/`, appends a schema-valid YAML entry to the manifest. Strictly additive; preserves surrounding bytes. Requires ffmpeg on PATH for non-mp3 input.
- **Soundscape validation gate** (`npm run sounds:check`): imports field arrays from `src/lib/sounds.ts`, exits nonzero on missing required fields, unresolved files, path escapes, or duplicate category ids. Wired into postbuild and CI. Self-test at `npm run sounds:selftest`.
- **Soundscape playbook** (`docs/playbook/SOUNDSCAPE-PLAYBOOK.md`): documents the record, convert, add, verify, commit workflow and the hand-editing path.

No upgrade note required (no config-schema change, no instance action required).

## [1.0.18] — 2026-08-02

Generate deploy-time Worker configs from place.config.ts, add CI guards for placeholder-only committed templates, and document the Worker and D1 rename path.

### Fixed

- **Worker deploy configs are generated from `place.config.ts`, not committed.**
  `workers/feedback/wrangler.toml` carried three values that are deployment
  identity — the Worker script `name`, the D1 `database_name`, and
  `ALLOWED_ORIGIN` — inside a tree both machine gates scan for exactly that.
  Worker and D1 names are **account-scoped**, so every instance was deploying
  under the framework's `sekai-feedback`: a second instance in the same Cloudflare
  account overwrites the first's script and rebinds it to the second's database,
  and the public `workers.dev` URL carried the framework's name rather than the
  place's. The runbook told adopters to commit their real origin into that file,
  which the denylist gate then failed as soon as the origin contained their place
  name.

  The committed `wrangler.toml` is now a template carrying placeholders only, and
  `npm run worker-config` (`scripts/deploy/gen-worker-config.mjs`) writes the
  effective `workers/<worker>/wrangler.generated.toml` from `place.config.ts`.
  Names derive as `<place-slug>-<worker-directory-name>`, where `<place-slug>` is
  `place.name` lowercased with every run of non-`[a-z0-9]` characters collapsed to
  `-` and truncated to 40 characters; `ALLOWED_ORIGIN` comes from `place.domain`;
  `database_id` comes from the new optional `place.config.ts` key
  `workers.feedbackDatabaseId`. `main`, `compatibility_date`, the D1 `binding`,
  `migrations_dir`, and the rate-limit vars carry through from the template
  unchanged. The generated file is gitignored, and both machine gates skip it by
  name because it is derived and place-specific by design.

  A new gate, `npm run worker-config:check`
  (`scripts/ci/check-worker-config.mjs`), asserts every committed
  `workers/*/wrangler.toml` still carries the framework placeholders and that no
  generated config is tracked by git. It catches what the place-name denylist
  cannot: a committed origin or worker name whose text contains no denylisted term
  at all. It runs in the `genericity` CI job alongside its non-vacuity self-test
  (`npm run worker-config:selftest`), and it fails in an adopter's checkout too,
  which is the point.

  `docs/runbook/DEPLOY.md` §Cloudflare Workers is rewritten around `--config`
  (a global Wrangler flag accepted by `deploy`, `d1 create`, and
  `d1 migrations apply`), states the derivation rule and that `npm run init` does
  nothing for `workers/`, and no longer claims an instance owns
  `workers/feedback/wrangler.toml` — no path under `workers/` carries
  `merge=ours`, and after this change the file is genuinely framework-owned and
  unedited. The `/sekai-triage-feedback` skill now resolves its database through
  the generated config.

  **Upgrade note.** New `place.config.ts` key `workers.feedbackDatabaseId`
  (optional, absent-safe: unset generates an empty `database_id` and a note).
  An instance that already deployed the feedback worker under the framework's
  `sekai-feedback` names is renaming, so re-deploy under the derived names:

  1. `npm run worker-config` and read the derived `<worker-name>` from its output.
  2. `npx wrangler d1 create <worker-name>`, then put the id it prints in
     `place.config.ts` as `workers.feedbackDatabaseId` and regenerate.
  3. `npx wrangler d1 migrations apply <worker-name> --remote --config workers/feedback/wrangler.generated.toml`.
  4. `npx wrangler secret put IP_HASH_SALT --config workers/feedback/wrangler.generated.toml`
     (secrets are per-Worker; the new script has none).
  5. `npx wrangler deploy --config workers/feedback/wrangler.generated.toml`, then
     set `workers.feedback` in `place.config.ts` to the new URL and rebuild the
     site.
  6. Delete the old Worker and database once the new endpoint answers:
     `npx wrangler delete --name sekai-feedback` and
     `npx wrangler d1 delete sekai-feedback`. Existing rows do not migrate; export
     anything you still need from the old database first
     (`npx wrangler d1 execute sekai-feedback --remote --command "SELECT * FROM feedback" --json`).

  An instance that has **not** deployed the worker needs no action beyond the
  merge: the template's placeholders are the state it already has.

## [1.0.17] — 2026-08-02

Adds the /soundscape page, the /sekai-snippet and /sekai-triage-feedback skills, and a feedback widget over a new workers/feedback Worker; extends the denylist gate to workers/; and repairs the dark theme plus two tooling defects.

### Fixed

- **Route-wide dark theme repair.** Fixed white surfaces and dark-on-dark text
  on `/`, `/latest`, `/dashboard`, `/about`, `/contribute`, and `/changelog` in
  dark mode. All affected surfaces now resolve through `tokens.css` design tokens
  (`--color-surface-raised`, `--color-bg-alt`, `--color-ink-heading`,
  `--color-border-visible`) rather than hardcoded hex values. Shared components
  (`ArticleCard`, `FeatureCards`, `CategoryGrid`, `ReaderDoors`, `CoverStory`,
  `RecentUpdates`, `ContributeSection`) use token-bound colors so the fix stays
  shared across pages.

  A new browser-backed regression guard (`npm run test:theme`) asserts computed
  background and text colors on every named surface in dark mode. It runs in the
  CI build job after `npm run build` and fails on light-only backgrounds or
  dark-on-dark text. No adopter action required: token additions are additive and
  the new test runs only in the framework CI workflow.

### Added

- **`/soundscape` layout: manifest categories, a card grid, per-category
  wishlists, and a contribute block.** The page was a single-column stack of
  cards; it now reads as a collection. The hero carries a stats line (recordings,
  wanted, categories), each category is an anchored `<section id>` with an icon
  and a heading, its recordings render in a responsive `auto-fill` grid with a
  ~280px minimum, and each category can declare the sounds it still wants and a
  link to one article. A contribute block with numbered steps and a call to
  action for `/contribute` closes the page. No `<script>` was added: the page
  still ships zero client JavaScript of its own, and `<audio controls
  preload="none">` is still the whole player.

  The manifest schema is **additive**. `knowledge/sounds/_manifest.md` now accepts
  an ordered `categories` list — each category requiring `id`, `icon`, `title`,
  accepting optional `article`, and carrying its own `sounds` list plus an
  optional `wishlist` whose entries carry `icon`, `text`. A recording still
  requires `title`, `location`, `credit`, `file`, and now accepts optional
  `description`, `icon`, `contributor`, `contributorUrl`, `date` alongside them.
  `src/lib/sounds.ts` normalizes both shapes into one structure and applies the
  same skip-one-keep-the-rest discipline to a malformed category and a malformed
  wishlist entry that it already applied to a malformed recording.

  A category's `article` is validated at build time against the routes the build
  actually produces (static pages, category hubs, and article routes). One that
  resolves to nothing is dropped with a warning naming the category, so the page
  cannot ship a link into a 404 — and the post-build internal-link check cannot
  fail the whole build over one manifest typo.

  `scripts/ci/check-soundscape-schema-docs.mjs` (`npm run schema-docs`, run in CI)
  derives all five field lists from `src/lib/sounds.ts` and fails when
  `docs/SPEC.md` or the manifest's own body disagrees with the reader, so the
  documented schema cannot drift from the code that implements it.

  Every colour the page renders now resolves through the theme tokens in
  `src/styles/tokens.css`. This fixes a live defect: in dark mode the previous
  page painted white cards on a near-black body (`card=rgb(255,255,255)` on
  `body=rgb(5,5,5)`) with a barely legible hero. It now measures
  `card=rgb(20,20,24)`, `card title=rgb(241,245,249)`, `hero=rgb(241,245,249)`.

  **Upgrade note:** the schema is additive and no instance action is required. An
  existing manifest that declares a top-level `sounds` list keeps rendering
  untouched — it normalizes to one implicit category that renders no heading, so
  the page looks as it did apart from the theme fix and the contribute block. To
  adopt categories, edit `knowledge/sounds/_manifest.md` alone: replace the
  top-level `sounds:` list with a `categories:` list whose entries carry `id`,
  `icon`, `title` and their own `sounds:` list, and add a `wishlist:` (entries of
  `icon`, `text`) or an `article:` route per category where you want them. A
  top-level `sounds` list is ignored, with a build-time warning, if `categories`
  is also declared — move those entries into a category rather than keeping both.

- **`/soundscape`: a native HTML5 audio page over a `knowledge/sounds/`
  manifest.** `src/pages/soundscape.astro` +
  `src/templates/soundscape.template.astro` render one
  `<audio controls preload="none">` per manifest entry. No player library and no
  client framework ship with it: the browser's own transport is the player, and
  nothing crosses the wire until a reader presses play.

  The manifest is `knowledge/sounds/_manifest.md` — gray-matter frontmatter
  carrying a `sounds` list of `{title, location, credit, file}` plus an optional
  `date`, with the body free for human notes. The leading `_` is mandatory: it is
  what makes the file invisible to the three scanners that walk `knowledge/`
  looking for articles (`scripts/core/test-frontmatter.mjs`,
  `scripts/tools/article-health.py`, `scripts/core/build-content-dates.mjs`).
  `src/lib/sounds.ts` reads it with `readFileSync` + `try/catch` and normalizes
  any `date` to an ISO-8601 string at the boundary.

  Every degradation keeps the build green. No `knowledge/sounds/` at all and an
  empty list both render the documented empty state; an entry whose `file` is
  missing under `public/` is dropped with a build-time warning naming it while
  every other entry still renders. `npm run test:soundscape` gates all of that in
  CI. `features.soundscape` gates only the Header and Footer entry points — the
  page itself always builds, exactly as `/map`, `/graph`, and `/dashboard` do.

  The template ships three short synthesized demo clips under
  `public/media/sounds/`, each credited as synthesized rather than as a field
  recording of anywhere, so the player and the page's visual bar are provable in
  the repository that ships them. `npm run init` removes them, and
  `npm run init:check` asserts the removal against a tree the wizard really
  stripped.

  **Upgrade note:** this release adds files under two instance-owned paths,
  `knowledge/sounds/_manifest.md` and `public/media/sounds/*.mp3`. `merge=ours`
  protects an instance's *content on a path that exists on both sides*; it does
  not stop a clean add, so merging this tag lands the framework's demo manifest
  and demo clips in your tree. They are the demo place's content, not yours —
  delete both after the merge:

  ```sh
  rm -rf knowledge/sounds public/media/sounds
  ```

  Nothing else is required: `features.soundscape` stays absent-safe and defaults
  to `false`, and with no manifest the page renders its empty state. To turn the
  page on, set `features.soundscape: true` in `place.config.ts`, write your own
  `knowledge/sounds/_manifest.md`, and put your audio under `public/media/sounds/`.

  `docs/SPEC.md` §Pages now enumerates the route list under a derivation gated by
  `scripts/ci/check-framework-docs.mjs`: adding a page under `src/pages/` without
  amending that sentence now fails CI, which is the drift this entry would
  otherwise have introduced.

- **`/sekai-snippet`: short-form drafts, a human-gated queue, and a manual-sink
  runner.** The framework-owned skill reads exactly one `knowledge/` article,
  writes a platform-neutral draft carrying no claim that article does not make,
  and appends it to `knowledge/SNIPPET-INBOX.md` as `status: pending`. Approval is
  a human edit of that file to `approved` and nothing else — the runner reads
  `approved` entries only, so a draft nobody has read is unreachable from the
  publish path. `npm run snippet:publish` then publishes through an adapter and
  writes back `posted` plus the returned URL; `pending`, `posted`, and `rejected`
  entries are left untouched.

  The platform-adapter interface is one file,
  `scripts/tools/snippet/adapter.d.ts`: `{ id, maxChars, publish(draft) }`, with
  no registry, no loader, and no credential handling. **No platform adapter
  ships**, by rule — the first one arrives when a real instance has an account on
  that platform. The only shipped sink is a manual one that prints the approved
  text for the operator to paste and records the URL they paste back, which is
  what makes `posted` reachable in the meantime. An entry over the adapter's
  `maxChars` is refused with a message naming the entry and the overage, never
  truncated, and stays `approved` for a shortened rerun. Because the manual sink
  waits on a human, the runner re-reads the queue when it finishes and re-applies
  only the `status` and `url` lines it published, so an entry appended or edited
  mid-run is never overwritten; a change to an entry it published is reported with
  the live URL and written back by hand rather than merged. The format contract is
  gated by `npm run test:snippet` in CI; `scripts/tools/snippet/README.md`
  documents the interface.

  No **Upgrade note**: the skill, the runner, and the npm scripts are additive,
  and no `place.config.ts` key changed. A freshly adopted instance has no queue
  file at all — `npm run init` reseeds `knowledge/` with category folders and
  `INBOX.md` only — so the skill creates `SNIPPET-INBOX.md` on first use by
  copying `scripts/tools/snippet/queue-template.md`, which survives adoption
  because it lives under `scripts/`.

- **`/sekai-triage-feedback` turns new D1 feedback into deduplicated GitHub
  issues.** The framework-owned skill reads `status='new'` rows through Wrangler,
  assigns exactly one of five documented classes, groups normalized duplicates,
  and either creates a `feedback`-labeled issue or comments on the matching open
  issue from `place.config.ts` `links.repo`. It records the resulting issue URL
  through `workers/feedback/migrations/0002_triage.sql`; spam is recorded without
  filing an issue. Dry-run and live execution share the same complete plan, and
  no GitHub or D1 write runs until the human explicitly approves that plan.

  **Upgrade note:** instances that already deployed the feedback Worker must apply
  the new D1 migration before running the skill:

  ```bash
  cd workers/feedback
  npx wrangler d1 migrations apply <database-name> --remote
  ```

- **Feedback widget on article pages (`src/components/FeedbackWidget.astro`).** An
  article-bottom button opens the form in an accessible modal, keeping the full form
  hidden until a reader asks for it. The message field displays and enforces the
  Worker's 10-to-4,000-character requirement before submission.
  Vanilla JS, no client framework: it posts `{page, category, message, contact}`
  plus a hidden honeypot to the `workers/feedback/` endpoint and renders one of
  four end states — success, a validation error naming the field the endpoint
  rejected, rate-limited, and a catch-all for an unreachable endpoint, a rejected
  origin, or a server fault. The trap field is off-screen, `aria-hidden`, and out
  of the tab order; a `<noscript>` block falls back to `links.email`. Every string
  lives in `src/i18n/ui.ts`. The widget renders only when `features.feedback` is
  true **and** `workers.feedback` is a non-empty string, so a flag switched on
  before the worker is deployed produces no markup rather than a form that posts
  nowhere. Operator steps: [DEPLOY.md §Cloudflare
  Workers](docs/runbook/DEPLOY.md).
- **`place.config.ts` gains `workers?: {feedback?: string}`,** the deployed
  endpoint URL. It is place identity (it names this instance's deployment), so
  under iron rule 2 it may live only in config; the init wizard prompts for it with
  a blank default, since the worker is deployed after adoption. The `place.config`
  top-level section list and the `features` flag list are now derived from
  `place.config.ts` and gated by `scripts/ci/check-framework-docs.mjs`, so the next
  key that is added without updating the SPEC enumeration fails CI.

  **Upgrade note:** one new optional config key. Nothing to do — a config without
  a `workers` block keeps the feedback widget off, exactly as before. To turn it
  on, deploy the worker and follow step 5 of DEPLOY.md §Cloudflare Workers.
- **`workers/` — the framework's first Cloudflare Worker tree, starting with
  `workers/feedback/`.** A POST endpoint backed by D1 that stores reader feedback:
  CORS locked to a single deploy-time `ALLOWED_ORIGIN` (never `*`; an unset var or a
  mismatch is 403), a honeypot field that returns a real-looking success and writes
  nothing, a per-address rate limit of `RATE_LIMIT_MAX` per genuinely rolling
  `RATE_LIMIT_WINDOW_SECONDS` (submissions are counted per second and the seconds
  age out individually, so no counter reset lets a second allowance through at a
  window boundary, and a refused attempt gives its slot back so a client that waits
  out `Retry-After` is let in rather than locked out for good), and full payload
  validation enforced against the request
  stream so an oversized chunked upload is a 400 rather than a buffered Worker
  crash. Addresses are only ever stored as `sha256(address + IP_HASH_SALT)`;
  a missing salt fails the request closed rather than hashing unsalted. The schema
  ships as a D1 migration (`feedback` + `submission_window`), `wrangler.toml` carries
  placeholders only, and the `node:test` unit suite runs in CI as `npm run
  test:workers`. Operator steps are in
  [DEPLOY.md §Cloudflare Workers](docs/runbook/DEPLOY.md). CI never deploys a worker;
  `npx wrangler` is the documented path, so no platform-specific binary enters the
  lockfile.

### Changed

- **The place-name denylist gate now scans `workers/` in instance mode.** Its
  instance-mode roots become `src/`, `scripts/`, `tests/`, `workers/`,
  `.agents/skills/` — the same five the English-only gate already scanned. Before
  this, a denylisted place string under `workers/` was unguarded on an adopted
  instance. The two gates still derive and state their root sets independently, so
  either can gain a root without the other. `scripts/ci/check-skills-gated.sh` now
  plants its place-string and CJK fixtures under `workers/feedback/` as well as
  `.agents/skills/sekai-kb/`, proving in instance mode that each root is actually
  reached by the scan rather than merely listed in `SCAN_ROOTS`.

### Fixed

- **`article-health` no longer treats a root-level `knowledge/*.md` workflow queue
  as an article.** `is_article_path` documented its contract as
  `knowledge/{Category}/*.md` but accepted any `.md` anywhere under `knowledge/`,
  so a staged `knowledge/INBOX.md` — and now `knowledge/SNIPPET-INBOX.md` — was
  linted as an article, reported a hard violation for having no frontmatter, and
  the pre-commit hook refused the edit. Eligibility is now structural (the file
  must sit in a category directory), covering any future root-level workflow doc,
  and `--staged` routes through the same predicate instead of duplicating it.
  `--all` was already correct, which is why this only ever surfaced at commit time.

- **The visual-baseline page list no longer hardcodes place-specific URLs.**
  `scripts/visual/capture-baseline.mjs` sampled `/trails/top-of-the-world/` for its
  `article` page and `/history/` for its category hub — both pre-cut slugs, so
  `npm run visual:check` could not be green in the template (the article does not
  exist in the demo corpus) and would break in any instance whose articles and
  categories differ. Both are now derived: the `article` sample is the
  lexicographically first `href` in `src/data/latest.json` and the hub is the first
  configured category, so the list is correct for every place by construction. The
  sample is deliberately NOT the newest article — `latest.json` is date-ordered, so
  "newest" would change the moment an article ships and a baseline captured before
  it would diff against a different page. Both derived URLs are printed on every
  run and recorded in the baseline manifest. The `hub-history` page key is now `hub`.

  **Upgrade note.** Local visual baselines do not carry over: the captured files are
  named per page key, so an existing `reports/visual/baseline/hub-history-*.png` no
  longer pairs with the `hub-*.png` this writes, and the `article` sample may now be
  a different article than the one your baseline captured. Recapture once after
  upgrading with `npm run visual:baseline`; nothing else changes, and the PNGs are
  gitignored so no commit is involved. An instance passing `--pages=hub-history`
  updates that token to `hub`.

## [1.0.16] — 2026-07-29

This release runs every upgrade helper from the target release tag, so a release that changes a helper applies its own fix on the upgrade that ships it.

### Fixed

- **The upgrade bootstraps every helper from the target tag, never from the instance's
  working tree.** Steps 3, 3b, and 4 of `/sekai-upgrade` and both flows in
  `docs/runbook/UPGRADE.md` used `test -f scripts/upgrade/<helper>.mjs || git show
  "$TARGET":...`, so an in-tree copy always won. That is correct when a helper is merely
  *absent* and wrong whenever a release *changes* one: the tree's copy shipped with the
  release the instance is leaving, so the fix never applied on the upgrade that shipped
  it. v1.0.15 is the concrete case — it added the `FRAMEWORK-VERSION` capture to
  `package-state.mjs`, and an instance on v1.0.11 following the documented procedure
  verbatim ran its own pre-capture copy, captured nothing, restored nothing, and left the
  marker claiming a release no build had verified. The extraction is now unconditional
  for all three helpers; a `$TARGET` that predates a helper fails loudly on `git show`
  instead of silently running an older one. `docs/runbook/UPGRADE.md` gains a **Helper
  version skew** section stating the rule, and `scripts/upgrade/check-upgrade-state.sh`
  gains case 13: 13a derives the bootstrap form from both adopter-facing documents so
  the retired shape cannot return in prose, and 13b drives the skew end to end against a
  framework whose earlier tag ships a helper without `FRAMEWORK-VERSION` handling,
  pinning that the retired tree-first form loses the marker where the documented form
  keeps it.

  **Upgrade note.** No instance action is required and no configuration changed. If you
  have the previous bootstrap lines pasted into your own notes or scripts, replace the
  `test -f` form with the unconditional `git show "$TARGET":scripts/upgrade/<helper>.mjs`
  extraction shown in `docs/runbook/UPGRADE.md`.

## [1.0.15] — 2026-07-29

This release hardens first-upgrade maintainer-doc classification, preserves FRAMEWORK-VERSION through merges, repairs adopter-facing upgrade references, and records cross-repository lifecycle routing.

The maintainer-doc upgrade path works on a first upgrade, `FRAMEWORK-VERSION` survives the merge, and the adopter-facing upgrade documents resolve.

### Fixed

- **`classify` can derive its path set on the first upgrade that introduces it.**
  `scripts/upgrade/maintainer-docs-state.mjs classify` gains `--from-tag <tag>`, which
  takes the `MAINTAINER_DOCS` derivation from the release being merged while still
  reading path **presence** from the pre-merge working tree. Extracting the helper out
  of the tag was never enough on its own: the helper reads `scripts/init/writer.mjs`,
  and on exactly the upgrade that introduces the strip list the instance's copy still
  predates the export, so `classify` exited 3 and the classification the whole pass
  depends on could not be produced at all. `/sekai-upgrade` step 3b and
  `docs/runbook/UPGRADE.md` now pass the flag on every `classify`. `reconcile`
  **rejects** it (exit 2): reconciliation must derive from the merged tree, because that
  is how a merge which did not bring the framework's wizard through is exposed rather
  than papered over by reading the tag instead. Options are declared per command in one
  table the parser and the documentation guard both read.
- **`FRAMEWORK-VERSION` keeps its value through the merge.** It is marked `merge=ours`,
  and that was never sufficient: a merge driver runs only on a three-way content merge,
  so an instance that has not edited the file since the merge base has `ours == base`
  and git fast-forwards the incoming value straight in — the file claimed the new
  release before anything had verified it, contradicting the documented flow.
  `scripts/upgrade/package-state.mjs` now captures the pre-merge value alongside the
  adopter's npm-manifest fields and restores it immediately after the merge, amending
  the merge commit when git auto-committed. An instance that had no `FRAMEWORK-VERSION`
  keeps having none. The explicit post-verification bump is unchanged in placement but
  now **asserts** the resulting value rather than assuming its write took effect.
  That helper's entry-point check also gained the `realpathSync` resolution its sibling
  already had, without which running it from the copy the upgrade extracts into `.git`
  was a silent no-op on any path reached through a symlink.
- **Adopter-facing upgrade references resolve.** `docs/runbook/UPGRADE.md` cited a
  `§G risk 4` section lettering and a `SPEC §place.config.ts absent-safe rule` document
  location that no longer exist; both now name the framework SPEC section that owns
  them (§Risk controls "Two-repo drift", §Negative requirements "New `place.config`
  keys must be absent-safe") and point at the upstream repository an adopter can
  actually reach. The `/sekai-upgrade` skill carried the same stale citation and is
  fixed with it.

### Added

- **The maintainer-doc paths ship as `merge=ours`.** `docs/PRD.md`, `docs/SPEC.md`,
  `docs/ROADMAP.md`, and `docs/adr/**` are now declared instance-owned in the
  framework's `.gitattributes`, and `docs/runbook/UPGRADE.md`'s instance-owned table
  records them with their rationale. They are inert for a wizard-adopted instance,
  which has nothing at those paths; they matter for an instance that keeps its **own**
  product, architecture, delivery, or decision records there, which ADR 008 explicitly
  allows. Shipping the attribute means such an instance is protected from its first
  merge onward instead of having to remember to add it.
- **The adopter-facing instance-owned lists are machine-derived.**
  `scripts/ci/check-framework-docs.mjs` now registers `docs/runbook/UPGRADE.md`'s table
  and the `/sekai-upgrade` skill's step 4 list against `.gitattributes`, alongside the
  SPEC and ADR 006 restatements it already checked. Both survive adoption, so they are
  checked for containment rather than equality in an adopted clone, where an adopter's
  `.gitattributes` legitimately grows paths the framework's documents do not list. A
  registered enumeration is also masked out of the dangling-reference scan, so a
  surviving document can record that `docs/PRD.md` is a path an instance may own
  without that being read as a link into a stripped file. Five new planted defect
  classes and two new legitimate states are in `--selftest`.
- **Regression coverage for both fixes, in CI.**
  `scripts/upgrade/check-upgrade-state.sh` gains case 11 (a first-upgrade fixture whose
  wizard predates `MAINTAINER_DOCS`, where `classify` without the flag must exit 3 and
  `--from-tag` must still produce the classification) and case 12 (`FRAMEWORK-VERSION`
  held at its pre-merge value through the merge and moved only by the explicit bump,
  with sub-case 12b covering the auto-commit/amend shape and 12c the pre-wizard
  instance that had no `FRAMEWORK-VERSION` and must not gain one). Each pins the
  underlying defect with a fixture guard before asserting the fix, and `--selftest`
  non-vacuity extends to all of them. Two option-contract checks close the loop: one
  asserts `reconcile` rejects `--from-tag`, and one checks the options the two upgrade
  documents tell a user to pass, per invoked command, against the helper's own option
  table — scoped to that literal and carrying a non-vacuity probe, since the helper's
  source is full of single-quoted git arguments a whole-file grep would wrongly report
  as accepted CLI options.

**Upgrade note.** Nothing to do. Both fixes are in the upgrade path itself and take
effect on the upgrade that adopts this release: the first-upgrade hard stop and the
premature `FRAMEWORK-VERSION` move are gone. If you keep your own documents at the
maintainer-doc paths, the four new `merge=ours` lines arrive with this release, so you
no longer need to maintain them by hand — an existing hand-added copy is harmless.
Follow `docs/runbook/UPGRADE.md` as written: `classify` now takes
`--from-tag "$TARGET"`, and `FRAMEWORK-VERSION` deliberately still reads your old
version until the final bump step.

## [1.0.14] — 2026-07-29

The framework maintainer-doc gate accepts an instance that keeps its own documents at those paths.

### Fixed

- **The maintainer-doc gate no longer rejects an instance that owns documents at those
  paths.** `scripts/ci/check-framework-docs.mjs` treated every mention of
  `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, or `docs/adr/` as a dangling
  reference and checked its registered statements against whatever file sat at those
  paths — correct for a wizard-adopted clone, which really has none of them, but wrong
  for an instance that keeps its own planning documents there. That instance was told to
  remove the `merge=ours` lines that protect those very documents. In instance mode the
  gate now treats a maintainer-doc path **present** in the checkout as instance-owned and
  excludes it from both checks, using the same presence signal `reconcile` uses to
  classify a path `owned`. Template mode is unchanged and still exhaustive, and a
  wizard-adopted instance whose paths are genuinely absent still fails on a dangling
  reference — both are now planted cases in `--selftest`, which additionally asserts two
  legitimate instance-owned states pass.

**Upgrade note.** Nothing to do. If you kept your own documents at those paths and saw
`npm run framework-docs` fail after adopting v1.0.12 or v1.0.13, this release fixes it;
no change to your `.gitattributes` is needed, and the four `merge=ours` lines remain
required.

## [1.0.13] — 2026-07-29

/sekai-upgrade classifies and reconciles framework maintainer-doc state per path, and the upgrade-state harness covers both helpers.

### Added

- **`/sekai-upgrade` classifies and reconciles maintainer-doc state.**
  `scripts/upgrade/maintainer-docs-state.mjs` is the sibling of the dev-plugin state
  helper: `classify` records, before the merge, which of the framework's maintainer-doc
  paths this instance carries, and `reconcile` applies that answer immediately after.
  Classification is **per path** — these paths have no activation signal and are mutually
  independent, so an instance may own one and not the others, and a partial set is a
  normal state rather than a stop. A path you do not have stays absent across shared and
  unrelated history; a path you own is asserted byte-for-byte unchanged, never deleted,
  and framework files the merge adds underneath it are reported for you to decide.
  The path set is derived at runtime from the init wizard's own strip list — the same
  single source `npm run framework-docs` derives from, whose parser now lives with the
  upgrade helper so there is one derivation rather than two.
- **Upgrade-state regressions cover both helpers.**
  `scripts/upgrade/check-upgrade-state.sh` gains five maintainer-doc cases (stripped on
  shared history, stripped on an unrelated-history first merge, fully owned, partially
  owned, and owned-but-unprotected in two shapes), each an independent disposable git
  repository, with fixtures derived from the wizard rather than restated.
  `--selftest` non-vacuity extends to the new reconcile-dependent cases: with reconcile
  skipped, each must fail.

### Changed

- **Adopter documentation states the maintainer-doc contract.** The `/sekai-upgrade`
  skill gains the classify and reconcile steps, and `docs/runbook/UPGRADE.md` gains the
  copy-pasteable equivalent plus a per-path state table, in both the first-merge and
  routine flows.

**Upgrade note.** Nothing to do. The manual clean-up that v1.0.12 asked wizard-adopted
instances to perform after every merge is now automatic: the upgrade removes the
framework's maintainer documents itself and never commits them into your instance.

- **If your instance keeps its own documents at any of those paths**, the requirement is
  unchanged and still yours to meet *before* merging: mark them `merge=ours` in
  `.gitattributes`, and confirm `git config merge.ours.driver true` in that clone (it is
  per-clone and not version-controlled). The upgrade now detects the omission and stops
  with both repairs named, rather than letting the framework's copy overwrite your
  document — but it does not perform the repair for you.

## [1.0.12] — 2026-07-28

Moves framework maintainer documents beside the code they govern and strips them from adopter clones.

Moves the framework's own product, architecture, and delivery documents into this
repository and keeps them out of adopter clones.

### Added

- **Framework maintainer docs.** `docs/PRD.md` (what the framework is for, who adopts
  it, north star, non-goals), `docs/SPEC.md` (stack, repo topology, `place.config.ts`,
  content model, build pipeline, pages, new builds, phase 9-11 extension capabilities,
  risk controls, negative requirements), `docs/ROADMAP.md` (the phase 6-11 task blocks
  `/dev:plan` converts packets from), and ADRs 003-007, which govern framework code and
  moved here keeping their numbers and filenames. **ADR 008** records the split: the
  ownership boundary, the wizard strip, the `merge=ours` requirement for an instance that
  already has documents at those paths, and why the tracker stays a single project.
  Phases 0-5, the extraction map, the inherited-fork disposition, and ADRs 001-002 are
  the first instance's rebuild history and stay in its repository.
- **`npm run framework-docs`** — the maintainer-doc gate, wired into the CI genericity
  job with a self-test that plants seven defect classes and requires each to fail. It
  derives the stripped-path list from the wizard, the instance-owned `merge=ours` list
  from `.gitattributes`, and the prebuild/post-build job lists from `package.json`, then
  fails on any prose that disagrees with its source or on any file an adopter keeps that
  links into a stripped path.

### Changed

- **`npm run init` strips the framework maintainer docs.** `docs/PRD.md`,
  `docs/SPEC.md`, `docs/ROADMAP.md`, and `docs/adr/` are removed at adoption, the same
  class as `.agent-toolkit/`: they describe how the framework is built, never how an
  instance is operated. `docs/playbook/` and `docs/runbook/` are untouched.
  `scripts/init/check-init.sh` asserts both halves on a tree the wizard really stripped,
  then re-runs the same predicate against planted inverse fixtures so an all-absent
  assertion cannot pass vacuously.
- Adopter-facing prose that cited a framework decision record by section now points at
  the upstream repository instead (`docs/runbook/UPGRADE.md`, the `/sekai-upgrade` skill,
  `scripts/init/README.md`), so nothing an adopter keeps refers to a document adoption
  removed.

**Upgrade note.** This release adds four paths under `docs/` that some instances already
use for their own documents.

- **If your instance has its own `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, or
  `docs/adr/`:** add them to your `.gitattributes` as `merge=ours` **before** merging
  this tag, or the merge will conflict with — or overwrite — your documents.

  ```
  docs/PRD.md merge=ours
  docs/SPEC.md merge=ours
  docs/ROADMAP.md merge=ours
  docs/adr/** merge=ours
  ```

  The `ours` driver is per-clone and not version-controlled, so confirm
  `git config merge.ours.driver true` in that clone as well.
- **If your instance was adopted through `npm run init` and has none of those paths:**
  the merge adds the framework's copies as new files. They are framework-development
  state, not yours — delete them after the merge and commit the deletion.
  `/sekai-upgrade` does not classify maintainer-doc state in **this** release the way it
  classifies dev-plugin state, so this step is manual here. **Superseded:** the next
  release automates it (see that entry's Upgrade note); this instruction applies only
  when v1.0.12 is the tag you are merging.

## [1.0.11] — 2026-07-28

Ships a guard-or-explain doctrine rule for prose that drifted from code.

### Added

- **Doctrine: guard-or-explain for prose that drifted from code.**
  `.agent-toolkit/rules/guard-or-explain-prose-drift.md` requires a task whose
  objective is correcting a stale statement about the code to ship a machine
  guard deriving the value from its source, or to name why one is infeasible or
  already exists. Dev-plugin state only: the init wizard strips
  `.agent-toolkit/`, so adopters inherit nothing from this change.

## [1.0.10] — 2026-07-26

Adds an end-to-end guarded framework release workflow covering version and changelog preparation, verification, PR merge, lightweight tag publication, and branch cleanup.

### Added

- **`/sekai-framework-release`** now cuts framework releases end to end: guarded
  version and changelog preparation, full verification, release PR and green-CI
  merge, lightweight `sekai-kb-vX.Y.Z` tag publication, and branch cleanup. Its
  deterministic helper preserves `pyproject.toml` as independent internal tooling
  metadata and changes only the four framework release files.

## [1.0.9] — 2026-07-26

Corrects cross-agent skill discovery and establishes separate adopter and framework release
ownership.

### Changed

- **Framework skills moved to the shared agent namespace.** All skills now live
  under `.agents/skills/`, and their folder names, YAML names, invocation names,
  and cross-skill references use the `sekai-` prefix. Codex discovers the
  standard path natively; `AGENTS.md` tells Claude Code to discover metadata
  there and load a full `SKILL.md` only when it triggers. The genericity and
  English-only gates now scan the new tree.

  **Upgrade note:** remove the old `.claude/skills/` tree when adopting this
  release. Use `/sekai-adopt`, `/sekai-seed-articles`, `/sekai-write`,
  `/sekai-validate`, `/sekai-factcheck`, `/sekai-kb`, `/sekai-upgrade`, and
  `/sekai-release` after the upgrade.

- **Framework and adopter npm manifests now mirror their respective release
  SSOTs.** The Sekai template no longer carries `VERSION`; its
  `package.json.version` and lockfile root versions mirror `FRAMEWORK-VERSION`.
  Init creates adopter `VERSION` and sets the adopter manifest versions from it.
  CI rejects drift. The new `npm run release:bump -- patch|minor|major` command and
  `/sekai-release` skill let an adopter maintainer prepare a release explicitly, without
  versioning routine article PRs. The bump command preserves every non-version
  byte in both npm manifests.

  **Upgrade note:** the first upgrade from v1.0.8 keeps the adopter's `VERSION`
  when the framework deletes its mistaken template copy. `/sekai-upgrade` now captures
  adopter package identity before merging, takes incoming framework scripts and
  dependencies, and restores adopter name, description, privacy, and version
  fields afterward. This package reconciliation is required on every upgrade
  because the manifests have mixed ownership.

## [1.0.8] — 2026-07-26

Separates adopter release identity from adopted framework identity and removes
framework release numbers from the private npm manifest.

### Changed

- **Framework and adopter versions now have separate file SSOTs.**
  `FRAMEWORK-VERSION` identifies the Sekai release and replaces
  `package.json.version` in the framework release procedure. `VERSION` identifies an
  adopter's own release and carries `merge=ours`. The private npm manifest has no
  release version. Init writes adopter-specific package name and description,
  initializes `VERSION` to `v0.0.0`, and preserves the checked-out
  `FRAMEWORK-VERSION`. CI validates the two version domains and the private package
  contract.

  **Upgrade note:** existing adopters add `VERSION merge=ours`, create `VERSION` with
  their own release number, remove `package.json.version`, set `private: true`, and
  remove the corresponding root version fields from `package-lock.json`. Keep the old
  `FRAMEWORK-VERSION` during the tag merge; `/upgrade` bumps it after verification.

## [1.0.7] — 2026-07-26

Separates framework and adopter changelogs, protects the instance's adopted
framework marker during merges, and pins the framework's dev-plugin validation
contract to its declared release.

### Changed

- **Adopted instances now own their changelog.** The template keeps this file as the
  framework release log, but `npm run init` replaces it with a deterministic
  instance-only changelog and `.gitattributes` protects it with `merge=ours`.
  `/upgrade` continues to read framework notes directly from the target tag, so it does
  not need or overwrite the instance log. Init and upgrade regression checks enforce
  the split. `FRAMEWORK-VERSION` is now merge-protected too; `/upgrade` remains its
  explicit writer after verification.

  **Upgrade note:** before adopting the release containing this change, an existing
  instance that wants an instance-only changelog must add `CHANGELOG.md merge=ours` to
  its `.gitattributes` and replace copied framework history with its own record. Commit
  both changes before running `/upgrade`.

- **The required dev-plugin release is explicit and CI-guarded.**
  `.agent-toolkit/dev.md` frontmatter now declares the action repository and
  release. `npm run dev-plugin:check` verifies every `check-rules` workflow
  reference against that declaration, and CI now uses `dev-v0.0.72`.

## [1.0.6] — 2026-07-25

Moves category colors into instance configuration, makes genericity scan-root
documentation machine-checked, and replaces the vendored dev-plugin rule checker
with the upstream pinned composite action.

### Changed

- **Category colors are now instance-owned.** The slug-keyed `COLOR_PALETTE` in
  `src/utils/categoryConfig.ts` is removed. Colors flow through optional
  `color?` and `colorLight?` fields on each entry in `place.config.ts`
  `categories[]`. Absent fields fall back to a neutral `DEFAULT_COLOR`
  (`#475569` / `#47556920`), so existing adopters build without config surgery.
  The demo place carries its colors inline as an example.

### Removed

- **`.agent-toolkit/scripts/check-rule-registry.mjs` is retired.** The dev plugin
  now ships the rule-discovery checker itself
  (`resolve_project_rules.py --check`, agent-toolkit #37) and packages it as a
  composite action (#39) referenced at an immutable release tag (#38), so the
  framework no longer maintains a second copy of a checker it does not own. The
  `test` job's `Rule registry` step is now a single
  `uses: wilsonkichoi/agent-toolkit/.github/actions/check-rules@dev-v0.0.70`, and
  the `if [ -f .agent-toolkit/dev.md ]` shell guard around it is gone: the action
  performs that detection itself and skips with exit 0 on a repository without the
  config, which is exactly what a `npm run init`-stripped adopter has.
  `.agent-toolkit/scripts/` is removed with its only file.

  Two steps replace the retired `--selftest`, so adopter-side non-vacuity is not
  lost. In `test`, a throwaway fixture carrying one unclassified rule file is run
  through the same pinned action and the workflow asserts it fails with the
  `rules_dir contains unclassified Markdown` diagnostic. In `init-check`, where
  the wizard has just stripped the workspace in place, the action is run against
  that real stripped tree and the workflow asserts `result: skipped` and exit 0.

  The `test` fixture steps carry `if: hashFiles('.agent-toolkit/dev.md') != ''`.
  The gate itself is never guarded; only its non-vacuity proof is, because an
  instance with no dev-plugin state has no rules for that proof to be about and
  should not install a toolchain or depend on an upstream diagnostic string to
  learn it. Adopters running `dev:setup` get the full proof back automatically the
  moment their config exists.

  **Upgrade note:** this is `deploy.yml` only, so it reaches instances through a
  normal tag merge with no adopter action. An instance that carries its own
  `.agent-toolkit/` tree (adopter-owned, `merge=ours`) keeps its copy of the
  retired script through the merge and should delete it in the same commit that
  adopts this release; an instance stripped by `npm run init` has nothing to do —
  its `Rule registry` step skips and the fixture steps do not run at all.

### Fixed

- **Scan-root scope statements now match the gates.** `npm run genericity` runs
  two gates whose instance-mode roots differ — the place-name denylist gate
  (`scripts/ci/check-genericity.sh`) scans `src/`, `scripts/`, `tests/`,
  `.claude/skills/`, and the English-only gate
  (`scripts/ci/check-english-only.mjs`) scans `src/`, `scripts/`, `tests/`,
  `workers/`, `.claude/skills/` — and both scan the whole repository in template
  mode. Eight statements restated those sets wrongly, most by merging them into
  one claim or by omitting `.claude/skills/`: the denylist file header, the
  English-only script's instance-mode comment, the English-only CI step name (it
  omitted `workers/`), `docs/runbook/DEPLOY.md` §Quality gates, `README.md`
  §Genericity, `AGENTS.md` iron rule 2 (which contradicted its own "Skill
  ownership" section), the wizard-emitted instance `AGENTS.md` in
  `scripts/init/writer.mjs`, and the `.sekai-template` marker. Each now states
  the roots per gate; the `check-genericity.sh` "Scan scope" header, already
  correct, was reworded to say which gate its list belongs to.

### Added

- **`scripts/ci/check-scan-root-docs.mjs`** — the guard that keeps the above
  true. It *derives* both root sets from the two gate scripts (the
  `SCAN_ROOTS+=` lines and the `SCAN_ROOTS` array literal) and asserts that all
  21 registered statements enumerate exactly the roots of the gate each one
  describes; changing a script's roots changes what the guard demands, with no
  second edit to the guard. A registered statement that has been reworded or
  moved (its anchor no longer matches) fails rather than silently passing.
  Statements in adopter-owned files (`AGENTS.md`, `README.md`,
  `.agent-toolkit/**`) and in the removed `.sekai-template` marker are required
  in template mode and reported as skipped on an adopted instance, so an
  adopter's own wording never fails their gate. Wired into `npm run genericity`,
  so `test_command` and every local run cover it.
- **`scripts/ci/check-scan-root-docs-selftest.sh`** (`npm run
  genericity:docs-selftest`) — the guard's non-vacuity proof, in the
  `check-skills-gated.sh` idiom: it plants doc drift, script `SCAN_ROOTS` drift,
  and a reworded anchor, requires the guard to fail each time, and restores every
  file it mutates. Both the guard and this self-test run as named steps in
  `deploy.yml`'s `genericity` job.

## [1.0.5] — 2026-07-24

Makes framework upgrades preserve an instance's dev-plugin state in both
directions: an adopter who never wanted the dev workflow stops silently
reacquiring it, and an adopter who installed their own keeps it untouched.

### Fixed

- **`/upgrade` preserves a stripped `.agent-toolkit/` tree.** `merge=ours`
  protects the *content* of a path present on both merge sides; it does not
  preserve a path the instance deliberately deleted. A wizard-adopted instance
  therefore hit a `DU .agent-toolkit/dev.md` modify/delete conflict on a
  shared-history upgrade, and had the framework's whole dev-plugin tree added back
  as theirs-only content on an unrelated-history first tag merge. Dev-plugin
  presence is now persistent instance state that the upgrade classifies before
  merging and reconciles after (ADR 006 addendum, SPEC §Repo topology).

### Added

- **`scripts/upgrade/dev-plugin-state.mjs`** — the framework helper `/upgrade` and
  `docs/runbook/UPGRADE.md` both drive. `classify` prints `stripped` (no
  `.agent-toolkit/` and no active `@.agent-toolkit/dev.md` reference in
  `AGENTS.md`/`CLAUDE.md`) or `installed` (the adopter's `.agent-toolkit/dev.md`
  and the active reference both present), and exits 3 with a diagnostic on an
  inconsistent state — half-installed dev-plugin state stops the upgrade rather
  than being guessed at. `reconcile --state stripped` removes every
  `.agent-toolkit/` path the merge brought in (modify/delete conflicts and
  theirs-only additions alike), drops any reference line the merge introduced, and
  amends the merge commit when the merge already completed, so the framework tree
  is never committed into the instance and the user never resolves a dev-plugin
  conflict by hand. `reconcile --state installed` mutates nothing: it asserts the
  adopter's `.agent-toolkit/**` is byte-for-byte unchanged against the pre-merge
  revision and reports framework paths the merge added, for the user to keep or
  remove.
- **`scripts/upgrade/check-upgrade-state.sh`** — disposable-repository regressions
  for all five states (stripped on shared history, stripped on unrelated history,
  installed, and both inconsistent states), plus a `--selftest` mode that proves
  the suite fails when the reconcile step is skipped. Both run in the required CI
  `test` job (`npm run upgrade:check`, `npm run upgrade:selftest`).

### Changed

- **CI `test` job gates the dev-plugin rule registry when dev-plugin state is
  present.** `.github/workflows/deploy.yml` gains a step that runs
  `.agent-toolkit/scripts/check-rule-registry.mjs` and its self-test, guarded by
  `if [ -f .agent-toolkit/dev.md ]`. The checker asserts every promoted rule under
  the configured `rules_dir` declares a valid `tier` (doctrine / gotcha+trigger /
  none) for the dev-plugin project-bootstrap **discovery** contract (dev 0.0.64+),
  and that the `## Rules` section carries no bare `@path` registry line. The init
  wizard strips the entire `.agent-toolkit/` tree from adopter instances, so on a
  stripped adopter the guard makes the step a clean no-op — the workflow never
  depends on a removed path. The rule files and registry format under
  `.agent-toolkit/**` are instance-owned (`.gitattributes merge=ours`) and inert on
  instances; only this guarded `deploy.yml` step propagates on upgrade, and it
  requires no adopter action.

### Upgrade note

Run this upgrade with `/upgrade` (or the updated `docs/runbook/UPGRADE.md` flow):
both now classify dev-plugin state **before** the merge and reconcile it after.
Releases before 1.0.5 did not ship the helper, so on this one upgrade run it from
the tag, as both flows show:

```sh
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show sekai-kb-v1.0.5:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)"
```

If `classify` exits 3, your instance is in an inconsistent state (a
`.agent-toolkit/` tree with no active `@.agent-toolkit/dev.md` reference, or the
reverse). Repair it deliberately before merging — the diagnostic names both
directions. No `place.config.ts` change and no other adopter action is required.

## [1.0.4] — 2026-07-19

Corrects the v1.0.3 AGENTS.md-as-SSOT rollout so framework development and fresh
adopter instances follow the accepted ADR-006 contract without gaps.

### Fixed

- **Operative framework references now agree on the agent-instruction SSOT.**
  `.agent-toolkit/dev.md` names `AGENTS.md` as the content-bearing instruction
  source and `CLAUDE.md` as its one-line shim. The repository-topology diagram
  carries the same labels and includes `AGENTS.md` plus `.agent-toolkit/**` in
  the applicable instance-owned set.
- **The init self-check enforces the `CLAUDE.md` shim byte-for-byte.** The expected
  output is exactly `@AGENTS.md\n`; regression fixtures reject a trailing blank
  line, a missing final newline, added prose, or any changed byte. The existing
  CI init-check job runs this assertion, including its disposable `--build` tier.
- **Fresh adopter instructions retain the full applicable support contract.**
  Wizard-rendered `AGENTS.md` files now include the language-support boundary and
  the absent-safe semiont probe rule. The init self-check asserts both sections
  and continues to reject template-only and dev-plugin-only content.

### Upgrade note

`AGENTS.md`, `CLAUDE.md`, and `.agent-toolkit/**` are instance-owned, so merging
this tag does not overwrite them. Reconcile the improved `AGENTS.md` starter per
`docs/runbook/UPGRADE.md`: carry over the language-support boundary and semiont
probe if they are absent, keep instance-specific instructions intact, and confirm
that `CLAUDE.md` is byte-for-byte `@AGENTS.md\n`.

## [1.0.3] — 2026-07-19

`AGENTS.md` becomes the single source of truth for agent instructions; `CLAUDE.md`
is reduced to a one-line `@AGENTS.md` shim. Claude Code inlines the shim recursively
(`CLAUDE.md` → `AGENTS.md` → `@.agent-toolkit/dev.md` → doctrine rules) and Codex
reads `AGENTS.md` natively, so both CLIs boot from one document with no instructions
duplicated across or diverging between the two files.

### Changed

- **`AGENTS.md` is the agent-instruction SSOT.** The framework `CLAUDE.md` content
  (place identity, where-things-live, how-the-site-builds, iron rules, skill
  ownership, language boundary, semiont probe, template mode) moved into `AGENTS.md`
  above the dev-plugin sentinel block. The `AGENTS.md` "Read CLAUDE.md — it is the
  boot document" pointer is gone; `CLAUDE.md` is now exactly `@AGENTS.md`. The
  dev-plugin sentinel block and its `@.agent-toolkit/dev.md` reference line stay in
  `AGENTS.md`, unchanged.
- **The init wizard writes the new shape.** `scripts/init/writer.mjs` renders
  `AGENTS.md` place-specifically (the former `renderClaudeMd` content plus the
  content working set) and writes `CLAUDE.md` as the one-line `@AGENTS.md` shim; a
  fresh instance's `AGENTS.md` carries no dev-plugin sentinel block, so no separate
  strip is needed. `scripts/init/check-init.sh` now asserts the `AGENTS.md` header
  and the `CLAUDE.md` shim.
- **Starter reconciliation follows the new shape.** `/upgrade` +
  `docs/runbook/UPGRADE.md` treat `AGENTS.md` (and `README.md`) as the
  content-bearing starters to reconcile on upgrade; `CLAUDE.md` is exempt as a fixed
  `@AGENTS.md` shim.

### Upgrade note

**An instance must mirror this consolidation by hand** — `AGENTS.md`, `CLAUDE.md`,
and `.agent-toolkit/**` are `merge=ours`, so the tag's restructured starters do not
land on your instance automatically. On the merge branch, after merging this tag:

1. Move your `CLAUDE.md`'s content into your `AGENTS.md` (above the dev-plugin
   sentinel block if you keep one), delete any "Read CLAUDE.md — boot document"
   pointer, and reduce `CLAUDE.md` to a single `@AGENTS.md` line.
2. Keep your `AGENTS.md` dev-plugin sentinel block and its `@.agent-toolkit/dev.md`
   reference line intact — that line must NOT sit inside an HTML comment, or Claude
   Code will not inline your dev config through the chain.
3. Confirm `CLAUDE.md` is exactly `@AGENTS.md` and every `@` import target still
   resolves.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's agent-instruction plumbing, not the rendered site.

## [1.0.2] — 2026-07-19

Dev-plugin encapsulation (agent-toolkit 0.0.55) and adopter-owned `AGENTS.md`. The
framework's own development state (dev config + engineering rules) moves into
`.agent-toolkit/`, stops shipping to adopters, and `AGENTS.md` becomes instance-owned
from clone time (LB-41).

### Added

- **sekai-kb adopts the dev plugin** — `.agent-toolkit/dev.md` now carries the
  framework repo's own dev-workflow config (tracker, test command, CI workflow,
  merge policy, `context_file: AGENTS.md`, `rules_dir: .agent-toolkit/rules/`) plus a
  tiered `## Rules` index of the 12 engineering rules. `AGENTS.md` gains a
  dev-plugin reference line; `CLAUDE.md` reaches it via an `@AGENTS.md` shim.

### Changed

- **Engineering rules relocated** from `.claude/rules/` to `.agent-toolkit/rules/`
  and reclassified as **dev-plugin state, not framework content**. They are lessons
  from developing the framework's `src/`/`scripts/`; adopters never touch those
  trees, so shipping them was a mistake. Every `.claude/rules/` reference in code
  comments, `CLAUDE.md`, `README.md`, and the wizard was re-pointed or removed.
- **`.gitattributes` `merge=ours` baseline is now 10 paths** — added `AGENTS.md`
  and `.agent-toolkit/**`. `AGENTS.md` is instance-owned from clone time (its
  starter began as framework boilerplate the instance then personalizes);
  `.agent-toolkit/**` is instance-owned because every repo — the framework and each
  instance — carries its own dev config that a tag merge must never overwrite.
- **The init wizard strips dev-plugin state from adopter clones.**
  `scripts/init/writer.mjs` removes the `.agent-toolkit/` tree and the `AGENTS.md`
  dev-plugin reference line on adoption; `scripts/init/check-init.sh` asserts both
  are absent post-init. A fresh instance ships zero dev-plugin state.
- **`/upgrade` + `docs/runbook/UPGRADE.md` gained a starter-file reconciliation
  step.** `merge=ours` silently discards the framework's changes to instance-owned
  starter files (`AGENTS.md` above all); the upgrade flow now diffs each starter
  against the incoming tag and offers framework improvements conversationally
  instead of dropping them.

### Fixed

- Template `.gitattributes` now ships the full `merge=ours` baseline the docs
  promise: added `CNAME`, `docs/baselines/**`, and
  `scripts/ci/genericity-denylist.local.txt` (all wizard-written), so a
  template-cloned adopter's `CNAME` + local denylist are protected without hand
  edits (LB-33 review S1).
- `docs/runbook/UPGRADE.md` demo-article cleanup uses `ORIG_HEAD` (the pre-merge
  tree `git merge` records at merge start) instead of `HEAD@{1}`, which resolved
  to an arbitrary reflog entry while the establishment merge was still uncommitted
  and could `git rm` an instance's own article (LB-33 review S2).
- `/upgrade` skill + `UPGRADE.md` CHANGELOG-excerpt command uses an `awk` range
  that stops before the next `## [` heading instead of a `sed` range that printed
  it as trailing noise (LB-33 review N1).

### Upgrade note

**An instance must migrate its own dev-plugin layout BEFORE merging this tag**, or
the template-side deletion of `.claude/rules/` collides with the rule files the
instance still has there. Do this on the merge branch, in order:

1. Add the two new `merge=ours` lines to your instance `.gitattributes`
   (`AGENTS.md`, `.agent-toolkit/**`) — this must precede the merge, or the tag's
   `.agent-toolkit/dev.md` (the framework's config) would land on your instance.
2. Relocate any rules you keep from `.claude/rules/` into your `rules_dir`
   (`.agent-toolkit/rules/`) and remove `.claude/rules/`. The template-side rule
   deletions then merge clean (both sides removed the path).
3. Run `dev:setup` (agent-toolkit ≥ 0.0.55) so your `.agent-toolkit/dev.md` carries
   `context_file` + `rules_dir` and a `## Rules` index; add the `AGENTS.md`
   reference line and the `CLAUDE.md` `@AGENTS.md` shim.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's dev-workflow plumbing, not the rendered site.

## [1.0.1] — 2026-07-18

### Changed

- **`docs/runbook/UPGRADE.md`** — the merge-base establishment step now covers
  demo-content cleanup: `merge=ours` protects files an instance already has but
  does not stop theirs-only `knowledge/` articles from being *added*, so an
  existing instance re-basing onto the framework must strip the template's demo
  articles. Documents the `comm`-based list-and-remove and clarifies the
  `merge=ours` add-vs-overwrite distinction.

### Upgrade note

Docs only — no config or code contract changes. Nothing to do.

[1.0.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.1

## [1.0.0] — 2026-07-18

First tagged framework release: the complete Phase-5 sekai-kb template, cut from
its origin instance and genericized to ship zero place content. An adopter runs
`/adopt` on a fresh clone and reaches a deployed site; the first instance re-bases
onto this tag.

### Added

- **Adoption path** — `/adopt` AI-interview skill (the primary bootstrap), the
  `npm run init` wizard (single writer of `place.config.ts`, `CNAME`, the
  `CLAUDE.md`/`README.md` headers, `FRAMEWORK-VERSION`, and the instance-owned
  genericity denylist), and `/seed-articles` for first content.
- **Content-lifecycle skills** — `/write`, `/validate`, `/factcheck`, and a
  router skill under `.claude/skills/`, all config- and playbook-driven with no
  place identity baked in.
- **`SystemDiagram.astro`** — config-driven animated architecture diagram
  (`/system` page); renders from `place.config.ts` with a brand-circle fallback
  when no `boundary.geojson` is present, and dims feature loops that are off.
- **Docs** — `docs/playbook/` (ARTICLE / REWRITE-PIPELINE / FACTCHECK-PIPELINE),
  `docs/runbook/DEPLOY.md`, framework `CLAUDE.md` + `AGENTS.md`.
- **Release discipline** — this `CHANGELOG.md`, the `/upgrade` skill, and
  `docs/runbook/UPGRADE.md` (tagged-release upgrade flow + merge-base mechanics).
  The `merge=ours` mechanism requires `git config merge.ours.driver true` per
  clone (the `ours` driver is not built into git); `/upgrade`, the runbook, and
  the `.gitattributes` header all set/document it.

### Changed

- **Genericity + English-only gates** now scan `.claude/skills/` in addition to
  `src/`, `scripts/`, `tests/`, and run whole-tree in template mode (gated on the
  `.sekai-template` marker) vs. code-trees-only in instance mode.
- **`article-health`** editorial linter hardened across Phase 5 (At-a-Glance
  blockquote, chronicle-lead, footnote/cross-reference rules) and its
  `EDITORIAL_REF` strings re-pointed to `docs/playbook/`.
- **`package.json`** `version` set to `1.0.0`; the init wizard now records
  `FRAMEWORK-VERSION` as `v${version}` so wizard-written and `/upgrade`-written
  values share the `vX.Y.Z` form.

### Upgrade note

First release — nothing to upgrade from. The first instance establishes its merge
base against this tag per `docs/runbook/UPGRADE.md` §Establishing the merge base.

[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/sekai-kb-v1.1.1...HEAD
[1.1.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.1
[1.1.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.0
[1.0.20]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.20
[1.0.19]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.19
[1.0.18]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.18
[1.0.17]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.17
[1.0.16]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.16
[1.0.15]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.15
[1.0.14]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.14
[1.0.13]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.13
[1.0.12]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.12
[1.0.11]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.11
[1.0.10]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.10
[1.0.9]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.9
[1.0.8]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.8
[1.0.7]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.7
[1.0.6]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.6
[1.0.5]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.5
[1.0.4]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.4
[1.0.3]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.3
[1.0.2]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.2
[1.0.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.1
[1.0.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.0
