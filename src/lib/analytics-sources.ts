/**
 * analytics-sources.ts -- reading and validating the normalized analytics source
 * files the dashboard renders.
 *
 * `npm run fetch:analytics` (scripts/analytics/) writes three versioned files under
 * `src/data/analytics/`. That directory is gitignored and is populated only by the
 * credentialed fetch in the production build, so on any other build -- a pull
 * request, a local build, an adopter who configured no analytics -- some or all of
 * the three files are simply absent. That is a supported state, not an error:
 * SPEC section Analytics requires each missing or invalid source to degrade to its
 * own named unavailable state while the other panels and the article-health
 * dashboard keep rendering.
 *
 * So nothing here throws. Every failure -- absent file, unparseable JSON, wrong
 * schema version, a numeric string where the contract says number -- resolves to
 * `{ available: false, reason, detail }` and the caller renders that source's
 * unavailable card. Validation is deliberately strict on the way in: an API failure
 * must never reach the page as zero traffic, so a payload that does not match the
 * frozen schema is `invalid` rather than partially rendered.
 *
 * The file is read with `readFileSync` + try/catch rather than a dynamic import:
 * Rollup resolves literal import specifiers at build time and fails on an absent
 * file before any catch handler runs (rules/optional-build-time-json-readfilesync).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repository-relative directory the fetchers write, mirroring scripts/analytics/schemas.py. */
export const ANALYTICS_DATA_DIR = 'src/data/analytics';

export type AnalyticsSourceId = 'ga4' | 'search-console' | 'cloudflare';

export interface AnalyticsSourceDescriptor {
  id: AnalyticsSourceId;
  file: string;
  label: string;
  /** What the panel measures, rendered as the panel subtitle. */
  blurb: string;
}

/** The three panels, in render order. */
export const ANALYTICS_SOURCES: AnalyticsSourceDescriptor[] = [
  {
    id: 'ga4',
    file: 'ga4.json',
    label: 'Site traffic',
    blurb: 'Readers, sessions, and the pages they landed on',
  },
  {
    id: 'search-console',
    file: 'search-console.json',
    label: 'Search performance',
    blurb: 'Queries that surfaced this place, and what they clicked',
  },
  {
    id: 'cloudflare',
    file: 'cloudflare.json',
    label: 'Edge traffic',
    blurb: 'Requests, visits, and threats seen at the edge',
  },
];

export interface AnalyticsPeriod {
  start: string;
  end: string;
  days: number;
}

export interface AnalyticsPayload {
  schemaVersion: number;
  source: AnalyticsSourceId;
  fetchedAt: string;
  period: AnalyticsPeriod;
  summary: Record<string, number>;
  [key: string]: unknown;
}

export type AnalyticsSourceState =
  | { id: AnalyticsSourceId; label: string; blurb: string; available: true; data: AnalyticsPayload }
  | {
      id: AnalyticsSourceId;
      label: string;
      blurb: string;
      available: false;
      reason: 'missing' | 'invalid';
      detail: string;
    };

/**
 * The frozen per-source shape (SPEC section Analytics). Summary fields must be finite
 * JSON numbers; arrays must be arrays. Row-level fields are rendered defensively and
 * are not part of the accept/reject decision -- a source whose summary and period are
 * sound still tells the reader something true even if one row is odd.
 */
const SOURCE_SHAPE: Record<AnalyticsSourceId, { summary: string[]; arrays: string[] }> = {
  ga4: {
    summary: [
      'activeUsers',
      'newUsers',
      'pageViews',
      'sessions',
      'averageSessionDurationSeconds',
      'engagementRate',
    ],
    arrays: ['topPages', 'trafficSources'],
  },
  'search-console': {
    summary: ['clicks', 'impressions', 'ctr', 'averagePosition'],
    arrays: ['topQueries', 'topPages'],
  },
  cloudflare: {
    summary: ['requests', 'pageViews', 'visits', 'bytes', 'threats'],
    arrays: ['topCountries', 'statusCodes'],
  },
};

const SCHEMA_VERSION = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate a parsed payload against the frozen schema.
 *
 * @returns null when the payload is valid, otherwise the specific problem.
 */
