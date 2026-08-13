#!/usr/bin/env node
// corpus-refresh-gate.mjs -- the opt-in gate for the CI corpus refresh.
//
// The corpus refresh workflow is the ONE place CI is allowed to deploy a Worker, and
// it is opt-in: an adopter who configures no Cloudflare credentials must get a green
// run that builds nothing, deploys nothing, and says why. That decision lives here
// rather than in an inline `if` expression in the workflow for one reason -- a
// workflow expression can only be exercised by running the workflow, which needs a
// push to the default branch, so nothing could prove the no-op path before it shipped.
// As a script it is unit-tested on every pull request instead.
//
// It reads the two variables `npm run embeddings:build` already documents
// (docs/runbook/DEPLOY.md), decides configured / not configured, and writes
// `configured=true|false` to $GITHUB_OUTPUT for the steps that follow to gate on.
//
// It ALWAYS exits 0. "Not configured" is a supported state, not a failure: failing
// here would turn an adopter's deliberate non-participation into a red build.
//
// It never prints either value. `CF_ACCOUNT_ID` is an identifier rather than a
// credential, but printing it in a public log buys nothing, and the token must never
// appear anywhere.
//
// Usage: node scripts/deploy/corpus-refresh-gate.mjs
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The environment variables the corpus build reads, in the order they are reported. */
export const REQUIRED_VARS = ['CF_ACCOUNT_ID', 'CF_AI_TOKEN'];

/**
 * Decide whether this repository has opted in.
 *
 * Configured means every required variable is present and non-blank. A whitespace-only
 * value is treated as absent: that is what an empty repository secret expands to, and
 * carrying it forward would fail later inside the embedding build with a worse message.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ configured: boolean, missing: string[], reason: string }}
 */
export function evaluateGate(env) {
  const missing = REQUIRED_VARS.filter((name) => !String(env?.[name] ?? '').trim());
  if (missing.length === 0) {
    return {
      configured: true,
      missing,
      reason: `every required secret is set (${REQUIRED_VARS.join(', ')})`,
    };
  }
  return {
    configured: false,
    missing,
    reason: `no corpus refresh credentials configured (missing: ${missing.join(', ')})`,
  };
}

/* -- CLI ------------------------------------------------------------------- */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateGate(process.env);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `configured=${result.configured}\n`);
  }

  if (result.configured) {
    console.log(`corpus refresh: ENABLED -- ${result.reason}.`);
  } else {
    console.log(`corpus refresh: SKIPPED -- ${result.reason}.`);
    console.log(
      'Nothing was built and nothing was deployed. This is the default: the refresh is ' +
        'opt-in, and the hand-deploy path in docs/runbook/DEPLOY.md stays fully supported.',
    );
  }

  process.exit(0);
}
