// tests/analytics-gate.test.mjs — the analytics injection gate.
//
// Verifies that HeadInlineScripts injects GA4 and/or Cloudflare Web Analytics
// only when features.analytics is true AND the provider's own non-empty id
// exists. Five named cases from the DoD:
//
//   1. missing or false features.analytics → neither provider injected
//   2. both public IDs present → both providers injected
//   3. only GA4 measurement ID → only GA4
//   4. only Cloudflare Web Analytics token → only Cloudflare
//   5. blank provider values behave as absent
//
// Fixtures are synthetic: tests/ is framework code that ships to every adopter,
// so nothing may assume the demo config or any place name.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { resolveAnalytics } from '../src/lib/analytics.ts';

const GA4_ID = 'G-TESTMEASURE';
const CF_TOKEN = 'abcdef0123456789abcdef0123456789';

function config(analyticsFlag, analytics) {
  return { features: { analytics: analyticsFlag }, analytics };
}

describe('resolveAnalytics gate', () => {
  it('case 1a: features.analytics missing → neither provider enabled', () => {
    const result = resolveAnalytics({ features: {} });
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, false);
  });

  it('case 1b: features.analytics false → neither provider enabled', () => {
    const result = resolveAnalytics(
      config(false, { ga4MeasurementId: GA4_ID, cloudflareWebAnalyticsToken: CF_TOKEN }),
    );
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, false);
  });

  it('case 2: both public IDs present → both providers enabled', () => {
    const result = resolveAnalytics(
      config(true, { ga4MeasurementId: GA4_ID, cloudflareWebAnalyticsToken: CF_TOKEN }),
    );
    assert.equal(result.ga4.enabled, true);
    assert.equal(result.ga4.measurementId, GA4_ID);
    assert.equal(result.cloudflare.enabled, true);
    assert.equal(result.cloudflare.token, CF_TOKEN);
  });

  it('case 3: only GA4 measurement ID → only GA4 enabled', () => {
    const result = resolveAnalytics(config(true, { ga4MeasurementId: GA4_ID }));
    assert.equal(result.ga4.enabled, true);
    assert.equal(result.ga4.measurementId, GA4_ID);
    assert.equal(result.cloudflare.enabled, false);
  });

  it('case 4: only Cloudflare token → only Cloudflare enabled', () => {
    const result = resolveAnalytics(config(true, { cloudflareWebAnalyticsToken: CF_TOKEN }));
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, true);
    assert.equal(result.cloudflare.token, CF_TOKEN);
  });

  it('case 5a: blank GA4 ID behaves as absent', () => {
    const result = resolveAnalytics(
      config(true, { ga4MeasurementId: '', cloudflareWebAnalyticsToken: CF_TOKEN }),
    );
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, true);
  });

  it('case 5b: whitespace-only GA4 ID behaves as absent', () => {
    const result = resolveAnalytics(
      config(true, { ga4MeasurementId: '   ', cloudflareWebAnalyticsToken: CF_TOKEN }),
    );
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, true);
  });

  it('case 5c: blank Cloudflare token behaves as absent', () => {
    const result = resolveAnalytics(
      config(true, { ga4MeasurementId: GA4_ID, cloudflareWebAnalyticsToken: '' }),
    );
    assert.equal(result.ga4.enabled, true);
    assert.equal(result.cloudflare.enabled, false);
  });

  it('a config predating the analytics block reads as off', () => {
    const result = resolveAnalytics({ features: { analytics: true } });
    assert.equal(result.ga4.enabled, false);
    assert.equal(result.cloudflare.enabled, false);
  });
});

describe('HeadInlineScripts source assertions', () => {
  const source = readFileSync(
    new URL('../src/components/HeadInlineScripts.astro', import.meta.url),
    'utf8',
  );

  it('imports resolveAnalytics from src/lib/analytics', () => {
    assert.match(source, /import\s+\{[^}]*resolveAnalytics[^}]*\}\s+from\s+['"]\.\.\/lib\/analytics['"]/);
  });

  it('reads placeConfig and calls resolveAnalytics', () => {
    assert.match(source, /resolveAnalytics\(placeConfig\)/);
  });

  it('GA4 gtag script is syntactically inside a ga4.enabled conditional', () => {
    assert.match(
      source,
      /\{ga4\.enabled && \([\s\S]*?googletagmanager\.com\/gtag\/js[\s\S]*?\)\}/,
      'the gtag script URL must be enclosed in {ga4.enabled && (...)}',
    );
  });

  it('Cloudflare beacon is syntactically inside a cloudflare.enabled conditional', () => {
    assert.match(
      source,
      /\{cloudflare\.enabled && \([\s\S]*?cloudflareinsights\.com\/beacon\.min\.js[\s\S]*?\)\}/,
      'the beacon script URL must be enclosed in {cloudflare.enabled && (...)}',
    );
  });

  it('GA4 conditional does not contain the Cloudflare beacon', () => {
    const ga4Block = source.match(
      /\{ga4\.enabled && \(([\s\S]*?)\)\}/,
    );
    assert.ok(ga4Block, 'ga4.enabled block must exist');
    assert.doesNotMatch(
      ga4Block[1],
      /cloudflareinsights/,
      'the GA4 conditional must not contain the Cloudflare beacon',
    );
  });

  it('Cloudflare conditional does not contain the GA4 script', () => {
    const cfBlock = source.match(
      /\{cloudflare\.enabled && \(([\s\S]*?)\)\}/,
    );
    assert.ok(cfBlock, 'cloudflare.enabled block must exist');
    assert.doesNotMatch(
      cfBlock[1],
      /googletagmanager/,
      'the Cloudflare conditional must not contain the GA4 script',
    );
  });

  it('does not contain a concrete analytics identifier', () => {
    assert.doesNotMatch(source, /G-[A-Z0-9]{8,}/);
    assert.doesNotMatch(source, /[a-f0-9]{32}/);
  });
});
