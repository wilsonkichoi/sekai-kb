// tests/analytics-delivery.test.mjs -- run with
//   node --experimental-strip-types --test tests/analytics-delivery.test.mjs
//
// LB-107 analytics delivery. Four blocks, one per surface of the published contract:
//
//   A. scripts/deploy/analytics-gate.mjs -- the Actions credential-set decision.
//      DoD 3 (no credentials at all is an explicit GREEN skip) and DoD 4 (an incomplete
//      set is visible, never configured, and never a red exit that would block the site
//      build). `configured=false` is what keeps the fetch step from running, so an
//      incomplete set issues no partial credentialed request.
//   B. src/lib/analytics-sources.ts -- reading and validating one source file.
//      DoD 9: a missing or invalid source degrades only itself. The independent
//      degradation cases are a full matrix over the three sources, not a spot check.
//   C. the format helpers -- DoD 8's "exact normalized values" depend on them, so the
//      rendered-value assertions in block D are hardcoded strings rather than calls
//      back into these helpers (a broken helper must fail block D, not agree with it).
//   D. a real `astro build` against fixture analytics data -- DoD 8 (exact values,
//      period and fetchedAt for all three panels), DoD 9 again in the rendered page,
//      DoD 10 (features.analytics=false removes the section and leaves the
//      article-health dashboard untouched) and DoD 11 (no planted credential reaches
//      src/data/analytics/ or the build output, while the two PUBLIC browser ids do).
//
// Written against the published contract only; nothing here reads the implementation
// of the gate, the source reader, the dashboard template, or the workflow.
//
// tests/ is scanned by both machine gates, so every fixture in this file is pure ASCII,
// carries no place name, and uses obviously synthetic values (alpha/beta/gamma,
// example.test, G-TESTMEASURE). Every credential value is a self-describing placeholder.
//
// Block D mutates two repository paths (place.config.ts and src/data/analytics/) and
// restores them from an exact byte snapshot in an after() hook AND a process exit
// handler. It runs the builds into a temp directory so the repository's own dist/ is
// never clobbered. Run this file on its own: a concurrent build in another test file
// would observe the flipped config.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REQUIRED_VARS, evaluateGate } from '../scripts/deploy/analytics-gate.mjs';
import {
  ANALYTICS_DATA_DIR,
  ANALYTICS_SOURCES,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  formatPosition,
  readAnalyticsSource,
  resolveAnalyticsPanels,
} from '../src/lib/analytics-sources.ts';

/* =========================================================== shared fixtures ========= */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GATE_CLI = join(REPO_ROOT, 'scripts/deploy/analytics-gate.mjs');
const PLACE_CONFIG_PATH = join(REPO_ROOT, 'place.config.ts');

/**
 * Credential values distinctive enough that finding any one of them in the build output,
 * in a source file, or on the gate's stdout proves a leak. Every one is set on every
 * build invocation, which is what makes the DoD 11 scan non-vacuous.
 */
const CREDENTIAL_VALUES = {
  GA4_PROPERTY_ID: 'ga4-property-value-must-not-be-printed',
  SC_SITE_URL: 'sc-site-url-value-must-not-be-printed',
  GOOGLE_SERVICE_ACCOUNT_JSON: 'service-account-json-value-must-not-be-printed',
  CF_ZONE_ID: 'cf-zone-value-must-not-be-printed',
  CF_API_TOKEN: 'cf-token-value-must-not-be-printed',
};
const PLANTED_VALUES = Object.values(CREDENTIAL_VALUES);

/** The two PUBLIC ids browser collection needs. These are allowed to reach the HTML. */
const GA4_MEASUREMENT_ID = 'G-TESTMEASURE';
const CF_WEB_TOKEN = 'aaaabbbbccccddddeeeeffff00001111';

const SOURCE_IDS = ['ga4', 'search-console', 'cloudflare'];

/** The summary fields the spec's schema block makes required, per source. */
const REQUIRED_SUMMARY_FIELDS = {
  ga4: [
    'activeUsers',
    'newUsers',
    'pageViews',
    'sessions',
    'averageSessionDurationSeconds',
    'engagementRate',
  ],
  'search-console': ['clicks', 'impressions', 'ctr', 'averagePosition'],
  cloudflare: ['requests', 'pageViews', 'visits', 'bytes', 'threats'],
};

/** The arrays the spec's schema block makes required, per source. */
const REQUIRED_ARRAYS = {
  ga4: ['topPages', 'trafficSources'],
  'search-console': ['topQueries', 'topPages'],
  cloudflare: ['topCountries', 'statusCodes'],
};

/**
 * Valid normalized fixtures. The numbers are deliberately large and irregular so that a
 * rendered-value assertion cannot pass by coincidence against some other number on the
 * dashboard page.
 */
const VALID_FIXTURES = {
  ga4: {
    schemaVersion: 1,
    source: 'ga4',
    fetchedAt: '2026-07-29T04:15:00Z',
    period: { start: '2026-07-01', end: '2026-07-28', days: 28 },
    summary: {
      activeUsers: 48213,
      newUsers: 39147,
      pageViews: 726358,
      sessions: 61984,
      averageSessionDurationSeconds: 3725,
      engagementRate: 0.6274,
    },
    topPages: [
      { path: '/alpha', title: 'Alpha', views: 51742, activeUsers: 34918 },
      { path: '/beta', title: 'Beta', views: 42631, activeUsers: 28507 },
    ],
    trafficSources: [
      { sourceMedium: 'example.test / referral', sessions: 31846, activeUsers: 24713 },
      { sourceMedium: 'gamma.test / organic', sessions: 19538, activeUsers: 15264 },
    ],
  },
  'search-console': {
    schemaVersion: 1,
    source: 'search-console',
    fetchedAt: '2026-07-29T04:17:00Z',
    period: { start: '2026-06-30', end: '2026-07-27', days: 28 },
    summary: { clicks: 27431, impressions: 918276, ctr: 0.0432, averagePosition: 17.482 },
    topQueries: [
      { query: 'alpha query', clicks: 8462, impressions: 291753, ctr: 0.029, position: 14.62 },
      { query: 'beta query', clicks: 5317, impressions: 184925, ctr: 0.0287, position: 21.38 },
    ],
    topPages: [
      { url: 'https://example.test/alpha', clicks: 9128, impressions: 312467, ctr: 0.0292, position: 11.47 },
      { url: 'https://example.test/beta', clicks: 6743, impressions: 208314, ctr: 0.0324, position: 19.83 },
    ],
  },
  cloudflare: {
    schemaVersion: 1,
    source: 'cloudflare',
    fetchedAt: '2026-07-30T02:05:00Z',
    period: { start: '2026-07-02', end: '2026-07-29', days: 28 },
    summary: { requests: 1284537, pageViews: 493218, visits: 271604, bytes: 7912345678, threats: 8461 },
    topCountries: [
      { country: 'XA', requests: 418293, threats: 3172, bytes: 2418573926 },
      { country: 'XB', requests: 296174, threats: 2481, bytes: 1739284615 },
    ],
    statusCodes: [
      { status: 200, requests: 1174382 },
      { status: 404, requests: 47219 },
    ],
  },
};

