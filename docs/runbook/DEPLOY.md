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
| Node.js | ≥ 22.13   | `node --version`       | <https://nodejs.org/> or your version manager                   |
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

Three files under `knowledge/` are not articles: `INBOX.md` and `SNIPPET-INBOX.md`
are workflow queues, and `knowledge/sounds/_manifest.md` lists the `/soundscape`
recordings. The manifest's leading underscore is what keeps the article pipeline
from validating it as an article, so keep the name exactly as it is.

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

# Committed worker configs carry framework placeholders only
npm run worker-config:check

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

`npm run worker-config:check` covers what a name denylist cannot: a committed
`ALLOWED_ORIGIN` or Worker name is deployment identity even when its text contains
no place name at all. It asserts every committed `workers/*/wrangler.toml` still
carries the framework placeholders (see §Cloudflare Workers). It runs in the same
`genericity` CI job, and it fails in your checkout too — that is the point.

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
| `genericity` | Place-string denylist + CJK/English-only scan + committed worker configs      | every PR + main     |
| `test`       | `npm run test:ci` + `article-health --all --profile=ci-deploy`               | every PR + main     |
| `build`      | `npm run build` including all post-build contract checks                     | every PR + main     |
| `init-check` | Init-wizard self-check (init → build on a disposable checkout)               | every PR + main     |
| `deploy`     | Publish `dist/` to GitHub Pages                                              | push to main only   |

The workflow follows least-privilege: jobs that execute PR-authored code run
with `contents: read`; only the deploy job holds the Pages write scopes.

