# `npm run init` — the adoption wizard

The single writer of place identity. Interactive prompts (or a non-interactive
answers file) produce `place.config.ts` plus every adoption artifact; the same
answers always produce **byte-identical** output, whichever mode ran.

```sh
npm run init                                 # interactive
npm run init -- --answers answers.json       # non-interactive (the /adopt path)
npm run init -- --answers '{"place":{...}}'  # inline JSON also accepted
```

## What it writes

| Artifact | Behavior |
| --- | --- |
| `place.config.ts` | Regenerated in full from the answers. Single writer: the interactive and `--answers` paths share one resolution table and one serializer, so they cannot drift. |
| `knowledge/{Category}/` + `knowledge/INBOX.md` | Demo content is removed; one folder per chosen category (with `.gitkeep`) plus a fresh INBOX.md are seeded. |
| `CNAME` | Written with the domain. A `*.github.io` domain skips it (and removes a stale one) — GitHub Pages default domains must not carry a CNAME. |
| `CLAUDE.md` | Instance header block: place name, domain, tagline, plus the standard where-things-live / build / iron-rules sections. Instance-owned; edit freely. |
| `FRAMEWORK-VERSION` | The framework version (template `package.json` `version`) this instance adopted; `/upgrade` reads it. |
| `scripts/ci/genericity-denylist.local.txt` | The adopter's place name (lowercased, plus its no-space form) as **instance-owned** gate terms. `check-genericity.sh` reads this file additively; the framework denylist is never touched, so upgrades never conflict. Appends idempotently if the file already exists. |
| `.sekai-template` | Removed: the genericity/English-only gates revert from whole-tree (template mode) to code-trees-only (instance mode). |

**Re-run guard:** on an established instance (no `.sekai-template` marker and
articles already under `knowledge/`) the wizard aborts, because it reseeds
`knowledge/` with empty category folders. Pass `--force` to proceed anyway.

## Prompts

All prompts live in `prompt-table.mjs` as data rows — see "Extending" below.

| # | id | asks for | default |
| --- | --- | --- | --- |
| 1 | `place.name` | Place name (site wordmark) | *(required)* |
| 2 | `place.tagline` | One-sentence tagline | derived from name |
| 3 | `place.domain` | Domain (drives CNAME) | `<name-slug>.github.io` |
| 4 | `place.locale` | Locale code (`en` is the supported baseline) | `en` |
| 5 | `categories` | Preset menu (`coastal-town`, `city`, `small-town`) or custom entry; 5-14 categories, kebab-case slugs, reserved routes rejected | `coastal-town` |
| 6 | `map.center` | Leaflet center as `lat,lng` | *(required)* |
| 7 | `map.zoom` | Initial zoom (1-19) | `13` |
| 8 | `map.maxBounds` | Pan bounds as `south,west,north,east` | center ± 0.05/0.07° |
| 9-16 | `features.*` | One y/n per toggle: `graph`, `map`, `dashboard`, `soundscape`, `feedback`, `chat`, `social`, `analytics` | graph/map/dashboard on, rest off |
| 17 | `links.repo` | Instance GitHub repository URL | placeholder URL |
| 18 | `links.email` | Contact email | `hello@<domain>` |
| 19-21 | `links.social.*` | `twitter`, `threads`, `instagram` handles (blank = none; `@` added if missing) | none |

**Derived, never prompted:** `place.languages` = `[locale]`;
`seo.defaultOgImage` = `/og-default.png`; `seo.twitterHandle` mirrors the
Twitter handle when given; **`home.*` ships generic defaults** computed from
the place name and categories — no prompt walks the home-page copy. Replace it
by hand in `place.config.ts` (instance-owned), or let `/adopt` draft
place-specific copy behind the same human-approval gate as `/seed-articles`.

## Answers JSON (the `/adopt` contract)

Keys mirror the prompt ids (dot-paths). Any missing non-required key takes the
same default an interactive user gets by pressing Enter. Unknown **keys** (a
typo'd path is rejected, never silently defaulted) and malformed values are
hard errors (exit 1) — `/adopt` must not half-initialize.

```json
{
  "place": {
    "name": "Harborview",
    "tagline": "Open-source knowledge base for Harborview.",
    "domain": "harborview.example.com",
    "locale": "en"
  },
  "categories": "coastal-town",
  "map": {
    "center": [35.102, -120.658],
    "zoom": 13,
    "maxBounds": [[35.05, -120.72], [35.16, -120.58]]
  },
  "features": { "graph": true, "social": false },
  "links": {
    "repo": "https://github.com/example/harborview",
    "email": "hello@harborview.example.com",
    "social": { "twitter": "@harborview" }
  }
}
```

`categories` accepts a preset name (string) or a full array of
`{ slug, title, icon, description }`. Titles become `knowledge/{Title}/`
folder names, so path separators and control characters are rejected.
`place.name` and `map.center` are required; everything else defaults.

## Extending (schema-driven prompts)

Adding a future prompt — `features.mcp` (Phase 9), an analytics ID (Phase 10) —
is **a table entry in `prompt-table.mjs`, not new flow code**: add a row with
`id` (the config dot-path, which is also the answers-JSON path), `question`,
`kind` (`text`/`number`/`boolean`/`latlng`/`bounds`/`handle`/`categories`),
`default`, and optional `validate`. Both input modes, validation, and the
serializer pick the new field up from the row — including a row that opens a
**new top-level section** (e.g. `analytics.ga4`): the emitted config is
assembled from the resolved answers, not from a fixed key list, so nothing
else in the flow needs touching. The one companion edit is the `PlaceConfig`
interface block in `writer.mjs` (schema, not flow code). New keys must follow
the absent-safe spec rule: default to feature-off when missing.

## Self-check (`npm run init:check`)

`check-init.sh` is the wizard's contract test, wired into CI (`init-check` job):

- **Tier 1** (always; non-destructive; tests the *committed* tree via
  `git archive HEAD`): runs `--answers` init on two scratch copies and
  byte-compares the two `place.config.ts` outputs; runs the **interactive**
  mode (piped stdin) with the same answers on a third copy and byte-compares
  it against the `--answers` output (the cross-mode no-drift contract);
  asserts every seeded artifact; plants a place-name string in `src/` and
  asserts the genericity gate fails via the local denylist, then passes once
  removed.
- **Tier 2** (`--build`; **destructive** — runs init in the current working
  tree, then `npm run build`): CI/disposable clones only.
