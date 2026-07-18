# DEPLOY — Operating and Deploying a sekai-kb Instance

First-timer runbook: every command below is copy-pasteable. Each capability is
its own `##` section; future framework releases append new capability sections
(background workers, upgrade flow) without restructuring the existing ones.

Written for an instance created from the sekai-kb template ("Use this template"
on GitHub, then cloned). `<owner>/<repo>` below means your GitHub repo.

---

## Prerequisites

| Tool    | Version   | Check                  | Install                                                        |
| ------- | --------- | ---------------------- | --------------------------------------------------------------- |
| Node.js | ≥ 22.12   | `node --version`       | <https://nodejs.org/> or your version manager                   |
| npm     | ships with Node | `npm --version`  | —                                                               |
| uv      | any recent | `uv --version`        | `curl -LsSf https://astral.sh/uv/install.sh \| sh`               |
| Python  | ≥ 3.12    | managed by uv          | nothing to do — uv reads `.python-version` and fetches it        |
| gh      | any recent | `gh --version`        | <https://cli.github.com/> then `gh auth login`                   |
| git     | any recent | `git --version`       | —                                                               |

---

## Install

From a fresh clone:

```bash
npm ci --force
uv sync
```

- `npm ci --force`: the `--force` works around an npm cross-platform lockfile
  validation issue with optional native sub-dependencies (nodejs/npm#7758) —
  the same flag CI uses. All non-optional dependencies still install at exact
  locked versions. Plain `npm install` also works but may churn the lockfile.
- `uv sync` creates a local `.venv` with the pinned Python (≥ 3.12, from
  `.python-version`) and the `pytest` dev group. It powers the `article-health`
  editorial linter; you never invoke `pip` or manage a virtualenv yourself.
- Installing also wires the pre-commit hook (husky runs from npm's `prepare`
  script).

---

## Local development

```bash
npm run dev
```

Serves at `http://localhost:4321`. The dev command runs the full prebuild first
(content sync + generated data), so the first start takes a moment.

---

## Content workflow

Content lives in `knowledge/{Category}/*.md` — the single source of truth.
`src/content/` and `src/data/` are derived, gitignored projections; never edit
them directly.

```bash
# Project knowledge/ into the build (run after editing content)
npm run sync

# Validate frontmatter across all of knowledge/
npm run test

# Editorial lint on one article — mandatory ship gate (see docs/playbook/ARTICLE-PLAYBOOK.md)
npm run article-health -- knowledge/Beaches/lantern-cove-beach.md --profile=ci-deploy
```

The writing process itself — research, drafting, quality gate — is
[`docs/playbook/REWRITE-PIPELINE.md`](../playbook/REWRITE-PIPELINE.md).

---

## Python toolchain (article-health)

The editorial linter is Python, run through uv — no global Python setup, no
manual virtualenv.

```bash
# One-time (and after pulling dependency changes)
uv sync

# Lint one article — mandatory ship gate
npm run article-health -- knowledge/History/founding-of-marisol-cove.md --profile=ci-deploy

# Lint the whole corpus with the CI gate's profile
npm run article-health -- --all --profile=ci-deploy

# List every check the tool knows
npm run article-health -- --list-checks

# Run the tool's own test suite
npm run article-health:test
```

`npm run article-health` is a wrapper for
`uv run python scripts/tools/article-health.py`; both forms work. Profiles and
per-check thresholds live in `scripts/tools/article-health.config.toml` — tune
them per instance (see playbook §8).

---

## Quality gates

```bash
# Genericity + English-only gates (the same gates CI runs)
npm run genericity

# Frontmatter validation, CI-strict
npm run test:ci
```

The genericity gate enforces that framework code carries zero place-specific
strings. In the pristine template (the `.sekai-template` marker is present at
the repo root) it scans the whole tree; in an adopted instance (`npm run init`
removes the marker) it scans the code trees (`src/`, `scripts/`, `tests/`), so
your `knowledge/` and `place.config.ts` legitimately carry your place's name.
Your place name is added to `scripts/ci/genericity-denylist.local.txt` by the
init wizard, which keeps it out of framework code from day one.

---

## Build

```bash
npm run build
```

This chains: content sync → parallel prebuild (search index, knowledge-base
index, content dates, git info, related articles, changelog, map markers,
dashboard data) → `astro build` → post-build contract checks (smoke test,
internal links, map markers, graph, dashboard). Output lands in `dist/`.

Preview the production build locally:

```bash
npm run preview
```

---

## Pre-commit hook

Installed automatically by `npm ci`/`npm install` (husky). On every commit it
runs, against staged files only:

1. A credential-leak scan (service-account JSON, private keys, API tokens).
2. Frontmatter validation on staged `knowledge/` files.
3. `article-health --staged --profile=pre-commit` (HARD violations block the
   commit; WARN is advisory).

If the hook blocks a commit, fix the finding. `git commit --no-verify` bypasses
it — reserve that for false positives (e.g. a test fixture that looks like a
credential).

---

## CI

`.github/workflows/deploy.yml` runs on every PR and every push to `main`:

| Job          | What it does                                                                | Runs on            |
| ------------ | ---------------------------------------------------------------------------- | ------------------- |
| `genericity` | Place-string denylist + CJK/English-only scan                                | every PR + main     |
| `test`       | `npm run test:ci` + `article-health --all --profile=ci-deploy`               | every PR + main     |
| `build`      | `npm run build` including all post-build contract checks                     | every PR + main     |
| `init-check` | Init-wizard self-check (init → build on a disposable checkout)               | every PR + main     |
| `deploy`     | Publish `dist/` to GitHub Pages                                              | push to main only   |

The workflow follows least-privilege: jobs that execute PR-authored code run
with `contents: read`; only the deploy job holds the Pages write scopes. Watch a
run from the terminal:

```bash
gh run watch
```

---

## GitHub Pages

One-time setup so the deploy job can publish. Either in the UI — repo
**Settings → Pages → Build and deployment → Source: GitHub Actions** — or from
the terminal:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

(If Pages was already enabled once, use `-X PUT` to update instead.)

Then push to `main` (or re-run the workflow) and the site is live:

```bash
gh run watch && gh api repos/<owner>/<repo>/pages --jq .html_url
```

Note on URLs: the build targets the domain root — `site` in `astro.config.ts`
comes from `place.domain` in `place.config.ts`. A `<owner>.github.io/<repo>`
project URL is fine for smoke-checking a deploy, but root-relative links only
fully resolve when the site is served from a domain root: a custom domain
(below) or a `<owner>.github.io` root repository.

---

## Custom domain (Cloudflare DNS)

Assumes your domain's DNS is on Cloudflare; any DNS provider works the same way
apart from the dashboard.

1. **Tell GitHub Pages the domain:**

   ```bash
   gh api -X PUT repos/<owner>/<repo>/pages -f cname=your-domain.example
   ```

   (UI equivalent: Settings → Pages → Custom domain.)

2. **Point DNS at Pages.** In Cloudflare, add for an apex domain
   (`your-domain.example`):

   ```
   Type: CNAME   Name: @   Target: <owner>.github.io   Proxy: DNS only
   ```

   Cloudflare flattens the apex CNAME automatically. For a subdomain
   (`www` or `kb`), same record with `Name: www`. Keep the record **DNS only**
   (grey cloud) at least until the certificate is issued; GitHub can't provision
   TLS behind Cloudflare's proxy.

3. **Wait for the certificate, then enforce HTTPS:** Settings → Pages →
   "Enforce HTTPS" (checkbox appears once the cert is provisioned; typically
   minutes, up to an hour). Or:

   ```bash
   gh api -X PUT repos/<owner>/<repo>/pages -F https_enforced=true
   ```

4. **Match the config:** set `place.domain` in `place.config.ts` to the same
   domain — it drives canonical URLs, the sitemap, and RSS. Commit and push so
   the next deploy builds against the right origin.

Verify end-to-end:

```bash
curl -sI https://your-domain.example | head -5
```

---

## Visual regression

Optional but recommended once your instance's look settles:

```bash
# Capture the reference screenshots (run once, and after intentional redesigns)
npm run visual:baseline

# Compare current pages against the baseline
npm run visual:check
```

---

## Troubleshooting

- **`npm ci` rejects the lockfile** — use `npm ci --force` (see Install). If it
  persists after a dependency change, regenerate:
  `rm -rf node_modules package-lock.json && npm install`, then re-verify with
  `npm ci --force`.
- **`article-health` says command not found / Python errors** — run `uv sync`
  first; every Python entry point goes through `uv run`.
- **Build fails on a content file** — run `npm run test` for frontmatter
  errors, then `npm run article-health -- <file> --profile=pre-commit` for the
  editorial gate's view.
- **Deploy job skipped** — the deploy job only runs on push to `main`; PR runs
  build but never publish.