function validate(parsed: unknown, descriptor: AnalyticsSourceDescriptor): string | null {
  if (!isPlainObject(parsed)) {
    return `${descriptor.file} does not contain a JSON object`;
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return `${descriptor.file} has schemaVersion ${JSON.stringify(parsed.schemaVersion)}, expected ${SCHEMA_VERSION}`;
  }
  if (parsed.source !== descriptor.id) {
    return `${descriptor.file} declares source ${JSON.stringify(parsed.source)}, expected ${JSON.stringify(descriptor.id)}`;
  }
  if (!isNonEmptyString(parsed.fetchedAt)) {
    return `${descriptor.file} has no fetchedAt timestamp`;
  }

  const period = parsed.period;
  if (!isPlainObject(period)) {
    return `${descriptor.file} has no period object`;
  }
  if (!isNonEmptyString(period.start) || !isNonEmptyString(period.end)) {
    return `${descriptor.file} period is missing a start or end date`;
  }
  if (!isFiniteNumber(period.days)) {
    return `${descriptor.file} period.days is not a number`;
  }

  const summary = parsed.summary;
  if (!isPlainObject(summary)) {
    return `${descriptor.file} has no summary object`;
  }

  const shape = SOURCE_SHAPE[descriptor.id];
  for (const field of shape.summary) {
    if (!(field in summary)) {
      return `${descriptor.file} summary is missing required field '${field}'`;
    }
    if (!isFiniteNumber(summary[field])) {
      return `${descriptor.file} summary.${field} is not a finite JSON number`;
    }
  }
  for (const field of shape.arrays) {
    if (!Array.isArray(parsed[field])) {
      return `${descriptor.file} is missing required array '${field}'`;
    }
  }

  return null;
}

/**
 * Read and validate one source file under `<root>/src/data/analytics/`.
 *
 * Never throws. An absent file is `reason: 'missing'`; anything present but not
 * matching the frozen schema is `reason: 'invalid'` with a detail naming the problem.
 */
export function readAnalyticsSource(
  root: string,
  descriptor: AnalyticsSourceDescriptor,
): AnalyticsSourceState {
  const base = { id: descriptor.id, label: descriptor.label, blurb: descriptor.blurb };
  const path = resolve(root, ANALYTICS_DATA_DIR, descriptor.file);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {
      ...base,
      available: false,
      reason: 'missing',
      detail: `${ANALYTICS_DATA_DIR}/${descriptor.file} was not produced by a fetch run`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      available: false,
      reason: 'invalid',
      detail: `${descriptor.file} is not valid JSON: ${message}`,
    };
  }

  const problem = validate(parsed, descriptor);
  if (problem !== null) {
    return { ...base, available: false, reason: 'invalid', detail: problem };
  }

  return { ...base, available: true, data: parsed as AnalyticsPayload };
}

/**
 * Resolve the whole analytics section: whether it renders at all, and the state of
 * each source.
 *
 * `enabled` is the `features.analytics` flag alone -- the same flag that gates
 * browser collection (src/lib/analytics.ts). `sources` is always all three in
 * declaration order, including when the section is disabled, so a caller that wants
 * to report per-source state without rendering the section can.
 */
export function resolveAnalyticsPanels(
  config: { features?: { analytics?: boolean } },
  root: string,
): { enabled: boolean; sources: AnalyticsSourceState[] } {
  return {
    enabled: config?.features?.analytics === true,
    sources: ANALYTICS_SOURCES.map((descriptor) => readAnalyticsSource(root, descriptor)),
  };
}

/* -- Display formatting -----------------------------------------------------
 *
 * Counts are grouped rather than abbreviated: the dashboard's job is to show what
 * the fetch actually recorded, and "1.2M" is not that number. Only bytes are
 * unit-converted, and the raw value travels beside it in a data attribute.
 */

const GROUPED = new Intl.NumberFormat('en-US');

/** 4821 -> '4,821'. A non-integer keeps one decimal place. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '--';
  if (Number.isInteger(n)) return GROUPED.format(n);
  return GROUPED.format(Number(n.toFixed(1)));
}

/** A 0..1 ratio as a percentage: 0.0432 -> '4.32%'. */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '--';
  return `${(ratio * 100).toFixed(2)}%`;
}

/** 42 -> '42s', 95 -> '1m 35s', 3725 -> '1h 2m 5s'. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 0 -> '0 B', 1536 -> '1.5 KB'. Binary steps, one decimal above bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** Average search position: 12.345 -> '12.3'. */
export function formatPosition(p: number): string {
  if (!Number.isFinite(p)) return '--';
  return p.toFixed(1);
}
