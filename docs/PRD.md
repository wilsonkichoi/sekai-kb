# PRD: Sekai KB

**Framework maintainer document.** This is the product-intent SSOT for **sekai-kb**, the
knowledge-base framework. Architecture and implementation contracts live in
`docs/SPEC.md` and `docs/adr/`; phase order and task blocks live in `docs/ROADMAP.md`.
Conflicts resolve per the precedence rule in `.agent-toolkit/dev.md`.

> **Stripped at adoption.** `npm run init` removes this file along with `docs/SPEC.md`,
> `docs/ROADMAP.md`, and `docs/adr/`. It describes the framework's own product intent,
> not an adopted instance's. Adopters keep `docs/playbook/` and `docs/runbook/`, and
> write their own product docs if they want them (ADR 008).

## Goal

**Sekai KB** is a framework for standing up a design-quality, AI-native knowledge base
about a place: curated articles across a configured category set, a knowledge graph, a
map, and static knowledge endpoints that any AI can consume without cloning the
repository. Brand: Sekai, the Japanese word for "world" — the framework is the
world-level system, and each adopted instance is one place in it (ADR 002, held in
instance #1's history).

An adopter goes from a fresh clone of the GitHub template to a configured, seeded,
deployed site in under an hour, and keeps that site maintainable at a real editorial bar
with any agent CLI. The framework is generic by construction: no place identity exists in
any code tree, and the guarantee is machine-enforced rather than asserted.

## Why

The framework was cut from a working instance, not designed in the abstract, and the
sequencing was itself a decision (ADR 002):

- **Framework-first with zero instances repeats the coupling mistake in mirror image.**
  A framework with no live consumer accumulates features no one needs and abstractions
  nothing tests. sekai-kb was extracted from a running site at Phase 5, after four phases
  of building that site, so every abstraction had a real consumer before it was generic.
- **Instance-first with "extraction later" is the deferral trap.** The extraction was a
  numbered phase, sequenced ahead of the features the maintainer personally wanted most,
  with genericity CI-enforced from day one rather than cleaned up at cut time.
- **The cost being avoided is structural, not incidental.** The predecessor codebase was
  a fork of a knowledge base built for a different place. Its last upstream merge took
  three phases of place-removal work and left dozens of files still hardcoding place
  strings. That maintenance cost was unbounded; a bounded extraction plus a tagged-release
  upgrade discipline (ADR 004) replaces it.

## Who adopts it

| Adopter | What they get |
|---|---|
| A person or group publishing knowledge about one place | GitHub template + `/sekai-adopt` AI interview → configured, seeded, deployed site in under an hour (SPEC `New builds`); the editorial playbook and quality tooling that keep it good afterward |
| Readers of an adopted instance | Curated, fact-checked local knowledge at the inherited editorial bar; graph, map, and client-side search |
| AI consumers of an adopted instance | `/llms.txt` → `/kb/topics.json` → `/kb/articles/{slug}.md`: a lazy-loading knowledge protocol, one HTTP request per article, no clone required (SPEC `Build pipeline`); tool-using MCP clients reach the same corpus over one remote MCP connection (`workers/mcp/`, Phase 9, ADR 005) |
| Instance contributors | Plain-Markdown SSOT under `knowledge/`, quality tooling (article-health, link and frontmatter checks), and a tracker-driven contribution workflow |
| Instance operators | An optional autonomous operations layer (Phase 11 routines) that maintains the instance without burnout, shipping only through verified PR merges |
| Framework maintainers | One template repository, an immutable-tag release train, and a genericity gate that fails CI rather than a convention that erodes |

## North star

Phase-gated proof points rather than a single metric. Each is a ROADMAP exit gate:

- **Adoption:** a fresh clone through the `/sekai-adopt` interview to five AI-seeded
  articles deployed on GitHub Pages in under one hour, executed for real against a place
  the framework was never built for. Proven at the framework cut and re-proven whenever
  the adoption path changes.
- **Upgrade:** an instance adopts each framework release by merging an immutable tag,
  cleanly, with instance-owned files untouched and `FRAMEWORK-VERSION` bumped only after
  the merged site verifies (ADR 004; part of every phase's exit gate).
- **Genericity:** the machine gates pass in template mode over the whole tree, so the
  template provably ships zero place-specific strings and zero CJK codepoints.
- **Operations (extension, ADR 005):** two autonomous routines live for at least one week,
  shipping only via verified PR merges with zero direct pushes to main.

## Non-goals

Non-goals bound the product; they never shrink a task. If a task packet's DoD appears
to conflict with a non-goal, surface the conflict to the maintainer (per
`.agent-toolkit/dev.md`), never silently trim the packet.

- **No paid hosting or infra services** (SPEC `Deployment`): GitHub Pages + Cloudflare
  free tier + Workers free tier only. AI compute for development and Phase-11 routines
  rides an existing Claude subscription or API budget — the same cost class as the
  development process itself, not an infra service (ADR 005).
- **No direct-push automation**: routines never bypass the PR + CI gate; the inherited
  fork's push-to-main routine model is explicitly not adopted (ADR 005).
- **No fork continuation and no upstream merging** — improvements to the codebase the
  framework was extracted from are deliberate idea cherry-picks, never merges.
- **No build-time OG generation, ever** — a static default image until the Phase 7
  on-demand worker (SPEC `Build pipeline`).
- **Not carrying the inherited fork's scale machinery**: the four-tier translation
  cascade, batch translation system, place-politics data-viz pages, and social-harvest
  apparatus are deleted or rebuilt from concept. That disposition is instance #1's
  rebuild history and stays in its repository.
- **No framework features for hypothetical adopters**: a framework feature exists only if
  a real instance uses it or it is one of the named adopter needs; everything else waits
  for a second real adopter to ask (SPEC `Risk controls`). "A future adopter might want
  it" is never a reason to build or retain a feature.
- **English-only through the current roadmap**: the framework ships English-only — no
  CJK or multi-language code paths, language profiles, or CJK test fixtures anywhere in
  committed code or tests (`src/`, `scripts/`, `tests/`, `workers/`, `.agents/skills/` —
  the whole project, never a single-directory reading). Test fixtures are code, and so
  are agent-executed skills. Multi-language support is a post-project revisit, built
  fresh at that time. For adopters the boundary is documented, not coded around: tooling
  is English-calibrated, Latin-script content largely works, CJK is unsupported until
  that revisit — stated plainly in the adopter docs.
- **Semiont is optional**: the site must build with the `semiont/` directory deleted;
  every organ beyond the minimal core is opt-in (ADR 003).
- **The framework does not own an instance's content, identity, or history.** Place
  identity flows only through `place.config.ts`, `knowledge/`, and `public/media/`; an
  instance's changelog, version, and agent instructions are instance-owned and survive
  every upgrade (ADR 006, ADR 007).
