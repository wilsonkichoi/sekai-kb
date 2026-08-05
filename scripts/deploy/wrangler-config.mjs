// wrangler-config.mjs -- the one place that knows how a worker's deploy config is
// derived from place.config.ts, and what the committed template is allowed to carry.
//
// Two consumers import this module, which is why the knowledge lives here rather
// than in either of them:
//
//   - scripts/deploy/gen-worker-config.mjs  writes wrangler.generated.toml
//   - scripts/ci/check-worker-config.mjs    fails CI when a committed wrangler.toml
//                                           carries anything but the placeholders
//
// If the derivation rule and the placeholder constants lived in the generator alone,
// the gate would be asserting its own opinion of what ships; sharing them means the
// gate rejects exactly the values the generator is responsible for supplying.
//
// THE DERIVATION RULE (stated once, here; restated in the generator header and in
// docs/runbook/DEPLOY.md):
//
//   <place-slug>-<worker-directory-name>
//
// where <place-slug> is `place.name` from place.config.ts, lowercased, with every
// run of characters outside [a-z0-9] collapsed to a single "-", leading and trailing
// "-" removed, and the result truncated to 40 characters (again trimming a trailing
// "-"). `<worker-directory-name>` is the worker's own directory under workers/, so
// workers/feedback/ deploys as `<place-slug>-feedback`. Both the Worker script name
// and the D1 database_name use it, because both are account-scoped: two instances in
// one Cloudflare account must not resolve to the same name.
//
// The TOML support here is deliberately narrow. It reads the flat shape wrangler
// configs use in this repository -- top-level string keys, [table] blocks, and
// [[array-of-table]] blocks, with string, boolean, and integer values -- and refuses
// anything else rather than guessing. A config this cannot parse fails the gate,
// which is the safe direction: an unparsed file is one nothing is checking.
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

/** Basename of the committed, framework-owned template in every worker directory. */
export const TEMPLATE_BASENAME = 'wrangler.toml';

/** Basename of the derived config the generator writes. Gitignored, never committed. */
export const GENERATED_BASENAME = 'wrangler.generated.toml';

/**
 * The value every place-bearing key carries in a committed template. It is not a
 * valid Worker or D1 name, so a bare `npx wrangler deploy` against the template
 * fails rather than quietly deploying an instance under the framework's identity.
 */
export const PLACEHOLDER = 'REPLACE_VIA_NPM_RUN_WORKER_CONFIG';

/** Longest <place-slug> the derivation emits, before the `-<worker>` suffix. */
export const PLACE_SLUG_MAX = 40;

/* -- Derivation ----------------------------------------------------------- */

/**
 * `place.name` reduced to a DNS-safe token. Throws when nothing survives, because
 * a nameless instance has no account-scoped identity to deploy under and a silent
 * fallback would put it back on a shared name.
 */
export function placeSlug(placeName) {
  const slug = String(placeName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PLACE_SLUG_MAX)
    .replace(/-+$/, '');
  if (!slug) {
    throw new Error(
      'place.name in place.config.ts has no [a-z0-9] characters, so no worker name ' +
        'can be derived from it. Set a place name the derivation rule can reduce to a ' +
        'DNS-safe token.',
    );
  }
  return slug;
}

/** The account-scoped name for one worker directory: `<place-slug>-<worker>`. */
export function workerName(placeName, workerDir) {
  const dir = String(workerDir ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!dir) throw new Error(`worker directory name "${workerDir}" is not usable as a name suffix`);
  return `${placeSlug(placeName)}-${dir}`;
}

/**
 * `place.domain` as an origin. An explicit scheme is preserved, anything else gets
 * https://, and a trailing slash is dropped -- the worker compares this against the
 * browser's `Origin` header, which never carries one.
 */
export function originFromDomain(domain) {
  const raw = String(domain ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/* -- Narrow TOML reader --------------------------------------------------- */

const HEADER_RE = /^\s*(\[\[?)([A-Za-z0-9_.-]+)(\]\]?)\s*$/;
const ASSIGN_RE = /^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)(.*)$/;

/** Parse one TOML value: "string", true/false, integer, or inline array. */
function parseValue(raw, lineNo) {
  const text = raw.trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end === -1) throw new Error(`line ${lineNo}: unterminated inline array`);
    const inner = text.slice(1, end).trim();
    const items = inner
      ? inner.split(',').map((s) => {
          const t = s.trim();
          if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
          throw new Error(`line ${lineNo}: inline array items must be strings`);
        })
      : [];
    return { value: items, type: 'array' };
  }
  if (text.startsWith('"')) {
    let out = '';
    for (let i = 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined) break;
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        i += 1;
      } else if (ch === '"') {
        const rest = text.slice(i + 1).trim();
        if (rest !== '' && !rest.startsWith('#')) {
          throw new Error(`line ${lineNo}: unexpected text after a string value: ${rest}`);
        }
        return { value: out, type: 'string' };
      } else {
        out += ch;
      }
    }
    throw new Error(`line ${lineNo}: unterminated string value`);
  }
  const bare = text.split('#')[0].trim();
  if (bare === 'true' || bare === 'false') return { value: bare === 'true', type: 'boolean' };
  if (/^-?\d+$/.test(bare)) return { value: Number(bare), type: 'integer' };
  throw new Error(
    `line ${lineNo}: unsupported value "${text}". This reader accepts strings, ` +
      'booleans, integers, and inline arrays only; extend it rather than loosening the gate.',
  );
}

