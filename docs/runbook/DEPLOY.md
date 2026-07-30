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

`npm run genericity` runs two gates: the place-name denylist gate
(`scripts/ci/check-genericity.sh`), which enforces that framework code carries
zero place-specific strings, and the English-only gate
(`scripts/ci/check-english-only.mjs`), which rejects CJK codepoints. In the
pristine template (the `.sekai-template` marker is present at the repo root)
both scan the whole tree. In an adopted instance (`npm run init` removes the
marker) they scan the code trees, each gate stating its own root set: the
place-name denylist gate scans `src/`, `scripts/`, `tests/`, `workers/`,
`.agents/skills/`; the English-only gate scans `src/`, `scripts/`, `tests/`,
`workers/`, `.agents/skills/`; your `knowledge/` and `place.config.ts` are
outside both, so they legitimately carry your place's name. A gate skips any of
its roots this checkout does not have.
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

## Cloudflare Workers

Dynamic capability runs on Cloudflare Workers, separate from the static site on
GitHub Pages. Each worker lives in its own directory under `workers/` with its own
`wrangler.toml`, and is deployed by hand — CI never deploys a worker, so nothing
here runs on a push. The first one is `workers/feedback/`, the endpoint the
feedback widget posts to.

Everything below stays inside the **free tier**: one Worker and one D1 database.

### Prerequisites

- A Cloudflare account (free plan is enough).
- `wrangler` is deliberately **not** a project dependency — it pulls a
  platform-specific binary into the lockfile that CI would then have to resolve for
  a tool CI never runs. Invoke it with `npx` instead, which downloads it on demand.
- Log in once per machine:

```bash
npx wrangler login
```

### Deploying the feedback worker

Run every command from the worker's own directory, so `wrangler` picks up its
`wrangler.toml`:

```bash
cd workers/feedback
```

**1. Create the D1 database.** The command prints a `database_id`; paste it into
`wrangler.toml` under `[[d1_databases]]`, replacing the
`REPLACE_WITH_YOUR_D1_DATABASE_ID` placeholder. The checked-in file ships with
placeholders only — your instance owns it after adoption, so your real id is a
normal commit in your repository.

```bash
npx wrangler d1 create sekai-feedback
```

**2. Apply the schema.** This creates the `feedback` and `submission_window`
tables. Re-running it is safe; only unapplied migrations run.

```bash
npx wrangler d1 migrations apply sekai-feedback --remote
```

**3. Set the IP-hash salt.** The worker rate-limits per address, and it stores only
`sha256(address + salt)` — never the address itself. Without the salt a hash of an
IPv4 address is reversible by brute force in seconds, so the worker refuses to run
(HTTP 500) rather than hash unsalted. Use a long random value and keep it out of
`wrangler.toml`: a secret is not a var.

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT
```

**4. Set your site's origin and deploy.** `ALLOWED_ORIGIN` is the only origin the
worker accepts; edit it in `wrangler.toml` before deploying.

```bash
npx wrangler deploy
```

`wrangler` prints the deployed URL (`https://sekai-feedback.<subdomain>.workers.dev`).
That URL is what `place.config.ts` points the widget at.

### Configuration

Set in `wrangler.toml` under `[vars]`, except `IP_HASH_SALT`, which is a secret:

| Name | Required | Default | Meaning |
|---|---|---|---|
| `ALLOWED_ORIGIN` | yes | — | The single origin allowed to post, e.g. `https://kb.example.invalid`. Never `*`. Unset or mismatched → every request is 403. |
| `IP_HASH_SALT` | yes (secret) | — | Salt for the per-address hash. Missing → every POST is 500. |
| `RATE_LIMIT_MAX` | no | `5` | Submissions allowed per address per window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | `3600` | Length of the rolling window, in seconds. |

The `[[d1_databases]]` block binds the database as `DB`; leave `binding = "DB"`
alone, and change `database_name` only if you created the database under a
different name.

### Reading rows back

The triage skill reads D1 directly, but any query works from the CLI. `--remote`
targets the deployed database; without it you get the local dev copy.

```bash
# The newest submissions
npx wrangler d1 execute sekai-feedback --remote \
  --command "SELECT id, created_at, page, category, status FROM feedback ORDER BY created_at DESC LIMIT 20"

# One submission in full
npx wrangler d1 execute sekai-feedback --remote \
  --command "SELECT * FROM feedback WHERE id = 'PASTE_AN_ID'"

# Mark one triaged
npx wrangler d1 execute sekai-feedback --remote \
  --command "UPDATE feedback SET status = 'triaged' WHERE id = 'PASTE_AN_ID'"
```

`submission_window` holds only rate-limit counters keyed by salted hash; it is safe
to delete rows from it, which resets those addresses' limits.

### Tests

The worker's unit suite runs under `node:test` with no Cloudflare dependency and no
network, driving the handler against an in-memory D1 stub. CI runs it on every pull
request; run it locally with:

```bash
npm run test:workers
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