There is a second workflow, `.github/workflows/corpus-refresh.yml`. It is the only
one that deploys a Cloudflare Worker, it runs on push to `main` and manual dispatch
only, and it does nothing until you configure its credentials — see
[§Refreshing the corpus from CI](#refreshing-the-corpus-from-ci). Watch a
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

## Analytics

Browser analytics collection is independently gated behind `features.analytics`
and per-provider identifiers in the `analytics` block of `place.config.ts`. Both
providers are absent-safe: an instance that upgrades without configuring analytics
sees no change.

### GA4 (Google Analytics 4)

1. **Create a GA4 property** in the [Google Analytics admin](https://analytics.google.com/):
   Admin > Create Property. Name it after your instance.
2. **Create a web data stream** for your domain. Copy the **Measurement ID**
   (format: `G-XXXXXXXXXX`).
3. **(Recommended) Verify the domain in Google Search Console** and link it to
   the GA4 property so organic-search data flows into GA4 reports:
   - Search Console > Add Property > Domain > verify via DNS TXT record.
   - GA4 Admin > Product Links > Search Console Links > Link > select the
     verified property and the web data stream created in step 2.
4. **Configure `place.config.ts`:**

   ```ts
   features: { analytics: true },
   analytics: { ga4MeasurementId: 'G-XXXXXXXXXX' },
   ```

5. **Verify:** open the site, open Chrome DevTools Network tab, filter by
   `collect?`. A `POST` to `https://www.google-analytics.com/g/collect?...`
   confirms collection. Or use GA4 DebugView (Realtime > DebugView in the GA4
   console; enable via the [GA Debugger extension](https://chrome.google.com/webstore/detail/google-analytics-debugger/jnkmfdileelhofjcijamephohjechhna)).

### Cloudflare Web Analytics

1. **Enable Web Analytics** in the Cloudflare dashboard:
   Account Home > Web Analytics > Add a site > select "Manual setup with a JS
   Beacon" (NOT the automatic proxy mode).
2. Copy the **site token** (32-character hex string) from the snippet shown.
3. **Configure `place.config.ts`:**

   ```ts
   features: { analytics: true },
   analytics: { cloudflareWebAnalyticsToken: 'abcdef0123456789abcdef0123456789' },
   ```

4. **Verify:** open the site, open DevTools Network tab, filter by
   `cloudflareinsights`. A request to
   `https://static.cloudflareinsights.com/beacon.min.js` loads the beacon; a
   subsequent request to `/cdn-cgi/rum` confirms a pageview was sent.

### Preventing duplicate beacons

The framework injects the GA4 gtag and/or Cloudflare beacon automatically when
the config enables them. Do NOT also paste the provider snippets manually into
your HTML or into a Cloudflare dashboard "automatic setup" that injects the same
beacon via the proxy. Doing so causes double-counted pageviews. If you previously
used Cloudflare's automatic injection, disable it before enabling the config key.

### Both providers together

Both providers are independently gated: set both IDs in the `analytics` block and
both collect in parallel. Remove one ID (or set it to empty string) to disable
that provider without touching the other.

### Analytics signal fetchers (`npm run fetch:analytics`)

The analytics dashboard consumes normalized JSON produced by three Python fetchers
that query GA4, Search Console, and Cloudflare. The command runs all three
providers; one failure does not block the others, but the orchestrator exits
nonzero when any provider fails.

**Output files** (gitignored, under `src/data/analytics/`):

| File | Provider | Period |
|------|----------|--------|
| `ga4.json` | Google Analytics 4 Data API | 7 days |
| `search-console.json` | Search Console Search Analytics API | 28 days |
| `cloudflare.json` | Cloudflare GraphQL Analytics API | 7 days |

**Local environment variables** (set in your shell or `.env` that is NOT committed):

| Variable | Description |
|----------|-------------|
| `GA4_PROPERTY_ID` | Numeric GA4 property ID (Admin > Property Settings) |
| `SC_SITE_URL` | Search Console site URL (`sc-domain:example.com` or `https://example.com/`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account JSON key file |
| `CF_ZONE_ID` | Cloudflare zone ID (Overview page sidebar) |
| `CF_API_TOKEN` | Cloudflare API token with Analytics:Read on the zone |

**GitHub Actions secrets** (for production builds on push to `main`):

| Secret | Description |
|--------|-------------|
| `GA4_PROPERTY_ID` | Same as the local variable |
| `SC_SITE_URL` | Same as the local variable |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON content of the service account key (replaces the file path) |
| `CF_ZONE_ID` | Same as the local variable |
| `CF_API_TOKEN` | Same as the local variable |

**How the production fetch runs.** `src/data/` is gitignored and the Pages workflow
builds from a clean checkout, so a local fetch can never reach the deployed site.
The fetch therefore happens inside the Pages build job itself, immediately before
`npm run build`, and its output is consumed only by that build. Nothing is
committed and nothing is uploaded as a separate artifact.

That step **never runs on a pull request**. The build job executes
pull-request-authored code, so a step able to receive these secrets would hand a
service-account key and a Cloudflare API token to anyone who opens one. Every
analytics step is gated on `push` to `main`.
`npm run analytics-delivery:check` asserts that gating, plus the ordering, the
non-blocking failure behavior, and the unchanged `permissions: contents: read`
block, from the workflow file on every pull request.

`GOOGLE_SERVICE_ACCOUNT_JSON` is written to **runner-temporary storage** for the
duration of the fetch (outside the build workspace, mode `600`) and removed
afterwards whether the run succeeds, fails, or is cancelled. The fetch step
receives the path in `GOOGLE_APPLICATION_CREDENTIALS`, never the raw key, so the
key is never in the environment of the build that produces `dist/`.

**What each credential state does:**

- With **no** analytics secret set — the default for a fresh clone — the fetch
  step reports an explicit skip, exits green, and the site builds. Every dashboard
  analytics panel shows its own unavailable state. Nothing is red.
- With an **incomplete** set, no credentialed request is sent at all: a partial
  credential set cannot produce a valid result for any provider. The run reports a
  visible failed step naming the missing variables, and the site build continues.
  This is deliberate: a silent green build with an empty dashboard is the failure
  mode that state exists to prevent.
- When a **provider fails** (an API outage, a revoked grant, a malformed
  response), the fetch step is marked failed and stays visible in the run, while
  the build proceeds with whatever valid source files the run did produce. That
  source's panel shows its unavailable state and the other two render normally.

An explicit local `npm run fetch:analytics` stays strict: it exits nonzero for
missing credentials, invalid responses, or any provider failure.

**Service account setup:**

1. In Google Cloud Console, create a service account (no special roles needed
   beyond the GA4 and Search Console grants below).
2. Create a JSON key for the service account and download it.
3. In GA4: Admin > Property Access Management > add the service account email
   with Viewer role.
4. In Search Console: Settings > Users and permissions > add the service account
   email with Restricted access.
5. Locally: set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path.
   In Actions: paste the key file content into the `GOOGLE_SERVICE_ACCOUNT_JSON`
   secret.

**Cloudflare API token setup:**

1. In the Cloudflare dashboard: My Profile > API Tokens > Create Token.
2. Permissions: Zone > Analytics > Read.
3. Zone Resources: Include > Specific zone > select your zone.
4. Copy the token value into `CF_API_TOKEN`.

---

## Cloudflare Workers

Dynamic capability runs on Cloudflare Workers, separate from the static site on
GitHub Pages. Each worker lives in its own directory under `workers/` with its own
`wrangler.toml`, and is deployed by hand. `workers/feedback/` is the endpoint the
feedback widget posts to; `workers/chat/` retrieves cited knowledge-base context and
streams an answer; `workers/og/` renders per-article social-preview images on demand;
`workers/mcp/` serves the remote MCP endpoint.

**One narrow exception, and it is opt-in.** The workers that bundle the corpus
artifact — chat and MCP — can be redeployed from CI when you publish an article, so
their retrieval index does not go stale between hand deploys. Nothing happens unless
you configure the credentials yourself; see
[§Refreshing the corpus from CI](#refreshing-the-corpus-from-ci) for what that grants
and how to revoke it. Every other worker, and every other reason to deploy, is a
hand deploy with your own credentials on your own machine.

Everything below can stay inside the **free tier**: Workers, D1, and the shared
Workers AI daily allocation.

### The config you deploy is generated, not committed

A Worker script name and a D1 `database_name` are **account-scoped**: two instances
that deploy under the same names collide in one Cloudflare account, the second
overwriting the first's script and rebinding it to the second's database. The
Worker's `ALLOWED_ORIGIN` is your site's origin. All three are your place's
identity, and `workers/` is a code tree that may carry none of it (AGENTS.md iron
rule 2 — both machine gates scan it). So:

- **`workers/<worker>/wrangler.toml` is a committed template.** It ships
  placeholders and you never edit it. `npm run worker-config:check` fails the build
  if a real name, database name, or `[vars]` value is committed there — in your
  checkout as well as in the framework's.
- **`workers/<worker>/wrangler.generated.toml` is what you deploy.** `npm run
  worker-config` writes it from `place.config.ts`. It is gitignored, disposable, and
  regenerated whenever your config changes.
- Every `wrangler` command below therefore passes `--config` (global flag: "Path to
  your Wrangler configuration file"), which `deploy`, `d1 create`, and
  `d1 migrations apply` all accept.

**The derivation rule**, applied to both the Worker name and the D1 database name:

```
<place-slug>-<worker-directory-name>
```

`<place-slug>` is `place.name` from `place.config.ts`, lowercased, with every run of
characters outside `[a-z0-9]` collapsed to a single `-`, leading and trailing `-`
removed, truncated to 40 characters, and any trailing `-` the cut exposed removed
again — a name truncated mid-separator yields `<slug>-feedback`, never
`<slug>--feedback`. So a place named "Marisol Cove" deploys
`workers/feedback/` as `marisol-cove-feedback`. `ALLOWED_ORIGIN` is `place.domain`,
with `https://` added when the domain carries no scheme. Everything else in the
template — `main`, `compatibility_date`, the D1 `binding`, `migrations_dir`, and the
rate-limit vars — is carried through unchanged.

**`npm run init` does nothing for `workers/`.** The wizard never touches the tree:
its worker-related prompts ask for deployed endpoint URLs, with blank defaults,
because at init time no worker exists yet. Generation at deploy time
is the whole adoption path for `workers/`, and it needs no wizard step — your
`place.config.ts` is the only input.

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

Run every command from the **repository root** — `--config` carries the path, so
there is no directory to change into.

**1. Generate the config.** Read the derived name out of its output; the steps below
use `<worker-name>` for it.

```bash
npm run worker-config
```

It reports one line per worker (`name=…  ALLOWED_ORIGIN=…`) and notes that
`database_id` is still empty, which is expected until step 3.

**2. Create the D1 database**, under the same derived name:

```bash
npx wrangler d1 create <worker-name> \
  --config workers/feedback/wrangler.generated.toml
```

The database this creates is what `database_id` will point at; the generated
config's own `database_id` is still empty at this point, which is expected until
step 3. Do not pass `--update-config`: it would write the id into the generated
file, which the next regeneration discards. `place.config.ts` is where it lives.

**3. Record the database id and regenerate.** The command above printed a
`database_id`. Put it in `place.config.ts` — that file is yours (`merge=ours`), sits
outside every gate scan root, and survives a fresh clone, which a gitignored
generated file does not:

```ts
workers: {
  feedback: '',                                  // filled in at step 6
  feedbackDatabaseId: 'PASTE_THE_DATABASE_ID',
},
```

Then regenerate so the id reaches the config wrangler reads:

```bash
npm run worker-config
```

> **Why `place.config.ts` and not a gitignored sidecar.** The other candidate was a
> gitignored `workers/feedback/.deploy.json` holding the id beside the worker,
> recoverable with `npx wrangler d1 list` if it were ever lost. It was rejected:
> gitignored state does not survive a fresh clone, so every clone would need that
> recovery step before it could deploy, and it would split instance identity across
> two files. A D1 database id is an account-scoped identifier, not a credential —
> useless without account authentication — so there is nothing to protect by keeping
> it out of your repository, and `place.config.ts` is already the one place your
> instance's identity lives. `npx wrangler d1 list` remains how you recover the id if
> you lose it, whichever file it was in.

**4. Apply the schema.** This creates the `feedback` and `submission_window`
tables. Re-running it is safe; only unapplied migrations run.

```bash
npx wrangler d1 migrations apply <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml
```

**5. Set the IP-hash salt.** The worker rate-limits per address, and it stores only
`sha256(address + salt)` — never the address itself. Without the salt a hash of an
IPv4 address is reversible by brute force in seconds, so the worker refuses to run
(HTTP 500) rather than hash unsalted. Use a long random value; a secret is never a
var, so it goes in neither config file:

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT \
  --config workers/feedback/wrangler.generated.toml
```

**6. Deploy, then point the site at it.**

```bash
npx wrangler deploy --config workers/feedback/wrangler.generated.toml
```

`wrangler` prints the deployed URL (`https://<worker-name>.<subdomain>.workers.dev`).
Set it in `place.config.ts` and turn the feature on. The widget needs both: with
either half missing it renders nothing, so a flag switched on before the worker
exists cannot produce a form that posts nowhere.

```ts
features: { feedback: true, /* ... */ },
workers: {
  feedback: 'https://<worker-name>.<subdomain>.workers.dev',
  feedbackDatabaseId: '…',
},
```

Rebuild and redeploy the site afterwards — the endpoint is read at build time, so
the browser never fetches config. `ALLOWED_ORIGIN` (generated from `place.domain`)
must be the origin the site is served from, or every submission comes back 403.

> If a step ever needs a value generation cannot supply, `wrangler deploy` also
> accepts `--name`. Reach for it only as a fallback; the generated config is the
> supported path, and the D1 binding resolves through `database_name` in the file
> regardless.

### Configuration

Everything below is derived into `wrangler.generated.toml` by `npm run
worker-config`, except `IP_HASH_SALT`, which is a secret you set once (step 5). The
committed `wrangler.toml` is where the framework's own defaults live; the
"Source" column says where each value comes from.

<!-- worker-vars: feedback -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `name` | yes | derived: `<place-slug>-<worker>` | The Worker script name, account-scoped, and the subdomain of its `workers.dev` URL. |
| `ALLOWED_ORIGIN` | yes | `place.domain` | The single origin allowed to post. Never `*`. Unset or mismatched → every request is 403. |
| `database_name` | yes | derived: `<place-slug>-<worker>` | The D1 database, account-scoped. Must match the database you created in step 2. |
| `database_id` | yes | `place.config.ts` → `workers.feedbackDatabaseId` | Printed by `wrangler d1 create`. Absent-safe: unset generates an empty value and a note, which is the state between steps 1 and 3. |
| `IP_HASH_SALT` | yes (secret) | `wrangler secret put` | Salt for the per-address hash. Missing → every POST is 500. Never a var. |
| `RATE_LIMIT_MAX` | no | template (`5`), override `workers.feedbackRateLimitMax` | Submissions allowed per address per window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | template (`3600`), override `workers.feedbackRateLimitWindowSeconds` | Length of the rolling window, in seconds. |

The last two rows carry an **override**: the committed
`workers/feedback/wrangler.toml` is framework-owned and ships the default, but you
can set a different value in `place.config.ts` under `workers` and `npm run
worker-config` writes it into the generated config. Editing the committed template
directly is not forbidden — it is your repository, and `npm run worker-config:check`
warns rather than failing your build for it — but the override key is the cheaper
home: it is instance-owned, so it never conflicts on a framework upgrade, while a
retuned template value conflicts on every release until you and the framework agree
again (`UPGRADE.md` §Framework-owned files). Leave a key unset and the template
default is carried through unchanged, so an instance that sets neither behaves
exactly as it did before these keys existed. A value the worker could not use is
rejected at generation time by name — a limit below `1`, a fractional count,
anything non-numeric — rather than deploying and silently falling back to the
default. If a later release drops one of these vars from the template, `npm run
worker-config` names the key, leaves the value out, and finishes, so one stale key
never blocks a deploy.

```ts
workers: {
  // ...
  feedbackRateLimitMax: 20,
},
```

The rate limit is keyed on `sha256(address + salt)`, which is **per public address,
not per person**: everyone behind one NAT shares one budget. A hotspot, a cafe, a
hotel, a school, and a QR code that puts the form in front of a group standing in
one place all land on the same key. A rate-limited submission tells the reader to try
later and tells you nothing at all: a ceiling too low for a placement produces
silence, not a report, so no absence of feedback is evidence that the limit is not
being hit. Raise `feedbackRateLimitMax` for placements busier than the default
assumes.

The `[[d1_databases]]` block binds the database as `DB`; `binding = "DB"` is the
name the worker's code uses and is framework-owned, not instance identity.

### Reading rows back

The triage skill reads D1 directly, but any query works from the CLI. `--remote`
targets the deployed database; without it you get the local dev copy. `<worker-name>`
is the derived name from step 1. These run from the repository root like every step
above, and pass the same `--config`: the path is repo-relative, and without it
`wrangler` resolves whichever config it finds nearest the directory you happen to be
in.

```bash
# The newest submissions
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "SELECT id, created_at, page, category, status FROM feedback ORDER BY created_at DESC LIMIT 20"

# One submission in full
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "SELECT * FROM feedback WHERE id = 'PASTE_AN_ID'"

# Mark one triaged
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "UPDATE feedback SET status = 'triaged' WHERE id = 'PASTE_AN_ID'"
```

`submission_window` holds only rate-limit counters keyed by salted hash — one row per
address per second in which it submitted, which is what makes the window roll rather
than reset on a boundary. The worker deletes rows once they age out of the window, so
the table stays small on its own. Deleting rows by hand is safe; it resets those
addresses' limits.

### Tests

The worker's unit suite runs under `node:test` with no Cloudflare dependency and no
network, driving the handler against an in-memory D1 stub. CI runs it on every pull
request; run it locally with:

```bash
npm run test:workers
```

### Deploying the OG image worker

`workers/og/` renders per-article social-preview cards on demand. No database,
no secrets, no state: it fetches `topics.json` from the deployed site on first
request, renders a PNG with Satori and resvg-wasm, and caches the result at the
edge for a year. Everything stays inside the free tier.

**1. Generate the config.** Same command as the feedback worker; it writes all
workers:

```bash
npm run worker-config
```

**2. Deploy.**

```bash
npx wrangler deploy --config workers/og/wrangler.generated.toml
```

**3. Register the route in the Cloudflare dashboard.** Workers on the free tier
use `workers.dev` subdomains by default. If you want the OG endpoint on your own
domain (e.g. `og.example.com/og/...`), add a route pattern in the Cloudflare
dashboard under Workers > Routes. The route is a custom-domain setup, not a
wrangler config entry.

**4. Point the site at it and turn the feature on.**

```ts
features: { og: true, /* ... */ },
workers: {
  og: 'https://<worker-name>.<subdomain>.workers.dev',
  /* ... */
},
```

Rebuild and redeploy the site. `SEO.astro` reads `features.og` and `workers.og`
at build time; with either missing the OG meta tag points to the static
`og-default.png` as before.

**5. Purge the edge cache on redeploy.** Each OG image is cached with
`max-age=31536000, immutable`. After an article title changes or you update the
card style, purge the cached URLs so the next request renders fresh:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"prefixes":["og.example.com/og/"]}'
```

Or purge everything via the Cloudflare dashboard under Caching > Purge Cache.

### OG worker configuration

<!-- worker-vars: og -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `name` | yes | derived: `<place-slug>-og` | The Worker script name, account-scoped. |
| `SITE_ORIGIN` | yes | `place.domain` | Origin to fetch `topics.json` from (e.g. `https://example.com`). |
| `SITE_NAME` | yes | `place.name` | Site name rendered on the card footer. |
| `CATEGORY_COLORS` | yes | `categories[].color` | JSON map of slug to hex color for the category badge. Empty entries omitted. |

No D1, no secrets, no rate limit. The worker is stateless: its only external
dependency is the site's own `topics.json`, which it fetches once on cold start
and caches in global scope.

### Corpus embeddings

`npm run embeddings:build` turns `knowledge/` into the retrieval index the chat
worker and the MCP worker's `semantic_search` tool both query. It chunks every
article at roughly 300-500 words on `##` heading boundaries, embeds each chunk with
`@cf/baai/bge-m3` through the Workers AI REST API, and writes
`workers/lib/vectors.json`.

**One artifact, two workers.** It lives beside the shared retrieval code in
`workers/lib/` rather than inside either worker, and `wrangler deploy` bundles the
same bytes into each, so chat and MCP cannot answer out of two different corpora.
Redeploy **both** after a rebuild, or the one you skipped keeps the older index.

**The artifact is gitignored, so a deploy must rebuild it first.** It carries every
article's title, URL, and body text, and `workers/` is a code tree that may hold no
place identity (AGENTS.md iron rule 2). `npm run worker-config:check` fails if a
`vectors.json` is ever committed. The site build never produces it — `npm run build`
stays green with no Cloudflare credentials in the environment, on your machine and in
CI alike. Running this command is the default path, and it is a deliberate manual
step. [§Refreshing the corpus from CI](#refreshing-the-corpus-from-ci) below is the
opt-in alternative: the same command, run by a GitHub Actions job with credentials
you supply.

**1. Mint an API token.** In the Cloudflare dashboard under My Profile > API Tokens,
use the **Workers AI** token template. If you create a custom token instead, running
inference over the REST API needs both of these permissions, not just the read one:

```
Account | Workers AI | Read
Account | Workers AI | Edit
```

Scope it to the single account you deploy from. `ai/run/@cf/baai/bge-m3` is an
inference call, so a Read-only token is rejected before any embedding is returned
([Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
checked 2026-08-06).

**2. Export the two variables and run the build.** The account id is an identifier,
not a credential — it appears in dashboard URLs, so typing it is fine. The token is a
credential: read it from a prompt rather than typing it on the command line, because
an inline `VAR=value command` prefix is written to your shell history verbatim.

```bash
export CF_ACCOUNT_ID=<your-account-id>
printf 'Cloudflare AI token: ' && read -rs CF_AI_TOKEN && echo && export CF_AI_TOKEN
npm run embeddings:build
```

(`read -rs` is silent and works in both bash and zsh; `npx wrangler whoami` prints
your account id if you do not have it to hand.)

Both variables are required. A missing or blank value exits nonzero naming the
variable rather than silently skipping the embedding step and writing a hollow index.

**Where the credentials live: nowhere in this repository.** The build reads both from
the environment at run time. Nothing writes them to a file, no log line prints the
token or the request URL, and the emitted `vectors.json` carries only chunk text and
vectors. Errors name the variable and the HTTP status, never the value. Keep it that
way: if you park the token in a file for convenience, `.gitignore` already covers
`.env` and `.dev.vars`, but a credential in the environment of the one shell that
needs it is safer than a credential on disk. To revoke, roll the token in the
Cloudflare dashboard — nothing in the repository has to change.

**3. Re-run it after any `knowledge/` change.** The index is a snapshot: an article
added, edited, or deleted since the last run is respectively missing, stale, or a
dangling citation until you rebuild. The run prints articles in, chunks out, and
bytes written, and it fails naming the file if any article produced zero chunks.

**What gets embedded, and what the run tells you it skipped.** The corpus is every
article the site publishes — a `knowledge/<Category>/*.md` whose directory is one of
your `place.config.ts` categories. An article in a directory that is not a configured
category has no page, so a chat answer citing it would link to a 404; the run prints
each one by name under `article(s) NOT embedded` rather than passing over it. If you
see a file listed there that should be searchable, the fix is to give it a route (add
its directory to `categories` in `place.config.ts`) or move it into a category that
already has one — not to change this command. Files starting with `_` are not articles
and are not listed.

**Free-tier budget.** Workers AI allows 10,000 neurons per day on the free plan
(`[as-of 2026-07]`); one embedding call is well under one neuron, so a corpus of a
few thousand chunks costs a small fraction of one day's allowance. The cost scales
with total chunks, not with articles, and it is paid once per rebuild — there is no
per-request cost at read time, because the chat worker loads the static artifact
rather than querying a vector service.

| Name | Required | Source | Meaning |
|---|---|---|---|
| `CF_ACCOUNT_ID` | yes | Cloudflare dashboard | The account that owns the Workers AI allowance. |
| `CF_AI_TOKEN` | yes | API token, `Workers AI: Read` + `Workers AI: Edit` (or the Workers AI template) | Bearer token for the `ai/run` REST endpoint. |

### Refreshing the corpus from CI

Everything above is a manual step, and manual is where the corpus goes stale. The
artifact is built from `knowledge/` and bundled into the worker at `wrangler deploy`,
so the deployed retrieval index is a snapshot of the last time you ran those commands.
Publish an article and chat cannot cite it; the MCP endpoint's `semantic_search`
cannot find it. Nothing about the site build fixes that, because the site build does
not produce the artifact.

`.github/workflows/corpus-refresh.yml` closes the gap. On a push to `main` that
touches `knowledge/**`, it rebuilds the corpus and redeploys the workers that bundle
it. **It does nothing at all until you opt in**, and opting in means giving your CI a
credential that can deploy Workers to your Cloudflare account. That is a real
tradeoff, so read the four bounds before you decide.

**1. Push to `main` only.** The workflow triggers on `push` to `main` with a
`knowledge/**` path filter, plus a manual `workflow_dispatch`. It carries no
`pull_request` trigger and must never gain one: a workflow that holds a deploy
credential and runs pull-request code hands that credential to anyone who opens a
pull request. `npm run corpus-refresh:check` asserts the *absence* of that trigger,
not merely the presence of the others, and runs on every pull request.

**2. Opt-in, and absent-safe.** With no credentials configured, the opt-in gate step
reports `SKIPPED`, every step after it is skipped, and the run is green. That is the
state of a fresh clone and of every instance that never opts in: the hand-deploy path
above stays fully supported and nothing degrades. The same is true of a partial
configuration — one secret without the other is treated as "not configured" rather
than half-run.

**3. Least privilege.** The workflow declares `permissions: contents: read` at the
top level and on its only job, and no `permissions:` block in the file grants a write
scope. It writes to Cloudflare, with your credential; it has no reason to write to
your repository, and the guard fails the build if it ever gains that power.

**4. A documented blast radius.** The token this job needs is strictly broader than
the local embedding-only one documented above. It must carry the embedding permissions
*and* the permission to deploy a Worker script:

```
Account | Workers AI | Read
Account | Workers AI | Edit
Account | Workers Scripts | Edit
```

An adopter who opts in accepts that a compromised Action, a malicious dependency in
this workflow's own toolchain, or a bad merge to `main` can deploy a Worker in their
name. The bounds above are what keep that proportionate; the opt-in is what keeps it
your choice rather than the framework's.

**Opting in.** Mint a token with the three permissions above, scoped to the single
account you deploy from, then store it and the account id as **repository secrets**
(Settings → Secrets and variables → Actions), under the same two names the local
command uses:

```bash
gh secret set CF_ACCOUNT_ID
gh secret set CF_AI_TOKEN
```

Both are required. Neither is ever printed by the job: the gate step reports which
names were missing, never a value.

**What it redeploys, and what it will not.** The job deploys a worker only when the
worker's source imports the corpus artifact *and* your `place.config.ts` both enables
the capability (`features.chat`, `features.mcp`) and records its endpoint
(`workers.chat`, `workers.mcp`). A worker you have not deployed by hand at least once
— no D1 database id, no `IP_HASH_SALT`, no endpoint recorded — is therefore never
published from CI. The deploy targets are derived from the source tree rather than
listed, so a future worker that bundles the artifact is picked up with no edit to the
workflow.

**Trying it without deploying.** A manual dispatch from a branch other than `main` is
a dry run: it rebuilds the corpus, proving the token works, and deploys nothing. The
deploy step is restricted to `refs/heads/main`.

### What a deploy already refreshes

The corpus artifact was the only stale index, and it is worth being precise about why
the others never were. Every push to `main` runs `npm run build` in the Pages
workflow, and npm runs the `prebuild` and `postbuild` chains around it
(`package.json`):

| Index | Rebuilt by | When |
|---|---|---|
| `src/content/` projection of `knowledge/` | `prebuild:sync` | every build |
| `/kb/topics.json`, `/kb/articles/**`, `llms.txt`, `/kb/agent.md` | `prebuild:kb-index` | every build |
| `/kb/search-minisearch*.json`, `/kb/search-index.json` | `prebuild:search` | every build |
| The `/graph` node/edge set | rendered by `src/pages/graph.astro` from `src/content/`, contract-checked by `postbuild:graph` | every build |

So the search index, the `/kb/` protocol files, and the graph are regenerated from
`knowledge/` on every deploy by construction — they are build outputs of the site
itself. The corpus vectors are not: they are produced by a separate command that calls
a paid API and are bundled into a Worker rather than served from `dist/`, which is
exactly why they needed a job of their own. `npm run corpus-refresh:check` fails if
any of those four npm entries is renamed out from under this table.

### Revoking the CI refresh

Revocation is one action, and it takes effect on the next run:

```bash
gh secret delete CF_AI_TOKEN
gh secret delete CF_ACCOUNT_ID
```

The job returns to its default no-op-green state — nothing else in the repository has
to change, no workflow is edited, and the hand-deploy path is unaffected. To revoke
the credential itself as well (the right move if it may have leaked), roll or delete
the token in the Cloudflare dashboard under My Profile → API Tokens; that also stops
any copy of it that is no longer in your repository.

### Deploying the chat worker

Build the corpus embeddings first. The generated `workers/lib/vectors.json` is a
required module import, so `wrangler deploy` fails if the artifact is absent. Rebuild
it after every `knowledge/` change before redeploying the worker.

**1. Generate the worker config and create its D1 database.** The D1 database holds
only hashed-address rolling rate-limit counters. Cloudflare's native Rate Limiting
binding supports only 10- or 60-second periods, so it cannot implement this worker's
configurable 3,600-second exact rolling window.

```bash
npm run worker-config
npx wrangler d1 create <place-slug>-chat \
  --config workers/chat/wrangler.generated.toml
```

Put the printed id in the instance-owned config and regenerate:

```ts
workers: {
  chat: '',
  chatDatabaseId: 'PASTE_THE_DATABASE_ID',
},
```

```bash
npm run worker-config
npx wrangler d1 migrations apply <place-slug>-chat --remote \
  --config workers/chat/wrangler.generated.toml
```

**2. Set the IP-hash salt.** The worker refuses POST requests with HTTP 500 when
the salt is absent or blank. It stores `sha256(address + salt)`, never the address.

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT \
  --config workers/chat/wrangler.generated.toml
```

**3. Deploy and record the endpoint.** The committed template declares the Workers
AI binding as `AI`; no API token is needed for inference inside the deployed Worker.

```bash
npx wrangler deploy --config workers/chat/wrangler.generated.toml
```

```ts
features: { chat: true, /* ... */ },
workers: {
  chat: 'https://<place-slug>-chat.<subdomain>.workers.dev',
  chatDatabaseId: '…',
},
```

Rebuild and redeploy the static site after setting the endpoint. `ALLOWED_ORIGIN`
is derived from `place.domain` and exact-match CORS rejects every other origin.

<!-- worker-vars: chat -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `AI` | yes | `[ai] binding = "AI"` | Workers AI binding used for query embedding and streamed answer generation. |
| `DB` | yes | `[[d1_databases]] binding = "DB"` | Exact rolling-window rate-limit state. |
| `ALLOWED_ORIGIN` | yes | `place.domain` | The only accepted browser origin. Unset or mismatched requests receive 403. |
| `SITE_NAME` | yes | `place.name` | Site identity injected into the system prompt. |
| `IP_HASH_SALT` | yes (secret) | `wrangler secret put` | Salt for the stored address hash. Missing or blank requests receive 500. |
| `RATE_LIMIT_MAX` | no | template (`20`), override `workers.chatRateLimitMax` | Accepted requests per hashed address in the rolling window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | template (`3600`), override `workers.chatRateLimitWindowSeconds` | Exact rolling-window duration in seconds. |
| `RELEVANCE_FLOOR` | no | template (`0.46`), override `workers.chatRelevanceFloor` | Cosine score a chunk must reach to be retrieved. Nothing clears it means nothing is cited and the answer refuses. See below. |

The three rows above carry an **override**: the committed `workers/chat/wrangler.toml`
is framework-owned and ships the default, but you can set a different value in
`place.config.ts` under `workers` and `npm run worker-config` writes it into the
generated config. Editing the committed template directly is not forbidden — it is your
repository, and `npm run worker-config:check` warns rather than failing your build for
it — but the override key is the cheaper home: it is instance-owned, so it never
conflicts on a framework upgrade, while a retuned template value conflicts on every
release until you and the framework agree again (`UPGRADE.md` §Framework-owned
files). Leave a key unset and the template default is carried through
unchanged, so an instance that sets none behaves exactly as it did before these keys
existed. A value the worker could not use is rejected at generation time by name — a
rate limit below `1`, a floor outside `0..1`, a fractional count, anything non-numeric —
rather than deploying and silently falling back to the default.

```ts
workers: {
  // ...
  chatRateLimitMax: 60,
  chatRelevanceFloor: 0.52,
},
```

If a later framework release drops one of these vars from the template, the key you set
has nothing left to override. `npm run worker-config` does not stop for that — it names
the key and the value, writes every other worker's config as usual, and tells you the
value was left out, so one stale key never blocks a deploy. Read that release's
CHANGELOG before going further: a var removed from the template usually means the worker
stopped reading it.

The rate limit is keyed on `sha256(address + salt)`, which is **per public address, not
per person**: everyone behind one NAT shares one budget. A hotspot, a cafe, a hotel, a
school, and a QR code that puts the chat in front of a group standing in one place all
land on the same key. Raise `chatRateLimitMax` for placements busier than the default
assumes.

### Tuning the relevance floor

Retrieval takes the top five chunks by cosine similarity, which on its own can never
say "the corpus does not cover this": a fixed count off a sorted list always returns
five, so a question with no support still cites the five least-bad matches. That is a
fabricated source list wearing real URLs. `RELEVANCE_FLOOR` is the cutoff that makes an
empty result reachable. Below it a chunk is not retrieved, so it never enters the
prompt and never becomes a citation; when nothing clears it the model is told outright
that no excerpt is relevant, and the page renders "no sources found".

**The shipped default in the table above is measured against the template's demo
corpus, and your corpus is not that corpus.** Re-measure it after your content settles:

1. Build the vectors (`npm run embeddings:build`) so you are scoring against the same
   artifact the worker loads.
2. Assemble two lists of questions: ten or so your articles genuinely answer, and five
   or so about places or topics your knowledge base never mentions.
3. Embed each question with `@cf/baai/bge-m3` and score it against every chunk in
   `workers/lib/vectors.json`, exactly as the worker does: L2-normalize the query and
   take its dot product with each stored vector divided by 127.
4. Compare the best score per question across the two lists. Set the floor in the gap
   between them.
5. Record that value in `place.config.ts` as `workers.chatRelevanceFloor`, then
   `npm run worker-config` and redeploy. That key is the supported home for a measured
   floor: it is instance-owned, it survives every `/sekai-upgrade`, and the generated
   config it feeds is what `wrangler deploy` reads. Writing the number into
   `workers/chat/wrangler.toml` instead also works and is allowed — the gate warns,
   naming both values and the cost, rather than failing your build — but it forks a
   framework-owned file, so it conflicts on each release until you upstream it. A value
   typed into the Cloudflare dashboard is the one option that does not work at all: the
   next deploy overwrites it from the generated config.

```ts
workers: {
  // ...
  chatRelevanceFloor: 0.52,
},
```

On the demo corpus, measured 2026-08-08, that gap runs from 0.435 (the best score any
never-mentioned place reached) to 0.484 (the worst score a real question reached), and
the shipped default splits it. Set the floor too high and real questions start refusing;
too low and off-topic questions keep citing. Setting it to `0` disables filtering
entirely.

**What the floor cannot do.** It separates questions about *other* places. It does not
separate questions about *your* place that no article happens to answer: those are dense
with your vocabulary and score at or above genuinely answerable questions (0.512 to
0.595 on the demo corpus, against a real-question floor of 0.484). No cutoff catches
those without also rejecting real questions, so for them the refusal appears in the
answer text and a person is what verifies it. The evaluation set below encodes that
split directly, as `expect: no-citations` versus `expect: refusal-in-answer`.

### Evaluating the deployed chat

`knowledge/chat/_eval.md` is an optional list of questions with the articles each answer
should rest on. `npm run chat:eval` posts every one to a deployed worker and exits
nonzero when a cited URL resolves to no published article, when a question declaring
`expect: no-citations` cites anything, or when a request errors. It writes
`reports/chat-eval.md` with every question, answer, and citation set.

```bash
npm run chat:eval
npm run chat:eval -- --endpoint https://your-chat-worker.workers.dev
```

The endpoint comes from `workers.chat`, the presented origin from `place.domain`, and
the published-article index from your local `public/kb/topics.json` when it exists,
otherwise from `/kb/topics.json` on your site. `--endpoint`, `--origin`, `--topics`, and
`--out` override each of those.

Answer quality is deliberately not machine-judged: scoring prose would need a second
model in the loop or a brittle string match against a free-tier model's phrasing. Read
the report and confirm each answer is grounded in what it cites and that the refusal
questions refused. An absent manifest exits 0 with "no evaluation set", so an instance
that never writes one is not broken.

### Deploying the MCP worker

`workers/mcp/` is a remote [Model Context Protocol](https://modelcontextprotocol.io)
server: an AI client registers its URL once and can then list your topics, read an
article, keyword-search, and search by meaning, without cloning anything.

**Deploy it only if you need it.** `/llms.txt` and `/kb/` already serve any consumer
able to fetch a URL, at zero infrastructure cost, and they are the primary AI path.
This worker exists for what those cannot do: clients that fetch no arbitrary URLs, a
tool a user opts into once rather than a URL they must remember, and semantic search.

It is **stateless** — no Durable Objects, no sessions — which is what keeps it inside
the Workers free tier. An instance that outgrows that (per-connection state,
server-initiated messages) moves to the MCP SDK's `McpAgent` on Durable Objects, which
is a paid product; nothing here has to change until then.

Build the corpus embeddings first. `workers/lib/vectors.json` is a required module
import for `semantic_search`, so `wrangler deploy` fails if the artifact is absent.

**1. Generate the worker config and create its D1 database.** The database holds only
hashed-address rolling rate-limit counters, exactly as the chat worker's does.

```bash
npm run worker-config
npx wrangler d1 create <place-slug>-mcp \
  --config workers/mcp/wrangler.generated.toml
```

Put the printed id in the instance-owned config and regenerate:

```ts
workers: {
  mcp: '',
  mcpDatabaseId: 'PASTE_THE_DATABASE_ID',
},
```

```bash
npm run worker-config
npx wrangler d1 migrations apply <place-slug>-mcp --remote \
  --config workers/mcp/wrangler.generated.toml
```

**2. Set the IP-hash salt.** `semantic_search` refuses to run without it rather than
hashing addresses unsalted. It stores `sha256(address + salt)`, never the address.

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT \
  --config workers/mcp/wrangler.generated.toml
```

**3. Deploy and record the endpoint.**

```bash
npx wrangler deploy --config workers/mcp/wrangler.generated.toml
```

```ts
features: { mcp: true, /* ... */ },
workers: {
  mcp: 'https://<place-slug>-mcp.<subdomain>.workers.dev',
  mcpDatabaseId: '…',
},
```

Rebuild and redeploy the static site afterwards: `llms.txt` lists the MCP endpoint
only when `features.mcp` is on **and** `workers.mcp` is non-empty, so an endpoint that
is not yet deployed is never advertised.

**4. Connect a client.** Most MCP clients take a remote Streamable-HTTP server as a URL.
The shape below is what a client's own config file expects; check yours for the exact
key names. Once the site is rebuilt, your own `/ai` page renders this same snippet with
your endpoint already filled in, alongside every other AI path this instance serves.

```json
{
  "mcpServers": {
    "place-kb": {
      "type": "http",
      "url": "https://<place-slug>-mcp.<subdomain>.workers.dev"
    }
  }
}
```

A client that lists `list_topics`, `get_article`, `search`, and `semantic_search` after
connecting has a working endpoint. To check it by hand:

```bash
curl -s -X POST https://<place-slug>-mcp.<subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**This endpoint rejects every request carrying an `Origin` header.** Intended MCP
clients are desktop applications and editors, which send no `Origin`; rejecting the
browser-only path also closes the DNS-rebinding attack required by Streamable HTTP's
security contract. Three of the four tools only re-serve files your site already
publishes to the world. The fourth, `semantic_search`, spends your Workers AI allowance
and also carries the rate limit below.

<!-- worker-vars: mcp -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `AI` | yes | `[ai] binding = "AI"` | Workers AI binding used to embed a `semantic_search` query. |
| `DB` | yes | `[[d1_databases]] binding = "DB"` | Exact rolling-window rate-limit state. |
| `SITE_ORIGIN` | yes | `place.domain` | Origin the three site-backed tools fetch `/kb/*` from. |
| `SITE_NAME` | yes | `place.name` | Server name an MCP client shows for this endpoint. |
| `IP_HASH_SALT` | yes (secret) | `wrangler secret put` | Salt for the stored address hash. Missing or blank makes `semantic_search` refuse. |
| `RATE_LIMIT_MAX` | no | template (`20`), override `workers.mcpRateLimitMax` | Accepted `semantic_search` calls per hashed address in the rolling window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | template (`3600`), override `workers.mcpRateLimitWindowSeconds` | Exact rolling-window duration in seconds. |
| `RELEVANCE_FLOOR` | no | template (`0.46`), override `workers.mcpRelevanceFloor` | Cosine score a passage must reach for `semantic_search` to return it. Nothing clears it means the tool returns nothing, which is the honest answer. |

The three overridable rows work exactly as the chat worker's do — set the
`workers.<key>` in `place.config.ts` rather than editing the committed template, and
`npm run worker-config` writes your value into the generated config. §Tuning the
relevance floor below is the same procedure for both workers; they read one corpus, so
one measurement serves both floors.

The rate limit is keyed on `sha256(address + salt)`, which is **per public address, not
per person**. An MCP client is usually one person on one connection, so the default is
more generous per user than the same number is on the chat page; a shared machine or an
office behind one NAT still shares one budget.

### QR codes for physical places

A visitor standing at a trailhead has no app, no account, and no reason to search. A
printed code is the whole onboarding: it opens `/chat?ctx=<slug>`, which greets them for
the spot they are standing in and steers the first question toward the articles about it.

Declare the places in `knowledge/chat/_contexts.md` — optional, gray-matter frontmatter,
an ordered `contexts` list, body free for your own notes. The leading `_` is what keeps
the file invisible to the three scanners that walk `knowledge/` looking for articles;
never rename it without the prefix.

A context requires `slug`, `label`, `greeting`. A context also accepts optional `hint`,
`article`.

```yaml
---
contexts:
  - slug: north-dock
    label: North Dock
    greeting: >-
      You are at the north dock. Ask about the boats, the birds, or how this
      stretch of water got its name.
    hint: the north dock and the water around it
    article: /places/north-dock
---
```

- **`slug`** is the `ctx` query value and goes into a printed URL, so it is restricted to
  lowercase letters, digits, and single hyphens.
- **`greeting`** is the opening message. Write it for somebody holding a phone in the
  wind, not for a reader at a desk.
- **`hint`** biases *retrieval* toward this location. It is appended to the text that gets
  embedded for the reader's first question and is never shown to the model as an
  instruction, so a hint changes which articles are found and cannot change how the
  answer is written. It rides the first question only: by the third, the reader has moved
  on. A `hint` is capped at 200 characters, the longest one the chat worker accepts; a
  longer one is ignored with a build-time warning and the context keeps working, because
  sending it would fail every question asked from that context and take the printed code
  out of service.
- **`article`** is a site-root-absolute route your build produces, rendered as a link
  under the greeting. A route that resolves to nothing drops that whole context with a
  build-time warning, because a greeting that sends a reader at a 404 is worse than one
  code that does nothing.

Contexts are dropped one at a time. A duplicate `slug`, a missing required field, an
unusable `slug`, and an unresolvable `article` each take out that one entry with a named
warning in the build log and leave every other code working. An `unknown` or absent `ctx`
in a URL is not an error either: the page opens exactly as it does for a reader who typed
it, which is what makes a code outliving its sign harmless.

Print the codes:

```bash
npm run qr:sheet
```

That writes `qr-sheet.html` at the repository root — gitignored, because it is a print
artifact regenerated on demand, not repository content. Open it in a browser and print.
Each card carries the code, the place's name, and the URL in plain text for anyone who
would rather type it; the sheet is laid out to fit both A4 and US Letter without choosing
a paper size, and everything including the codes is inline, so it prints correctly from a
`file://` URL with no network. With no manifest it exits 0 saying no contexts are
declared — declaring none is not a failure. A manifest whose contexts were *all* dropped
by validation is the opposite state and exits nonzero naming how many, because an empty
sheet from a manifest you wrote is a manifest to go fix, not a place with nothing on a
wall yet.

The flags, all optional: `--domain`, `--out`, `--root`.

| Flag | Default | Use it when |
|---|---|---|
| `--domain <host>` | `place.domain` | Printing codes for a domain you have not put in the config yet — a staging host, or a rehearsal before the site goes live. |
| `--out <path>` | `qr-sheet.html` | Keeping several sheets side by side, or writing outside the repository. Only the default path is gitignored. |
| `--root <path>` | this repository | Printing another instance's sheet without leaving this one. It is also how the CLI's own test suite drives it against a temporary tree. |

No build is required. The `article` links are checked against the routes your build
produces, and that set is derived from `knowledge/` and `place.config.ts` — the same set
`/chat` itself validates against — so the sheet can be printed before the site has ever
been built.

**Model and free-tier contract.** `CHAT_MODEL` in `workers/chat/src/index.mjs` is
the single generation-model constant. On 2026-08-07 it was verified against the
[Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/)
and the [model's streaming API documentation](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
as `@cf/zai-org/glm-4.7-flash`, a Cloudflare-hosted, streaming-capable model. The
Workers AI free allocation is
10,000 neurons per day, shared by corpus builds, per-request query embeddings, and
answer generation. Monitor that account-level total; if answer quality requires a
hosted paid model, follow the dated quality/cost escalation analysis in
[the upstream platform notes §2.10](https://github.com/wilsonkichoi/sekai-kb/blob/main/dev%5Fdocs/research/platform-notes.md#210-cost-and-platform-comparison)
and re-verify the model and pricing at selection time. The SPEC intentionally does
not pin a generation model.

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