/**
 * Walk a wrangler config line by line, calling `onAssign` for every key with the
 * table it belongs to. Throws on any line that is not blank, a comment, a table
 * header, or a scalar assignment.
 *
 * `table` is '' at the top level, the header name inside `[table]`, and the header
 * name inside `[[array]]`; `index` counts the [[array]] occurrences from 0.
 */
function walkToml(text, onAssign) {
  let table = '';
  let isArray = false;
  let index = 0;
  const counts = new Map();
  text.split('\n').forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const header = HEADER_RE.exec(line);
    if (header) {
      const [, open, name, close] = header;
      if (open.length !== close.length) throw new Error(`line ${lineNo}: malformed table header`);
      table = name;
      isArray = open === '[[';
      if (isArray) {
        index = (counts.get(name) ?? -1) + 1;
        counts.set(name, index);
      } else {
        index = 0;
      }
      return;
    }
    const assign = ASSIGN_RE.exec(line);
    if (!assign) {
      throw new Error(`line ${lineNo}: cannot parse "${trimmed}" as a table header or assignment`);
    }
    const [, , key, , rawValue] = assign;
    const parsed = parseValue(rawValue, lineNo);
    onAssign({ table, isArray, index, key, ...parsed, lineNo });
  });
}

/**
 * Structured view of a wrangler config:
 *   { top: {key: value}, tables: {name: {key: value}}, arrays: {name: [{key: value}]} }
 * Throws on anything the reader does not support.
 */
export function parseWranglerToml(text) {
  const top = {};
  const tables = {};
  const arrays = {};
  walkToml(text, ({ table, isArray, index, key, value }) => {
    if (table === '') {
      top[key] = value;
    } else if (isArray) {
      arrays[table] ??= [];
      arrays[table][index] ??= {};
      arrays[table][index][key] = value;
    } else {
      tables[table] ??= {};
      tables[table][key] = value;
    }
  });
  return { top, tables, arrays };
}

/* -- Override application -------------------------------------------------- */

/**
 * Rewrite the values of specific keys, leaving every other byte of the template
 * alone -- comments, ordering, and untouched keys carry through unchanged.
 *
 * `overrides` is a list of `{ table, key, value, required }`. `table` is '' for a
 * top-level key. Every occurrence of a key inside a repeated [[table]] is rewritten.
 * A `required` override that matches no line throws: the template changed shape, and
 * silently generating a config missing its origin or its database name is exactly the
 * failure this whole path exists to prevent.
 */
export function applyOverrides(text, overrides) {
  const hits = overrides.map(() => 0);
  const out = [];
  let table = '';
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const header = HEADER_RE.exec(line);
    if (header) {
      table = header[2];
      out.push(line);
      continue;
    }
    const assign = ASSIGN_RE.exec(line);
    if (!assign) {
      out.push(line);
      continue;
    }
    const [, indent, key, sep] = assign;
    const idx = overrides.findIndex((o) => o.table === table && o.key === key);
    if (idx === -1) {
      out.push(line);
      continue;
    }
    hits[idx] += 1;
    const val = overrides[idx].value;
    const formatted = Array.isArray(val)
      ? `[${val.map((v) => JSON.stringify(v)).join(', ')}]`
      : JSON.stringify(String(val));
    out.push(`${indent}${key}${sep}${formatted}`);
  }
  overrides.forEach((o, i) => {
    if (o.required && hits[i] === 0) {
      const where = o.table === '' ? 'top level' : `[${o.table}]`;
      throw new Error(
        `the template has no "${o.key}" key at the ${where}, so the generated config ` +
          'would ship without it. Restore the key in the template, or update the ' +
          'generator if the worker no longer needs it.',
      );
    }
  });
  return out.join('\n');
}

/**
 * Drop the template's own leading comment block (everything before its first
 * directive) so the generated file does not carry a "placeholders only" header over
 * real values. Blank lines directly after the block go with it.
 */
export function stripLeadingComments(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].trim().startsWith('#') || lines[i].trim() === '')) i += 1;
  return lines.slice(i).join('\n');
}