/**
 * The exact strings each panel must carry when that source is available: every summary
 * value under the matching format helper, the period as "<start> to <end>", and the
 * fetchedAt date part. Hardcoded rather than computed, so a formatter regression fails
 * here instead of agreeing with itself.
 */
const EXPECTED_PANEL_TEXT = {
  ga4: ['48,213', '39,147', '726,358', '61,984', '1h 2m 5s', '62.74%', '2026-07-01 to 2026-07-28', '2026-07-29'],
  'search-console': ['27,431', '918,276', '4.32%', '17.5', '2026-06-30 to 2026-07-27', '2026-07-29'],
  cloudflare: ['1,284,537', '493,218', '271,604', '7.4 GB', '8,461', '2026-07-02 to 2026-07-29', '2026-07-30'],
};

const tempRoots = [];

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

/** A fresh temp directory, registered for cleanup. */
function tempDir(prefix = 'analytics-delivery-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

/** The descriptor for a source id, taken from the module's own exported list. */
function descriptorFor(id) {
  const descriptor = ANALYTICS_SOURCES.find((entry) => entry.id === id);
  assert.ok(descriptor, `ANALYTICS_SOURCES must carry a descriptor for ${id}`);
  return descriptor;
}

/**
 * Materialize a synthetic root carrying `<root>/<ANALYTICS_DATA_DIR>/`. `files` maps a
 * source id to either an object (written as JSON) or a raw string (written verbatim, so
 * a case can plant unparseable bytes). An id absent from the map has no file at all.
 */
function makeRoot(files = {}) {
  const root = tempDir();
  const directory = join(root, ANALYTICS_DATA_DIR);
  mkdirSync(directory, { recursive: true });
  for (const [id, contents] of Object.entries(files)) {
    const body = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
    writeFileSync(join(directory, descriptorFor(id).file), body);
  }
  return root;
}

/** Read one source out of a synthetic root. */
const readOne = (root, id) => readAnalyticsSource(root, descriptorFor(id));

/** A deep clone of a valid fixture, safe to mutate in a case. */
const validFixture = (id) => JSON.parse(JSON.stringify(VALID_FIXTURES[id]));

/** Every file under a directory, recursively. Returns [] when the directory is absent. */
function filesUnder(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

/* ========================================== BLOCK A: the gate decision (DoD 3, 4) ==== */

/** An env object with every required variable set to its planted value. */
const completeEnv = () => ({ ...CREDENTIAL_VALUES });

describe('DoD 3 + 4: evaluateGate classifies the Actions credential set', () => {
  it('REQUIRED_VARS names the five variables the fetch needs', () => {
    assert.deepEqual(REQUIRED_VARS, [
      'GA4_PROPERTY_ID',
      'SC_SITE_URL',
      'GOOGLE_SERVICE_ACCOUNT_JSON',
      'CF_ZONE_ID',
      'CF_API_TOKEN',
    ]);
  });

  it('DoD 3: no credential at all is state none, with every name reported missing', () => {
    const result = evaluateGate({});
    assert.equal(result.state, 'none');
    assert.deepEqual(result.missing, REQUIRED_VARS);
    assert.deepEqual(result.present, []);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0, 'a none result still carries a reason');
  });

  it('every credential set is state complete, with nothing missing', () => {
    const result = evaluateGate(completeEnv());
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.present, REQUIRED_VARS);
    assert.ok(result.reason.length > 0, 'a complete result still carries a reason');
  });

  for (const name of [
    'GA4_PROPERTY_ID',
    'SC_SITE_URL',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'CF_ZONE_ID',
    'CF_API_TOKEN',
  ]) {
    it(`DoD 4: ${name} missing while the other four are set is state incomplete`, () => {
      const env = completeEnv();
      delete env[name];
      const result = evaluateGate(env);
      assert.equal(result.state, 'incomplete');
      assert.deepEqual(result.missing, [name]);
      assert.deepEqual(
        result.present,
        REQUIRED_VARS.filter((variable) => variable !== name),
        'present keeps REQUIRED_VARS order',
      );
      assert.ok(result.reason.includes(name), `the reason must name ${name}, got: ${result.reason}`);
    });

    it(`DoD 4: ${name} set on its own while the other four are absent is state incomplete`, () => {
      const result = evaluateGate({ [name]: CREDENTIAL_VALUES[name] });
      assert.equal(result.state, 'incomplete');
      assert.deepEqual(result.present, [name]);
      assert.deepEqual(
        result.missing,
        REQUIRED_VARS.filter((variable) => variable !== name),
        'missing keeps REQUIRED_VARS order',
      );
    });
  }

  it('missing and present partition REQUIRED_VARS in every state', () => {
    const partials = [
      {},
      completeEnv(),
      { GA4_PROPERTY_ID: CREDENTIAL_VALUES.GA4_PROPERTY_ID },
      { CF_ZONE_ID: CREDENTIAL_VALUES.CF_ZONE_ID, CF_API_TOKEN: CREDENTIAL_VALUES.CF_API_TOKEN },
    ];
    for (const env of partials) {
      const result = evaluateGate(env);
      const union = [...result.present, ...result.missing].sort();
      assert.deepEqual(union, [...REQUIRED_VARS].sort(), `partition broken for ${Object.keys(env)}`);
      assert.equal(
        new Set(union).size,
        REQUIRED_VARS.length,
        `a variable appeared in both lists for ${Object.keys(env)}`,
      );
    }
  });

  for (const [what, blank] of [
    ['an empty string', ''],
    ['a single space', ' '],
    ['whitespace only', '   \t  '],
    ['a newline only', '\n'],
  ]) {
    it(`${what} counts as absent: that is what an unset repository secret expands to`, () => {
      const allBlank = Object.fromEntries(REQUIRED_VARS.map((name) => [name, blank]));
      const none = evaluateGate(allBlank);
      assert.equal(none.state, 'none', `all-blank must read as none, got ${none.state}`);
      assert.deepEqual(none.missing, REQUIRED_VARS);
      assert.deepEqual(none.present, []);

      const mixed = completeEnv();
      mixed.CF_API_TOKEN = blank;
      const partial = evaluateGate(mixed);
      assert.equal(partial.state, 'incomplete');
      assert.deepEqual(partial.missing, ['CF_API_TOKEN']);
    });
  }

  it('a value with surrounding whitespace still counts as present', () => {
    const env = completeEnv();
    env.GA4_PROPERTY_ID = `  ${CREDENTIAL_VALUES.GA4_PROPERTY_ID}  `;
    env.CF_API_TOKEN = `\t${CREDENTIAL_VALUES.CF_API_TOKEN}\n`;
    const result = evaluateGate(env);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.missing, []);
  });

  it('unrelated environment variables never change the decision', () => {
    const noise = { PATH: '/usr/bin', GITHUB_REF: 'refs/heads/main', HOME: '/home/runner', CI: 'true' };
    assert.equal(evaluateGate({ ...noise }).state, 'none');
    assert.equal(evaluateGate({ ...noise, ...completeEnv() }).state, 'complete');
    assert.equal(
      evaluateGate({ ...noise, GA4_PROPERTY_ID: CREDENTIAL_VALUES.GA4_PROPERTY_ID }).state,
      'incomplete',
    );
  });

  it('the decision reads the passed object, never process.env', () => {
    const saved = REQUIRED_VARS.map((name) => [name, process.env[name]]);
    for (const name of REQUIRED_VARS) process.env[name] = CREDENTIAL_VALUES[name];
    try {
      assert.equal(evaluateGate({}).state, 'none');
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('no result and no reason ever carries a credential value', () => {
    for (const env of [completeEnv(), { GA4_PROPERTY_ID: CREDENTIAL_VALUES.GA4_PROPERTY_ID }, {}]) {
      const result = evaluateGate(env);
      const serialized = JSON.stringify(result);
      for (const value of PLANTED_VALUES) {
        assert.ok(!serialized.includes(value), `the result leaked a credential value: ${serialized}`);
      }
    }
  });
});

/* ------------------------------------------------------------------ the gate CLI ---- */

/** Run the gate CLI with a controlled env and a fresh GITHUB_OUTPUT file. */
function runGate(env = {}) {
  const outputFile = join(tempDir('analytics-gate-out-'), 'github-output');
  writeFileSync(outputFile, '');
  const result = spawnSync(process.execPath, [GATE_CLI], {
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile, ...env },
    encoding: 'utf8',
  });
  return { ...result, outputFile, output: readFileSync(outputFile, 'utf8') };
}

const outputLines = (contents) => contents.split('\n').map((line) => line.trim()).filter(Boolean);

describe('DoD 3 + 4: the gate CLI exits 0 in all three states and reports through GITHUB_OUTPUT', () => {
  const runs = {};

  before(() => {
    runs.none = runGate({});
    runs.complete = runGate(completeEnv());
    const partial = completeEnv();
    delete partial.CF_API_TOKEN;
    delete partial.SC_SITE_URL;
    runs.incomplete = runGate(partial);
  });

  it('DoD 3: no credentials exits 0, says SKIPPED, and reports configured=false', () => {
    const run = runs.none;
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.ok(run.stdout.includes('SKIPPED'), `expected a SKIPPED line, got: ${run.stdout}`);
    const lines = outputLines(run.output);
    assert.ok(lines.includes('state=none'), `expected state=none, got: ${lines.join(' | ')}`);
    assert.ok(lines.includes('configured=false'), `expected configured=false, got: ${lines.join(' | ')}`);
    assert.equal(lines.length, 2, `expected exactly two output lines, got: ${lines.join(' | ')}`);
  });

  it('a complete set exits 0, says ENABLED, and reports configured=true', () => {
    const run = runs.complete;
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.ok(run.stdout.includes('ENABLED'), `expected an ENABLED line, got: ${run.stdout}`);
    const lines = outputLines(run.output);
    assert.ok(lines.includes('state=complete'), `expected state=complete, got: ${lines.join(' | ')}`);
    assert.ok(lines.includes('configured=true'), `expected configured=true, got: ${lines.join(' | ')}`);
    assert.equal(lines.length, 2, `expected exactly two output lines, got: ${lines.join(' | ')}`);
  });

  it('DoD 4: an incomplete set exits 0, says INCOMPLETE, and reports configured=false', () => {
    // Exit 0 is the contract: a red exit here would block the site build, which DoD 4
    // forbids. configured=false is what keeps the fetch step from issuing a partial
    // credentialed request.
    const run = runs.incomplete;
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    assert.ok(run.stdout.includes('INCOMPLETE'), `expected an INCOMPLETE line, got: ${run.stdout}`);
    const lines = outputLines(run.output);
    assert.ok(lines.includes('state=incomplete'), `expected state=incomplete, got: ${lines.join(' | ')}`);
    assert.ok(lines.includes('configured=false'), `expected configured=false, got: ${lines.join(' | ')}`);
  });

  it('DoD 4: the incomplete run emits an ::error:: annotation naming every missing variable', () => {
    const annotations = runs.incomplete.stdout.split('\n').filter((line) => line.startsWith('::error::'));
    assert.ok(
      annotations.length > 0,
      `expected a line starting with ::error::, got: ${runs.incomplete.stdout}`,
    );
    const joined = annotations.join('\n');
    for (const name of ['CF_API_TOKEN', 'SC_SITE_URL']) {
      assert.ok(joined.includes(name), `the annotation must name ${name}, got: ${joined}`);
    }
  });

  it('configured=true appears in no state other than complete', () => {
    for (const state of ['none', 'incomplete']) {
      assert.ok(
        !runs[state].output.includes('configured=true'),
        `state ${state} must not report configured=true, got: ${runs[state].output}`,
      );
    }
  });

  it('the three states are distinguishable on stdout', () => {
    assert.notEqual(runs.none.stdout, runs.complete.stdout);
    assert.notEqual(runs.none.stdout, runs.incomplete.stdout);
    assert.notEqual(runs.complete.stdout, runs.incomplete.stdout);
  });

  it('no run prints a credential value on stdout, on stderr, or into GITHUB_OUTPUT', () => {
    for (const [state, run] of Object.entries(runs)) {
      const printed = `${run.stdout}${run.stderr}`;
      for (const value of PLANTED_VALUES) {
        assert.ok(!printed.includes(value), `the ${state} run printed a credential value: ${printed}`);
        assert.ok(
          !run.output.includes(value),
          `the ${state} run wrote a credential value into GITHUB_OUTPUT: ${run.output}`,
        );
      }
    }
  });

  it('the state line is appended, leaving whatever GITHUB_OUTPUT already carried', () => {
    const outputFile = join(tempDir('analytics-gate-out-'), 'github-output');
    writeFileSync(outputFile, 'existing-key=existing-value\n');
    const run = spawnSync(process.execPath, [GATE_CLI], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `expected exit 0, got ${run.status}; stderr: ${run.stderr}`);
    const lines = outputLines(readFileSync(outputFile, 'utf8'));
    assert.equal(lines[0], 'existing-key=existing-value', 'the pre-existing line must survive');
    assert.ok(lines.includes('state=none'));
    assert.ok(lines.includes('configured=false'));
  });

  it('no GITHUB_OUTPUT in the environment is still exit 0, in all three states', () => {
    const partial = completeEnv();
    delete partial.CF_ZONE_ID;
    for (const env of [{}, completeEnv(), partial]) {
      const run = spawnSync(process.execPath, [GATE_CLI], {
        env: { PATH: process.env.PATH, ...env },
        encoding: 'utf8',
      });
      assert.equal(
        run.status,
        0,
        `expected exit 0 without GITHUB_OUTPUT, got ${run.status}; stderr: ${run.stderr}`,
      );
    }
  });
});

/* ============================ BLOCK B: source reading and degradation (DoD 9) ======== */

describe('ANALYTICS_SOURCES is the three normalized sources, in panel order', () => {
  it('ANALYTICS_DATA_DIR is the ignored ephemeral directory the fetch writes', () => {
    assert.equal(ANALYTICS_DATA_DIR, 'src/data/analytics');
  });

  it('exactly three descriptors, in ga4 / search-console / cloudflare order', () => {
    assert.equal(ANALYTICS_SOURCES.length, 3);
    assert.deepEqual(ANALYTICS_SOURCES.map((entry) => entry.id), SOURCE_IDS);
  });

  it('each descriptor carries a distinct non-empty file and label', () => {
    const files = ANALYTICS_SOURCES.map((entry) => entry.file);
    const labels = ANALYTICS_SOURCES.map((entry) => entry.label);
    assert.deepEqual(files, ['ga4.json', 'search-console.json', 'cloudflare.json']);
    for (const label of labels) {
      assert.equal(typeof label, 'string');
      assert.ok(label.trim().length > 0, 'a panel label must be non-empty');
    }
    assert.equal(new Set(labels).size, 3, 'the three labels must be distinct');
  });
});

describe('readAnalyticsSource accepts a valid normalized file', () => {
  for (const id of SOURCE_IDS) {
    it(`${id}: a valid file reads back available with the exact written data`, () => {
      const root = makeRoot({ [id]: VALID_FIXTURES[id] });
      const state = readOne(root, id);
      assert.equal(state.available, true, `expected available, got ${JSON.stringify(state)}`);
      assert.equal(state.id, id);
      assert.equal(state.label, descriptorFor(id).label);
      assert.deepEqual(state.data, VALID_FIXTURES[id]);
    });
  }

  it('an unknown extra key in a source file does not make it invalid', () => {
    const fixture = validFixture('ga4');
    fixture.futureField = { anything: 'here' };
    const state = readOne(makeRoot({ ga4: fixture }), 'ga4');
    assert.equal(state.available, true, `expected available, got ${JSON.stringify(state)}`);
  });
});

describe('DoD 9: readAnalyticsSource reports a missing file as missing, never a throw', () => {
  for (const id of SOURCE_IDS) {
    it(`${id}: no file at all is reason missing with a named detail`, () => {
      const root = makeRoot({});
      const state = readOne(root, id);
      assert.equal(state.available, false);
      assert.equal(state.reason, 'missing');
      assert.equal(state.id, id);
      assert.equal(state.label, descriptorFor(id).label);
      assert.equal(typeof state.detail, 'string');
      assert.ok(state.detail.length > 0, 'detail is never an empty string');
    });
  }

  it('no analytics directory at all reads as missing for all three sources', () => {
    const root = tempDir();
    for (const id of SOURCE_IDS) {
      const state = readOne(root, id);
      assert.equal(state.available, false);
      assert.equal(state.reason, 'missing');
    }
  });
});

/**
 * Assert one invalid case: available false, reason invalid, a non-empty detail, and -- when
 * the class is about a named field -- a detail that names it.
 */
function assertInvalid(root, id, names) {
  const state = readOne(root, id);
  assert.equal(state.available, false, `expected unavailable, got ${JSON.stringify(state)}`);
  assert.equal(state.reason, 'invalid', `expected reason invalid, got ${JSON.stringify(state)}`);
  assert.equal(state.id, id);
  assert.equal(state.label, descriptorFor(id).label);
  assert.equal(typeof state.detail, 'string');
  assert.ok(state.detail.length > 0, 'detail is never an empty string');
  if (names) {
    assert.ok(
      state.detail.includes(names),
      `the detail must name the specific problem (${names}), got: ${state.detail}`,
    );
  }
  return state;
}

describe('DoD 9: readAnalyticsSource rejects a malformed file as invalid, never a throw', () => {
  it('unparseable JSON is invalid', () => {
    for (const raw of ['{ this is not valid json', '', '{"schemaVersion": 1,']) {
      const root = makeRoot({ ga4: raw });
      const state = readOne(root, 'ga4');
      assert.equal(state.available, false, `expected unavailable for ${JSON.stringify(raw)}`);
      assert.equal(state.reason, 'invalid', `expected invalid for ${JSON.stringify(raw)}`);
      assert.ok(state.detail.length > 0, 'detail is never an empty string');
    }
  });

  for (const [what, raw] of [
    ['an array', '[]'],
    ['a populated array', '[{"schemaVersion": 1}]'],
    ['a string', '"ga4"'],
    ['a number', '42'],
    ['null', 'null'],
    ['a boolean', 'true'],
  ]) {
    it(`a top-level value that is ${what} is invalid`, () => {
      assertInvalid(makeRoot({ ga4: raw }), 'ga4');
    });
  }

  for (const [what, mutate] of [
    ['absent', (f) => delete f.schemaVersion],
    ['2', (f) => { f.schemaVersion = 2; }],
    ['the string "1"', (f) => { f.schemaVersion = '1'; }],
    ['null', (f) => { f.schemaVersion = null; }],
  ]) {
    it(`schemaVersion ${what} is invalid`, () => {
      const fixture = validFixture('ga4');
      mutate(fixture);
      assertInvalid(makeRoot({ ga4: fixture }), 'ga4', 'schemaVersion');
    });
  }

  for (const id of SOURCE_IDS) {
    it(`${id}: a source field naming a different source is invalid`, () => {
      const fixture = validFixture(id);
      fixture.source = SOURCE_IDS.find((other) => other !== id);
      assertInvalid(makeRoot({ [id]: fixture }), id, 'source');
    });

    it(`${id}: an absent source field is invalid`, () => {
      const fixture = validFixture(id);
      delete fixture.source;
      assertInvalid(makeRoot({ [id]: fixture }), id, 'source');
    });
  }

  for (const [what, mutate] of [
    ['absent', (f) => delete f.fetchedAt],
    ['an empty string', (f) => { f.fetchedAt = ''; }],
    ['whitespace only', (f) => { f.fetchedAt = '   '; }],
    ['a number', (f) => { f.fetchedAt = 20260729; }],
    ['null', (f) => { f.fetchedAt = null; }],
  ]) {
    it(`fetchedAt ${what} is invalid`, () => {
      const fixture = validFixture('ga4');
      mutate(fixture);
      assertInvalid(makeRoot({ ga4: fixture }), 'ga4', 'fetchedAt');
    });
  }

  for (const [what, mutate] of [
    ['absent', (f) => delete f.period],
    ['not an object', (f) => { f.period = '2026-07-01/2026-07-28'; }],
    ['an array', (f) => { f.period = ['2026-07-01', '2026-07-28', 28]; }],
    ['null', (f) => { f.period = null; }],
    ['missing start', (f) => delete f.period.start],
    ['an empty start', (f) => { f.period.start = ''; }],
    ['a non-string start', (f) => { f.period.start = 20260701; }],
    ['missing end', (f) => delete f.period.end],
    ['an empty end', (f) => { f.period.end = ''; }],
    ['a non-string end', (f) => { f.period.end = 20260728; }],
    ['missing days', (f) => delete f.period.days],
    ['a string days', (f) => { f.period.days = '28'; }],
    ['a null days', (f) => { f.period.days = null; }],
  ]) {
    it(`period ${what} is invalid`, () => {
      const fixture = validFixture('ga4');
      mutate(fixture);
      assertInvalid(makeRoot({ ga4: fixture }), 'ga4', 'period');
    });
  }

  it('a non-finite period.days is invalid', () => {
    // JSON has no Infinity literal; 1e999 parses to one, which is what a bad provider
    // response can produce after arithmetic upstream.
    const raw = JSON.stringify(validFixture('ga4')).replace('"days":28', '"days":1e999');
    assert.ok(raw.includes('1e999'), 'the non-finite fixture must really carry 1e999');
    assertInvalid(makeRoot({ ga4: raw }), 'ga4', 'period');
  });

  for (const [what, mutate] of [
    ['absent', (f) => delete f.summary],
    ['not an object', (f) => { f.summary = 'none'; }],
    ['an array', (f) => { f.summary = []; }],
    ['null', (f) => { f.summary = null; }],
  ]) {
    it(`summary ${what} is invalid`, () => {
      const fixture = validFixture('ga4');
      mutate(fixture);
      assertInvalid(makeRoot({ ga4: fixture }), 'ga4', 'summary');
    });
  }

  for (const id of SOURCE_IDS) {
    for (const field of REQUIRED_SUMMARY_FIELDS[id]) {
      it(`${id}: summary.${field} absent is invalid`, () => {
        const fixture = validFixture(id);
        delete fixture.summary[field];
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });

      it(`${id}: summary.${field} as a numeric string is invalid`, () => {
        const fixture = validFixture(id);
        fixture.summary[field] = String(VALID_FIXTURES[id].summary[field]);
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });

      it(`${id}: summary.${field} as null is invalid`, () => {
        const fixture = validFixture(id);
        fixture.summary[field] = null;
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });

      it(`${id}: summary.${field} non-finite is invalid`, () => {
        const fixture = validFixture(id);
        fixture.summary[field] = 0;
        const raw = JSON.stringify(fixture).replace(`"${field}":0`, `"${field}":1e999`);
        assert.ok(raw.includes('1e999'), 'the non-finite fixture must really carry 1e999');
        assertInvalid(makeRoot({ [id]: raw }), id, field);
      });
    }
  }

  for (const id of SOURCE_IDS) {
    for (const field of REQUIRED_ARRAYS[id]) {
      it(`${id}: ${field} absent is invalid`, () => {
        const fixture = validFixture(id);
        delete fixture[field];
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });

      it(`${id}: ${field} not an array is invalid`, () => {
        const fixture = validFixture(id);
        fixture[field] = { rows: [] };
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });

      it(`${id}: ${field} as a string is invalid`, () => {
        const fixture = validFixture(id);
        fixture[field] = 'none';
        assertInvalid(makeRoot({ [id]: fixture }), id, field);
      });
    }

    it(`${id}: an empty required array is still valid (a quiet period is not a failure)`, () => {
      const fixture = validFixture(id);
      for (const field of REQUIRED_ARRAYS[id]) fixture[field] = [];
      const state = readOne(makeRoot({ [id]: fixture }), id);
      assert.equal(state.available, true, `expected available, got ${JSON.stringify(state)}`);
    });
  }

  it('nothing in the module throws for any malformed or absent input', () => {
    const cases = [
      makeRoot({}),
      makeRoot({ ga4: '{ broken', 'search-console': 'null', cloudflare: '[]' }),
      makeRoot({ ga4: '' }),
      tempDir(),
      join(tempDir(), 'this-directory-does-not-exist'),
    ];
    for (const root of cases) {
      for (const descriptor of ANALYTICS_SOURCES) {
        assert.doesNotThrow(
          () => readAnalyticsSource(root, descriptor),
          `readAnalyticsSource threw for ${descriptor.id} under ${root}`,
        );
      }
      assert.doesNotThrow(
        () => resolveAnalyticsPanels({ features: { analytics: true } }, root),
        `resolveAnalyticsPanels threw under ${root}`,
      );
    }
  });
});

describe('DoD 9: each source degrades independently of the other two', () => {
  const stateOf = (panels, id) => {
    const found = panels.sources.find((entry) => entry.id === id);
    assert.ok(found, `resolveAnalyticsPanels must carry a state for ${id}`);
    return found;
  };

  for (const broken of SOURCE_IDS) {
    const others = SOURCE_IDS.filter((id) => id !== broken);

    it(`${broken} missing leaves ${others.join(' and ')} available`, () => {
      const files = {};
      for (const id of others) files[id] = VALID_FIXTURES[id];
      const panels = resolveAnalyticsPanels({ features: { analytics: true } }, makeRoot(files));

      assert.equal(panels.enabled, true);
      assert.equal(stateOf(panels, broken).available, false);
      assert.equal(stateOf(panels, broken).reason, 'missing');
      for (const id of others) {
        const state = stateOf(panels, id);
        assert.equal(state.available, true, `${id} must survive ${broken} being missing`);
        assert.deepEqual(state.data, VALID_FIXTURES[id]);
      }
      assert.equal(panels.sources.filter((entry) => entry.available === false).length, 1);
    });

    it(`${broken} invalid leaves ${others.join(' and ')} available`, () => {
      const files = { [broken]: '{ not valid json at all' };
      for (const id of others) files[id] = VALID_FIXTURES[id];
      const panels = resolveAnalyticsPanels({ features: { analytics: true } }, makeRoot(files));

      assert.equal(stateOf(panels, broken).available, false);
      assert.equal(stateOf(panels, broken).reason, 'invalid');
      for (const id of others) {
        const state = stateOf(panels, id);
        assert.equal(state.available, true, `${id} must survive ${broken} being invalid`);
        assert.deepEqual(state.data, VALID_FIXTURES[id]);
      }
      assert.equal(panels.sources.filter((entry) => entry.available === false).length, 1);
    });
  }

  it('all three valid yields three available panels', () => {
    const panels = resolveAnalyticsPanels({ features: { analytics: true } }, makeRoot(VALID_FIXTURES));
    assert.equal(panels.sources.filter((entry) => entry.available === true).length, 3);
  });

  it('all three broken yields three unavailable panels and still no throw', () => {
    const panels = resolveAnalyticsPanels({ features: { analytics: true } }, makeRoot({}));
    assert.equal(panels.sources.filter((entry) => entry.available === false).length, 3);
  });
});

describe('DoD 10: resolveAnalyticsPanels is enabled only by features.analytics === true', () => {
  const root = () => makeRoot(VALID_FIXTURES);

  for (const [what, config] of [
    ['an empty config', {}],
    ['features present but empty', { features: {} }],
    ['features.analytics false', { features: { analytics: false } }],
    ['features.analytics undefined', { features: { analytics: undefined } }],
  ]) {
    it(`${what} is not enabled`, () => {
      assert.equal(resolveAnalyticsPanels(config, root()).enabled, false);
    });
  }

  for (const truthy of ['true', 1, {}, 'yes']) {
    it(`features.analytics ${JSON.stringify(truthy)} is truthy but not true, so not enabled`, () => {
      assert.equal(resolveAnalyticsPanels({ features: { analytics: truthy } }, root()).enabled, false);
    });
  }

  it('features.analytics true is enabled', () => {
    assert.equal(resolveAnalyticsPanels({ features: { analytics: true } }, root()).enabled, true);
  });

  it('sources is always the three descriptors in order, enabled or not', () => {
    for (const config of [{}, { features: { analytics: false } }, { features: { analytics: true } }]) {
      const panels = resolveAnalyticsPanels(config, root());
      assert.equal(panels.sources.length, 3, `sources must be length 3 for ${JSON.stringify(config)}`);
      assert.deepEqual(panels.sources.map((entry) => entry.id), SOURCE_IDS);
      for (const entry of panels.sources) {
        assert.equal(entry.label, descriptorFor(entry.id).label);
      }
    }
  });
});

/* ==================== BLOCK C: the format helpers (DoD 8, exact normalized values) === */

describe('DoD 8: formatCount', () => {
  for (const [input, expected] of [
    [0, '0'],
    [42, '42'],
    [999, '999'],
    [4821, '4,821'],
    [48213, '48,213'],
    [726358, '726,358'],
    [1284537, '1,284,537'],
    [0.5, '0.5'],
    [12.345, '12.3'],
  ]) {
    it(`${input} formats as ${expected}`, () => {
      assert.equal(formatCount(input), expected);
    });
  }
});

describe('DoD 8: formatPercent renders a ratio as a two-decimal percentage', () => {
  for (const [input, expected] of [
    [0, '0.00%'],
    [0.0432, '4.32%'],
    [0.029, '2.90%'],
    [0.5, '50.00%'],
    [0.6274, '62.74%'],
    [1, '100.00%'],
  ]) {
    it(`${input} formats as ${expected}`, () => {
      assert.equal(formatPercent(input), expected);
    });
  }
});

describe('DoD 8: formatDuration', () => {
  for (const [input, expected] of [
    [0, '0s'],
    [42, '42s'],
    [59, '59s'],
    [95, '1m 35s'],
    [3599, '59m 59s'],
    [3725, '1h 2m 5s'],
  ]) {
    it(`${input} seconds formats as ${expected}`, () => {
      assert.equal(formatDuration(input), expected);
    });
  }
});

describe('DoD 8: formatBytes steps in binary units', () => {
  for (const [input, expected] of [
    [0, '0 B'],
    [1536, '1.5 KB'],
    [3670016, '3.5 MB'],
    [7912345678, '7.4 GB'],
    [4000000000000, '3.6 TB'],
  ]) {
    it(`${input} formats as ${expected}`, () => {
      assert.equal(formatBytes(input), expected);
    });
  }

  it('a value below 1024 stays in bytes', () => {
    // The exact decimal form for a sub-KB value is not pinned by the contract (0 renders
    // as "0 B", with no decimal), so this case asserts unit selection and magnitude only.
    const formatted = formatBytes(512);
    assert.ok(formatted.endsWith(' B'), `expected the B unit, got: ${formatted}`);
    assert.ok(formatted.startsWith('512'), `expected the magnitude 512, got: ${formatted}`);
  });
});

describe('DoD 8: formatPosition renders one decimal', () => {
  for (const [input, expected] of [
    [4.62, '4.6'],
    [12.345, '12.3'],
    [17.482, '17.5'],
    [104.27, '104.3'],
  ]) {
    it(`${input} formats as ${expected}`, () => {
      assert.equal(formatPosition(input), expected);
    });
  }
});

/* ========== BLOCK D: production-build simulation (DoD 8, 9, 10, 11) ================== */

const ANALYTICS_DIR = join(REPO_ROOT, ANALYTICS_DATA_DIR);

/**
 * Exact byte snapshots taken at module load, before any mutation. Restored by both the
 * after() hook and a process exit handler, so a crashed run cannot leave the repository
 * dirty.
 */
const PLACE_CONFIG_SNAPSHOT = readFileSync(PLACE_CONFIG_PATH);
const ANALYTICS_DIR_EXISTED = existsSync(ANALYTICS_DIR);
const ANALYTICS_SNAPSHOT = new Map(
  ANALYTICS_DIR_EXISTED ? filesUnder(ANALYTICS_DIR).map((path) => [path, readFileSync(path)]) : [],
);

let repositoryMutated = false;

function restoreRepository() {
  if (!repositoryMutated) return;
  repositoryMutated = false;
  try {
    writeFileSync(PLACE_CONFIG_PATH, PLACE_CONFIG_SNAPSHOT);
  } catch {
    // The exit handler must not throw; the after() hook gets a second attempt.
  }
  try {
    rmSync(ANALYTICS_DIR, { recursive: true, force: true });
    if (ANALYTICS_DIR_EXISTED) {
      mkdirSync(ANALYTICS_DIR, { recursive: true });
      for (const [path, contents] of ANALYTICS_SNAPSHOT) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
    }
  } catch {
    // Same reason.
  }
}

process.on('exit', restoreRepository);
after(restoreRepository);

// A killed run is the one path an exit handler misses, and this block is slow enough to
// be worth interrupting. Restore, then re-raise the signal with the handler removed so the
// process still dies of what killed it.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, function onSignal() {
    restoreRepository();
    process.removeListener(signal, onSignal);
    process.kill(process.pid, signal);
  });
}

