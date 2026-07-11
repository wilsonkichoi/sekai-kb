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

## Quick start

```sh
# 1. Create your repo from this template (GitHub "Use this template"), then:
git clone <your-repo> && cd <your-repo>
npm install

# 2. Run the demo place locally
npm run dev            # http://localhost:4321

# 3. Make it your own (rewrites place.config.ts, clears the demo content)
npm run init
```

`npm run init` is the adoption wizard: it asks for your place name, categories, map
center, and feature toggles, writes `place.config.ts`, and removes the
`.sekai-template` marker so the genericity gates switch from template mode
(whole-tree scan) to instance mode (code-tree scan). Then add your articles under
`knowledge/{Category}/` and deploy.

## What's in the box

- **`place.config.ts`** — the single ingress for place identity (name, categories,
  map, features, links, home-page copy).
- **`knowledge/`** — your content, one folder per category. The single source of truth.
- **`src/` + `scripts/`** — the framework: templates, build pipeline, prebuild/postbuild
  contract checks. Framework-owned; customize through config and content, not by editing.
- **`scripts/tools/`** — the Python `article-health` editorial linter (runs via
  [uv](https://docs.astral.sh/uv/); Python ≥ 3.12).
- **`docs/diagrams/`** — architecture diagrams (draw.io), the engineering source of truth.
- **`.claude/rules/`** — framework engineering rules that keep the build green.

## Deploying

The site deploys as a static build to GitHub Pages via the included Actions workflow
(`.github/workflows/deploy.yml`). Point a custom domain at the repo in the Pages
settings and set `place.domain` in `place.config.ts` to match; the site is designed
to serve from the domain root.

## Genericity

`src/`, `scripts/`, and `tests/` carry **zero place-specific strings** — all place
identity flows through `place.config.ts`, `knowledge/`, and `public/media/`. This is
machine-enforced (`npm run genericity`) and is the structural guarantee that one
config file re-places the whole site.

## License

Dual-licensed (see [`LICENSE`](./LICENSE)):

- **Content** (`knowledge/`, `public/media/`) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/):
  free to share and adapt with attribution, share-alike.
- **Code** (everything else) — MIT.
