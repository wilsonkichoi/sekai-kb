// The `/ai` page: what it documents, and what decides it -- run with
// `node --test tests/ai-page.test.mjs`.
//
// LB-96's page half. These are source assertions, in the idiom of the last test in
// tests/mcp-gate.test.mjs, because the properties worth pinning here are about
// WHERE the page gets its answer, and a rendered snapshot of one config cannot show
// that. The page is built once per instance from that instance's own flags, so a
// snapshot proves the demo config's combination and nothing about an adopter's.
//
// Why each property is pinned:
//
// * The page must resolve its sections through `aiPaths(config)` rather than
//   testing flags itself. `features.mcp` alone is half a gate (tests/mcp-gate.test.mjs):
//   a page that trusted the flag would document an endpoint that refuses every
//   connection the moment an adopter turns the flag on before deploying the worker.
//   Driving from the shared helper is also what makes DoD 3 structural -- with the
//   MCP worker undeployed there is no MCP entry in the list, so there is no section
//   to leave dangling, and that holds without anyone remembering to delete copy.
//
// * `data-ai-path` is the machine handle on the page. It is what lets the theme
//   suite, a later assertion, or an operator enumerate what this instance actually
//   serves without parsing prose. It is worth nothing if a section can omit it or
//   carry a value outside the AiPathId union, so both are asserted.
//
// * The client-config snippet is the one thing on the page a reader copies into
//   another program. It must match the shape DEPLOY.md documents (Streamable HTTP,
//   `"type": "http"`) and must carry this instance's resolved endpoint rather than a
//   literal url that would send every adopter's client to somebody else's worker.
//
// This file lives under tests/, which both machine gates scan: its source is pure
// ASCII and carries no place-specific string.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PATH = join(REPO, 'src/pages/ai.astro');

/** The AiPathId union, in D4 order. Nothing else may tag a section. */
const AI_PATH_IDS = ['llms', 'kb', 'mcp', 'chat'];

const page = () => readFileSync(PAGE_PATH, 'utf8');

/* --------------------------------------------------------------- the page */

