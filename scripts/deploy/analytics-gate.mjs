#!/usr/bin/env node
// analytics-gate.mjs -- the credential-state gate for the production analytics fetch.
//
// The Pages build job fetches analytics immediately before Astro, on a push to main
// only (ADR 012). Whether that fetch runs at all is decided here rather than in an
// inline `if` expression, for the same reason the corpus refresh gate is a script:
// a workflow expression can only be exercised by a run on the default branch, which
// is after the change has already shipped. As a script it is unit-tested on every
// pull request instead.
//
// Three states, because "configured" and "not configured" do not describe what an
// adopter can actually have:
//
//   none        no analytics secret is set. This is a fresh clone and the default.
//               Green skip: the site builds, every dashboard panel reports its own
//               unavailable state, nothing is red.
//   complete    all five secrets are set. The fetch runs.
//   incomplete  some but not all are set. This is a misconfiguration -- half a
//               credential set cannot produce a valid result for any provider, and
//               running the fetch anyway would send credentialed requests that must
//               fail. So the fetch does NOT run, and the state is reported as a
//               visible error annotation while the site build continues. Silence
//               here is the failure mode this state exists to prevent: an adopter
//               who pasted four of five secrets would otherwise see a green build
//               and an empty dashboard with no clue why.
//
// It ALWAYS exits 0. All three states are supported outcomes of somebody's
// configuration, and failing here would turn either non-participation or a typo
// into a blocked production deploy of unrelated content.
//
// It never prints a VALUE. Two of these five are credentials outright, and the other
// three are account-scoped identifiers whose presence in a public build log buys
// nothing (SPEC section Negative requirements).
//
// Usage: node scripts/deploy/analytics-gate.mjs
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The Actions credential set `npm run fetch:analytics` reads, in the order they are
 * reported. Mirrors the table in docs/runbook/DEPLOY.md section Analytics signal
 * fetchers. `GOOGLE_SERVICE_ACCOUNT_JSON` is the Actions form of the service-account
 * key; the workflow materializes it to runner-temporary storage and hands the fetcher
 * a path, so the raw JSON never enters the fetch step's environment.
 */
export const REQUIRED_VARS = [
  'GA4_PROPERTY_ID',
  'SC_SITE_URL',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'CF_ZONE_ID',
  'CF_API_TOKEN',
];

/**
 * Decide the credential state of this repository.
 *
 * A whitespace-only value is treated as absent: that is what an unset repository
 * secret expands to, and carrying it forward would fail later inside a provider with
 * a worse message.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ state: 'complete' | 'incomplete' | 'none', missing: string[], present: string[], reason: string }}
 */
export function evaluateGate(env) {
  const present = REQUIRED_VARS.filter((name) => String(env?.[name] ?? '').trim() !== '');
  const missing = REQUIRED_VARS.filter((name) => !present.includes(name));

  if (missing.length === 0) {
    return {
      state: 'complete',
      missing,
      present,
      reason: `every analytics secret is set (${REQUIRED_VARS.join(', ')})`,
    };
  }
  if (present.length === 0) {
    return {
      state: 'none',
      missing,
      present,
      reason: 'no analytics credentials configured',
    };
  }
  return {
    state: 'incomplete',
    missing,
    present,
    reason: `an incomplete analytics credential set is configured (missing: ${missing.join(', ')})`,
  };
}

/* -- CLI ------------------------------------------------------------------- */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateGate(process.env);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `state=${result.state}\nconfigured=${result.state === 'complete'}\n`,
    );
  }

  if (result.state === 'complete') {
    console.log(`analytics fetch: ENABLED -- ${result.reason}.`);
  } else if (result.state === 'none') {
    console.log(`analytics fetch: SKIPPED -- ${result.reason}.`);
    console.log(
      'Nothing was fetched. This is the default: the production fetch is opt-in, the ' +
        'site build continues, and each dashboard analytics panel reports its own ' +
        'unavailable state.',
    );
  } else {
    console.log(`analytics fetch: INCOMPLETE -- ${result.reason}.`);
    console.log(
      `::error::Analytics credentials incomplete: ${result.missing.length} of ` +
        `${REQUIRED_VARS.length} analytics secrets are not set (${result.missing.join(', ')}). ` +
        'No credentialed request was sent. The site build continues and the dashboard ' +
        'analytics panels report their unavailable state. Set the missing secrets, or ' +
        'remove the ones that are set, to return this build to a clean state.',
    );
  }

  process.exit(0);
}