/* ------------------------------------------------- guarded place.config.ts editing --- */

const FEATURES_ANALYTICS_OFF = '    analytics: false,\n';
const FEATURES_ANALYTICS_ON = '    analytics: true,\n';
const PUBLIC_IDS_ANCHOR = "  seo: {\n    defaultOgImage: '/og-default.png',";
const PUBLIC_IDS_BLOCK =
  `  analytics: {\n` +
  `    ga4MeasurementId: '${GA4_MEASUREMENT_ID}',\n` +
  `    cloudflareWebAnalyticsToken: '${CF_WEB_TOKEN}',\n` +
  `  },\n`;

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * Write place.config.ts with features.analytics set to `enabled` and the two PUBLIC
 * browser ids present. Both anchors are asserted to occur exactly once before any write.
 */
function writePlaceConfig(enabled) {
  const original = PLACE_CONFIG_SNAPSHOT.toString('utf8');
  assert.equal(
    occurrences(original, FEATURES_ANALYTICS_OFF),
    1,
    'place.config.ts must carry exactly one `analytics: false,` features line to flip',
  );
  assert.equal(
    occurrences(original, PUBLIC_IDS_ANCHOR),
    1,
    'place.config.ts must carry exactly one seo block to anchor the analytics ids against',
  );
  const text = original
    .replace(FEATURES_ANALYTICS_OFF, enabled ? FEATURES_ANALYTICS_ON : FEATURES_ANALYTICS_OFF)
    .replace(PUBLIC_IDS_ANCHOR, `${PUBLIC_IDS_BLOCK}${PUBLIC_IDS_ANCHOR}`);
  repositoryMutated = true;
  writeFileSync(PLACE_CONFIG_PATH, text);
}