describe('the /ai page exists and is driven by the shared path list', () => {
  test('src/pages/ai.astro is present', () => {
    assert.ok(existsSync(PAGE_PATH), 'the AI access page must be served at /ai');
  });

  test('it imports aiPaths and resolves it against place.config', () => {
    const text = page();
    assert.match(
      text,
      /import \{[^}]*\baiPaths\b[^}]*\} from ['"][^'"]*lib\/ai-paths[^'"]*['"]/,
      'the page must import the shared aiPaths helper',
    );

    const configImport = text.match(/import\s+(\w+)\s+from\s+['"][^'"]*place\.config[^'"]*['"]/);
    assert.ok(configImport, 'the page must import the place config');
    assert.ok(
      text.includes(`aiPaths(${configImport[1]})`),
      `the page must call aiPaths(${configImport[1]}), so the section list is the resolved one`,
    );
  });

  test('it open-codes neither feature flag', () => {
    // Reading `features.mcp` or `features.chat` here is reading half a gate. The
    // other half -- a deployed worker endpoint -- is what makes the difference
    // between documenting a path and advertising a dead url.
    const text = page();
    assert.equal(
      /features\.mcp/.test(text),
      false,
      'the page must not read features.mcp directly; that is half the gate',
    );
    assert.equal(
      /features\.chat/.test(text),
      false,
      'the page must not read features.chat directly; that is half the gate',
    );
  });

  test('it hardcodes no worker url', () => {
    // Every worker endpoint is account-scoped. A literal one in a framework-owned
    // page ships to every adopter and points their readers at another instance.
    const text = page();
    assert.equal(
      /https?:\/\/[^\s"'`<>]*workers\.dev/.test(text),
      false,
      'a worker endpoint belongs in place.config.ts, never in the page',
    );
  });
});

/* ------------------------------------------------------- the machine handle */

describe('every section on the page is tagged with an AiPathId', () => {
  test('the page emits data-ai-path', () => {
    assert.match(page(), /data-ai-path/, 'the page needs a machine handle on its path sections');
  });

  test('no data-ai-path value falls outside the AiPathId union', () => {
    const matches = [
      ...page().matchAll(/data-ai-path=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g),
    ];
    assert.ok(matches.length > 0, 'expected at least one tagged section');

    for (const [whole, dq, sq, expr] of matches) {
      const literal = dq ?? sq;
      if (literal !== undefined && !/^\{/.test(literal)) {
        assert.ok(
          AI_PATH_IDS.includes(literal),
          `${whole} tags a section with "${literal}", which is not an AiPathId`,
        );
      } else {
        // A computed value is acceptable only when it is a path's own `id`, whose
        // type is the union. Anything else could be any string at all.
        assert.match(
          expr ?? literal,
          /\bid\b/,
          `${whole} must take its value from an AiPath's id`,
        );
      }
    }
  });

  test('every <section> the page emits carries the attribute', () => {
    // A section on /ai is one consumption path's section. An untagged one is a
    // block of prose about a path that nothing can enumerate; keep non-path copy
    // outside <section>.
    const openings = [...page().matchAll(/<section\b[^>]*>/g)].map((m) => m[0]);
    const untagged = openings.filter((tag) => !tag.includes('data-ai-path'));
    assert.deepEqual(untagged, [], 'every <section> on /ai must carry data-ai-path');
  });
});

/* ------------------------------------------------------ the client snippet */

const PLACEHOLDER = 'INTERPOLATED';

/**
 * Normalizes the snippet region so its SHAPE can be read regardless of how the
 * page spells it -- literal JSON text in a code block, or an object the page
 * builds and stringifies. Both are legitimate; what the contract is about is the
 * object a reader ends up copying, so every computed part collapses to a
 * placeholder and the rest is parsed as JSON.
 */
function normalizeSnippet(region) {
  return (
    region
      // `${expr}` in a template literal, and `{expr}` used as a quoted value.
      .replace(/\$\{[^{}]*\}/g, PLACEHOLDER)
      .replace(/"\{[^{}"]*\}"/g, `"${PLACEHOLDER}"`)
      // A computed server key: the name is the instance's, not the framework's.
      .replace(/\[\s*[A-Za-z_$][\w$.]*\s*\]\s*:/g, '"server":')
      .replace(/'([^'\\]*)'/g, '"$1"')
      // Bare object keys, then bare (expression) values.
      .replace(/([{,])(\s*)([A-Za-z_$][\w$]*)(\s*):/g, '$1$2"$3"$4:')
      .replace(/:(\s*)([A-Za-z_$][\w$.?![\]]*)(\s*)([,}])/g, `:$1"${PLACEHOLDER}"$3$4`)
  );
}

/**
 * The MCP client config the page renders. Returns `{ raw, value }`, `value` being
 * `null` when the region does not describe an object at all.
 */
function clientSnippet(text) {
  const normalized = normalizeSnippet(text);

  const key = normalized.indexOf('mcpServers');
  if (key === -1) return { raw: null, value: null, placeholder: PLACEHOLDER };

  const start = normalized.lastIndexOf('{', key);
  let depth = 0;
  let end = -1;
  for (let i = start; i < normalized.length; i += 1) {
    if (normalized[i] === '{') depth += 1;
    else if (normalized[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const raw = end === -1 ? null : normalized.slice(start, end + 1);
  let value = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    value = null;
  }
  return { raw, value, placeholder: PLACEHOLDER };
}

describe('the MCP client-config snippet', () => {
  test('registers one Streamable-HTTP server, as DEPLOY.md documents', () => {
    // A reader copies this into a client config file. It has to be the object that
    // works there, not a paraphrase, and it has to match the snippet the runbook
    // shows for the same worker (DEPLOY.md, Deploying the MCP worker, step 4).
    const { raw, value } = clientSnippet(page());
    assert.ok(raw !== null, 'the page must render an mcpServers client-config snippet');
    assert.ok(value !== null, `the snippet must be valid JSON; got:\n${raw}`);
    assert.ok(value.mcpServers, 'the snippet must carry an mcpServers object');

    const servers = Object.values(value.mcpServers);
    assert.equal(servers.length, 1, 'the snippet registers exactly one server: this instance');
    assert.equal(
      servers[0].type,
      'http',
      'the worker speaks Streamable HTTP, so the entry must declare "type": "http"',
    );
  });

  test('takes its url from the resolved endpoint, not a literal', () => {
    // The endpoint is `workers.mcp`, which is per-instance. A literal url here
    // would be correct for exactly one adopter and wrong for every other.
    const { value, placeholder } = clientSnippet(page());
    assert.ok(value !== null, 'the snippet must be valid JSON before its url can be checked');
    const url = Object.values(value.mcpServers)[0].url;
    assert.equal(
      url,
      placeholder,
      `the snippet url must come from this instance's configured MCP endpoint, got "${url}"`,
    );
  });

  test('the snippet belongs to the mcp path section', () => {
    // DoD 3: with the MCP gate off, `aiPaths` omits the mcp entry, so the section
    // that carries this snippet is never emitted. That only holds if the snippet
    // lives inside the mcp path's own section rather than beside the list.
    const text = page();
    const snippetAt = text.indexOf('mcpServers');
    assert.notEqual(snippetAt, -1, 'the page must render the client-config snippet');

    const mcpMarker = Math.min(
      ...[/data-ai-path=["']mcp["']/, /["']mcp["']/]
        .map((re) => {
          const m = text.match(re);
          return m ? text.indexOf(m[0]) : Number.POSITIVE_INFINITY;
        }),
    );
    assert.ok(
      mcpMarker < snippetAt,
      'the snippet must sit inside the section gated on the mcp path',
    );
  });
});
