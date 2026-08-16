/**
 * check-dashboard.mjs — postbuild contract test for /dashboard.
 *
 * Asserts:
 *   - dist/dashboard/index.html exists and is non-empty
 *   - When src/data/dashboard-lite.json has available:true, the rendered page
 *     contains the rollup totals and immune score from that JSON.
 *   - When available:false (or JSON absent), the page contains the degraded marker.
 *   - Analytics (ADR 012): the section is absent when features.analytics is false,
 *     and present with one panel per source when it is true. Each panel's state is
 *     checked against the source file that build actually had, so a build whose
 *     fetch produced two of three files is asserted to render two panels and one
 *     named unavailable state — the per-source degradation the SPEC requires,
 *     verified on the real rendered page rather than in a unit test alone.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const PAGE = resolve(ROOT, 'dist/dashboard/index.html');
const DATA = resolve(ROOT, 'src/data/dashboard-lite.json');

const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const { ANALYTICS_SOURCES, resolveAnalyticsPanels } = await import(
  resolve(ROOT, 'src/lib/analytics-sources.ts')
);

const errors = [];

if (!existsSync(PAGE)) {
  console.error('❌ dashboard check FAILED: dist/dashboard/index.html does not exist');
  process.exit(1);
}

const html = readFileSync(PAGE, 'utf8');
if (html.length < 100) {
  console.error('❌ dashboard check FAILED: dist/dashboard/index.html is effectively empty');
  process.exit(1);
}

let dashData = null;
if (existsSync(DATA)) {
  try {
    dashData = JSON.parse(readFileSync(DATA, 'utf8'));
  } catch (e) {
    errors.push(`cannot parse ${DATA}: ${e.message}`);
  }
}

if (dashData?.available === true) {
  const { rollup, immune } = dashData;
  if (rollup) {
    if (!html.includes(String(rollup.total))) {
      errors.push(`rollup.total (${rollup.total}) not found in rendered page`);
    }
    if (!html.includes(`${rollup.passRate}%`)) {
      errors.push(`rollup.passRate (${rollup.passRate}%) not found in rendered page`);
    }
  } else {
    errors.push('dashData.available=true but rollup is null');
  }
  if (immune) {
    if (!html.includes(String(immune.score))) {
      errors.push(`immune.score (${immune.score}) not found in rendered page`);
    }
  } else {
    errors.push('dashData.available=true but immune is null');
  }
} else {
  if (!html.includes('data-degraded')) {
    errors.push('dashboard JSON unavailable but degraded marker not found in page');
  }
}

/* -- Analytics section (ADR 012) --------------------------------------------
 *
 * The panels are checked against the source files THIS build had, not against a
 * fixture: the whole point of the ephemeral fetch is that a production build's
 * available sources vary run to run, and each one has to degrade on its own.
 */
const analytics = resolveAnalyticsPanels(placeConfig, ROOT);
const hasSection = html.includes('data-analytics');

if (!analytics.enabled) {
  if (hasSection) {
    errors.push(
      'features.analytics is false but the rendered page still carries the data-analytics section',
    );
  }
} else {
  if (!hasSection) {
    errors.push(
      'features.analytics is true but the rendered page carries no data-analytics section',
    );
  }
  for (const state of analytics.sources) {
    const panel = `data-analytics-source="${state.id}"`;
    if (!html.includes(panel)) {
      errors.push(`analytics panel for source '${state.id}' is missing from the rendered page`);
      continue;
    }
    const body = html.slice(html.indexOf(panel));
    const next = ANALYTICS_SOURCES.map((d) => `data-analytics-source="${d.id}"`)
      .filter((marker) => marker !== panel)
      .map((marker) => body.indexOf(marker))
      .filter((index) => index > 0);
    const scope = next.length > 0 ? body.slice(0, Math.min(...next)) : body;

    if (state.available) {
      if (!scope.includes('data-analytics-state="available"')) {
        errors.push(
          `analytics source '${state.id}' has a valid source file but its panel is not rendered as available`,
        );
      }
      const period = `${state.data.period.start} to ${state.data.period.end}`;
      if (!scope.includes(period)) {
        errors.push(`analytics source '${state.id}' panel does not render its period (${period})`);
      }
      const fetchedOn = String(state.data.fetchedAt).slice(0, 10);
      if (!scope.includes(fetchedOn)) {
        errors.push(`analytics source '${state.id}' panel does not render its fetchedAt date (${fetchedOn})`);
      }
    } else {
      if (!scope.includes('data-analytics-state="unavailable"')) {
        errors.push(
          `analytics source '${state.id}' is ${state.reason} but its panel is not rendered as unavailable`,
        );
      }
      if (!scope.includes(`data-analytics-reason="${state.reason}"`)) {
        errors.push(
          `analytics source '${state.id}' panel does not name its unavailable reason ('${state.reason}')`,
        );
      }
      if (!scope.includes(state.label)) {
        errors.push(
          `analytics source '${state.id}' unavailable panel does not name the source ('${state.label}')`,
        );
      }
    }
  }
}

if (errors.length) {
  console.error(`❌ dashboard check FAILED:\n${errors.map(e => `   - ${e}`).join('\n')}`);
  process.exit(1);
}

const analyticsNote = analytics.enabled
  ? ` Analytics: ${analytics.sources.filter((s) => s.available).length}/${analytics.sources.length} source(s) available.`
  : ' Analytics section off (features.analytics is false).';
console.log(`✅ dashboard check passed: page renders expected data.${analyticsNote}`);