/** Install exactly the given fixture files under the repository's analytics data dir. */
function writeAnalyticsData(files) {
  repositoryMutated = true;
  rmSync(ANALYTICS_DIR, { recursive: true, force: true });
  mkdirSync(ANALYTICS_DIR, { recursive: true });
  for (const [id, contents] of Object.entries(files)) {
    const body = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
    writeFileSync(join(ANALYTICS_DIR, descriptorFor(id).file), body);
  }
}

/* --------------------------------------------------------------- the build harness --- */

/** Run one production build into its own output directory and return the dashboard HTML. */
function buildInto(label) {
  const outDir = join(tempDir(`analytics-build-${label}-`), 'dist');
  const run = spawnSync('npx', ['astro', 'build', '--outDir', outDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...CREDENTIAL_VALUES },
  });
  assert.equal(
    run.status,
    0,
    `astro build (${label}) failed with ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
  );
  const dashboard = join(outDir, 'dashboard', 'index.html');
  assert.ok(existsSync(dashboard), `build ${label} produced no dashboard page at ${dashboard}`);
  return { outDir, html: readFileSync(dashboard, 'utf8') };
}

/* ---------------------------------------------------------------- markup helpers ----- */

/**
 * The panel elements carrying data-analytics-source, in document order, each with the
 * full open tag (so an attribute written before data-analytics-source is still seen) and
 * the body up to the next panel.
 */
function analyticsPanels(html) {
  const panels = [];
  const pattern = /data-analytics-source="([a-z0-9-]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    const tagStart = html.lastIndexOf('<', match.index);
    const tagEnd = html.indexOf('>', match.index);
    panels.push({ id: match[1], tagStart, openTag: html.slice(tagStart, tagEnd + 1) });
    match = pattern.exec(html);
  }
  for (let index = 0; index < panels.length; index += 1) {
    const end = index + 1 < panels.length ? panels[index + 1].tagStart : html.length;
    panels[index].body = html.slice(panels[index].tagStart, end);
  }
  return panels;
}

function panelFor(html, id) {
  const found = analyticsPanels(html).filter((panel) => panel.id === id);
  assert.equal(found.length, 1, `expected exactly one panel for ${id}, found ${found.length}`);
  return found[0];
}

/**
 * The element carrying `id="<id>"`, balanced on its own tag name. Tag-agnostic on
 * purpose: the contract names the ids, not the elements that carry them.
 */
function elementById(html, id) {
  const marker = html.indexOf(`id="${id}"`);
  assert.ok(marker >= 0, `the rendered page carries no element with id="${id}"`);
  const start = html.lastIndexOf('<', marker);
  const tag = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start));
  assert.ok(tag, `could not read the tag name of the element carrying id="${id}"`);
  const open = new RegExp(`<${tag[1]}\\b`, 'g');
  const close = new RegExp(`</${tag[1]}\\s*>`, 'g');
  let depth = 0;
  let cursor = start;
  while (cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    assert.ok(nextClose, `the element with id="${id}" is never closed`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + 1;
      if (depth === 0) return html.slice(start, nextClose.index + nextClose[0].length);
    }
  }
  assert.fail(`the element with id="${id}" is never closed`);
  return '';
}

const ARTICLE_HEALTH_IDS = ['vitals', 'immune', 'registry'];

const articleHealthSections = (html) =>
  Object.fromEntries(ARTICLE_HEALTH_IDS.map((id) => [id, elementById(html, id)]));

/** Assert one panel is available and renders every exact value the contract promises. */
function assertPanelAvailable(html, id) {
  const panel = panelFor(html, id);
  assert.ok(
    panel.openTag.includes('data-analytics-state="available"'),
    `the ${id} panel must be available, got open tag: ${panel.openTag}`,
  );
  for (const expected of EXPECTED_PANEL_TEXT[id]) {
    assert.ok(
      panel.body.includes(expected),
      `the ${id} panel must render ${JSON.stringify(expected)}; panel markup was:\n${panel.body}`,
    );
  }
}

/** Assert one panel is unavailable for the named reason and still names its source. */
function assertPanelUnavailable(html, id, reason) {
  const panel = panelFor(html, id);
  assert.ok(
    panel.openTag.includes('data-analytics-state="unavailable"'),
    `the ${id} panel must be unavailable, got open tag: ${panel.openTag}`,
  );
  assert.ok(
    panel.openTag.includes(`data-analytics-reason="${reason}"`),
    `the ${id} panel must report reason ${reason}, got open tag: ${panel.openTag}`,
  );
  assert.ok(
    panel.body.includes(descriptorFor(id).label),
    `the unavailable ${id} panel must still name its source; panel markup was:\n${panel.body}`,
  );
}

/** DoD 11: no planted credential value anywhere under a directory. */
function assertNoPlantedCredentials(directory, what) {
  const files = filesUnder(directory);
  assert.ok(files.length > 0, `${what} has no files to scan: the scan would be vacuous`);
  for (const path of files) {
    const contents = readFileSync(path);
    for (const value of PLANTED_VALUES) {
      assert.ok(
        !contents.includes(value),
        `${what} leaked a credential value into ${path.slice(directory.length + 1)}`,
      );
    }
  }
}

describe('DoD 8, 9, 10, 11: a real production build renders the analytics panels', () => {
  const builds = {};
  let dashboardData;

  before(() => {
    assert.ok(
      existsSync(join(REPO_ROOT, 'node_modules', 'astro')),
      'node_modules/astro is absent: run npm ci before this suite (this block must not skip silently)',
    );
    const version = spawnSync('npx', ['astro', '--version'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(version.status, 0, `npx astro is not resolvable: ${version.stderr}`);

    const prebuild = spawnSync('npm', ['run', 'prebuild'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(
      prebuild.status,
      0,
      `npm run prebuild failed with ${prebuild.status}\nstdout:\n${prebuild.stdout}\nstderr:\n${prebuild.stderr}`,
    );
    dashboardData = JSON.parse(readFileSync(join(REPO_ROOT, 'src/data/dashboard-lite.json'), 'utf8'));

    // 1. every source valid, analytics enabled.
    writePlaceConfig(true);
    writeAnalyticsData(VALID_FIXTURES);
    builds.allValid = buildInto('all-valid');

    // 2. ga4 invalid, search-console absent, cloudflare valid.
    writeAnalyticsData({
      ga4: '{ "schemaVersion": 1, "source": "ga4", "fetchedAt": "2026-07-29T04:15:00Z" }',
      cloudflare: VALID_FIXTURES.cloudflare,
    });
    builds.ga4Invalid = buildInto('ga4-invalid');

    // 3. cloudflare invalid, the other two valid.
    writeAnalyticsData({
      ga4: VALID_FIXTURES.ga4,
      'search-console': VALID_FIXTURES['search-console'],
      cloudflare: '{ this is not valid json',
    });
    builds.cloudflareInvalid = buildInto('cloudflare-invalid');

    // 4. every source valid on disk, but features.analytics is false.
    writePlaceConfig(false);
    writeAnalyticsData(VALID_FIXTURES);
    builds.featureOff = buildInto('feature-off');

    restoreRepository();
  });

  it('DoD 8: the analytics section is present, with the three panels in source order', () => {
    const html = builds.allValid.html;
    assert.ok(html.includes('data-analytics'), 'the rendered page must carry the data-analytics marker');
    assert.match(
      html,
      /<section[^>]*data-analytics(?![-\w])[^>]*>/,
      'the analytics wrapper must be a section carrying the bare data-analytics attribute',
    );
    const wrapper = /<section[^>]*data-analytics(?![-\w])[^>]*>/.exec(html)[0];
    assert.ok(wrapper.includes('id="analytics"'), `the wrapper must carry id="analytics", got: ${wrapper}`);
    assert.deepEqual(
      analyticsPanels(html).map((panel) => panel.id),
      SOURCE_IDS,
      'the three panels must render in ANALYTICS_SOURCES order',
    );
  });

  for (const id of SOURCE_IDS) {
    it(`DoD 8: the ${id} panel renders its exact normalized values, period and fetchedAt`, () => {
      assertPanelAvailable(builds.allValid.html, id);
    });
  }

  it('DoD 8: the article-health dashboard still renders beside the analytics section', () => {
    const html = builds.allValid.html;
    const sections = articleHealthSections(html);
    assert.ok(
      sections.vitals.includes(String(dashboardData.rollup.total)),
      'the vitals section must still carry the rollup total from src/data/dashboard-lite.json',
    );
    assert.ok(
      sections.immune.includes(String(dashboardData.immune.score)),
      'the immune section must still carry the immune score from src/data/dashboard-lite.json',
    );
    assert.ok(sections.registry.length > 0, 'the registry section must still render');
  });

  it('DoD 9: ga4 invalid and search-console missing leave cloudflare rendering its exact values', () => {
    const html = builds.ga4Invalid.html;
    assert.ok(html.includes('data-analytics'), 'the analytics section must still render');
    assertPanelUnavailable(html, 'ga4', 'invalid');
    assertPanelUnavailable(html, 'search-console', 'missing');
    assertPanelAvailable(html, 'cloudflare');
  });

  it('DoD 9: the article-health dashboard is byte-identical while two sources are degraded', () => {
    const baseline = articleHealthSections(builds.allValid.html);
    const degraded = articleHealthSections(builds.ga4Invalid.html);
    for (const id of ARTICLE_HEALTH_IDS) {
      assert.equal(degraded[id], baseline[id], `the ${id} section changed when analytics sources degraded`);
    }
  });

  it('DoD 9: cloudflare invalid leaves ga4 and search-console rendering their exact values', () => {
    const html = builds.cloudflareInvalid.html;
    assertPanelUnavailable(html, 'cloudflare', 'invalid');
    assertPanelAvailable(html, 'ga4');
    assertPanelAvailable(html, 'search-console');
  });

  it('DoD 10: features.analytics false removes the analytics section entirely', () => {
    const html = builds.featureOff.html;
    assert.ok(
      !html.includes('data-analytics'),
      'no analytics marker may appear when features.analytics is false',
    );
    assert.equal(analyticsPanels(html).length, 0, 'no analytics panel may render');
  });

  it('DoD 10: the article-health sections are byte-identical with analytics off', () => {
    const withAnalytics = articleHealthSections(builds.allValid.html);
    const withoutAnalytics = articleHealthSections(builds.featureOff.html);
    for (const id of ARTICLE_HEALTH_IDS) {
      assert.equal(
        withoutAnalytics[id],
        withAnalytics[id],
        `the ${id} section differs between the analytics-on and analytics-off builds`,
      );
      assert.ok(withoutAnalytics[id].length > 0, `the ${id} section must still render with analytics off`);
    }
  });

  for (const label of ['allValid', 'ga4Invalid', 'cloudflareInvalid']) {
    it(`DoD 11: the ${label} build output carries no planted credential value`, () => {
      assertNoPlantedCredentials(builds[label].outDir, `the ${label} build output`);
    });
  }

  it('DoD 11: no planted credential value reached src/data/analytics/', () => {
    // The fixture files stand in for what the fetch writes; the assertion is that the
    // normalized artifacts carry data, never the credentials used to obtain it.
    writeAnalyticsData(VALID_FIXTURES);
    try {
      assertNoPlantedCredentials(ANALYTICS_DIR, 'src/data/analytics');
    } finally {
      restoreRepository();
    }
  });

  it('DoD 11: the two PUBLIC browser ids do reach the rendered HTML', () => {
    // Browser collection cannot work without them, so their presence is the required
    // positive half of the same criterion.
    const pages = filesUnder(builds.allValid.outDir).filter((path) => path.endsWith('.html'));
    assert.ok(pages.length > 0, 'the build produced no HTML pages to scan');
    for (const value of [GA4_MEASUREMENT_ID, CF_WEB_TOKEN]) {
      const carriers = pages.filter((path) => readFileSync(path, 'utf8').includes(value));
      assert.ok(
        carriers.length > 0,
        `the public value ${value} must appear in the rendered browser HTML, found in no page`,
      );
    }
  });

  it('the repository files this block edits are restored to their exact original bytes', () => {
    assert.deepEqual(
      readFileSync(PLACE_CONFIG_PATH),
      PLACE_CONFIG_SNAPSHOT,
      'place.config.ts was not restored',
    );
    assert.equal(
      existsSync(ANALYTICS_DIR),
      ANALYTICS_DIR_EXISTED,
      'src/data/analytics/ presence was not restored',
    );
  });
});
