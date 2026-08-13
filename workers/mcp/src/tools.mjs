// workers/mcp/src/tools.mjs — the four tools this MCP server exposes, and their schemas.
//
// THREE OF THE FOUR HOLD NO BUILD-TIME COPY (ROADMAP 2026-08-12 amendment, D5).
// `list_topics`, `get_article`, and `search` fetch the deployed site's own `/kb/` files
// over HTTP with an edge cache TTL. Those files are rebuilt by every push to `main` and
// ship with the site, so the site stays the single source and these three are current
// with `main` by construction. Bundling them into the worker at deploy time would have
// bought a cache-cold fetch and paid for it with a corpus that only refreshes when
// somebody remembers to redeploy.
//
// `semantic_search` is the exception, and the only tool that touches the bundled
// artifact: there is no static file that answers "which chunks are nearest this query".
// It embeds the query through Workers AI and ranks the corpus in-worker, exactly as
// workers/chat/ does and in the same model space (workers/lib/corpus.mjs).
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { EMBED_MODEL, retrieve } from '../../lib/corpus.mjs';

/**
 * Edge cache lifetime for the three site-backed tools, in seconds.
 *
 * A compiled-in constant rather than a deploy var: it trades answer freshness against
 * origin fetches, five minutes is well inside one deploy cycle, and every value an
 * instance is invited to retune has to carry a place.config.ts key, a runbook row, and a
 * generator registration (scripts/deploy/wrangler-config.mjs). This one has not earned
 * that surface.
 */
export const KB_CACHE_TTL_SECONDS = 300;

/** Results returned by `search` and `semantic_search` when the caller names no limit. */
export const DEFAULT_RESULT_LIMIT = 10;
export const MAX_RESULT_LIMIT = 50;

/**
 * A `category/slug` article id, matching what `list_topics` returns in `url` and what
 * the corpus carries as `slug`. Both halves are the kebab-case tokens the site's routes
 * are built from.
 *
 * The pattern is a security boundary, not a nicety: this value is interpolated into a
 * URL the worker fetches, so anything permitting `.`, `/`, `%`, or a scheme would let a
 * caller steer that fetch off the configured origin and hand back the response as if it
 * were an article.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The tool descriptors `tools/list` returns, in the order a client should meet them. */
export const TOOL_DEFINITIONS = [
  {
    name: 'list_topics',
    description:
      'List every article in the knowledge base with its title, description, category, ' +
      'tags, and URL. Start here to see what the knowledge base covers.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category slug to restrict the listing to.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_article',
    description:
      'Fetch one article as raw Markdown, including its frontmatter. The slug is the ' +
      '"category/name" form returned by list_topics and search.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Article id in "category/name" form, for example "history/founding".',
        },
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    description:
      'Keyword search over article titles, descriptions, and tags. Fast and exact; use ' +
      'semantic_search when the wording of the question may not match the wording of ' +
      'the articles.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_RESULT_LIMIT,
          description: `Maximum results to return (default ${DEFAULT_RESULT_LIMIT}).`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'semantic_search',
    description:
      'Meaning-based search over the article corpus. Returns the passages nearest the ' +
      'question, with the article each came from, or nothing at all when the knowledge ' +
      'base does not cover it.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A question or phrase to match by meaning.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_RESULT_LIMIT,
          description: `Maximum passages to return (default ${DEFAULT_RESULT_LIMIT}).`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

/** Raised by a tool for a caller mistake: reported as a tool error, never a crash. */
export class ToolInputError extends Error {}

/** Raised when something the tool depends on is unavailable (the site, Workers AI). */
export class ToolUnavailableError extends Error {}

function requireString(params, field) {
  const value = params?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`"${field}" is required and must be a non-empty string`);
  }
  return value.trim();
}

function resolveLimit(params) {
  const value = params?.limit;
  if (value === undefined || value === null) return DEFAULT_RESULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new ToolInputError(`"limit" must be an integer between 1 and ${MAX_RESULT_LIMIT}`);
  }
  return value;
}

/**
 * Fetch one path from the deployed site, through Cloudflare's edge cache.
 *
 * `fetchImpl` is injected so the suite can exercise every branch without network I/O;
 * production passes the global `fetch`.
 */
async function fetchSite(env, path, { fetchImpl = fetch } = {}) {
  const origin = (env?.SITE_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (origin === '') {
    throw new ToolUnavailableError(
      'SITE_ORIGIN is not configured, so this server does not know which site to read',
    );
  }
  let response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      cf: { cacheTtl: KB_CACHE_TTL_SECONDS, cacheEverything: true },
    });
  } catch (error) {
    throw new ToolUnavailableError(`could not reach ${path}: ${error.message}`);
  }
  return response;
}

async function fetchSiteJson(env, path, options) {
  const response = await fetchSite(env, path, options);
  if (!response.ok) {
    throw new ToolUnavailableError(`${path} responded with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ToolUnavailableError(`${path} did not return JSON: ${error.message}`);
  }
}

/* -- list_topics ----------------------------------------------------------- */

export async function listTopics(params, env, options) {
  const topics = await fetchSiteJson(env, '/kb/topics.json', options);
  if (!Array.isArray(topics)) {
    throw new ToolUnavailableError('/kb/topics.json did not return an array');
  }
  const category = params?.category;
  if (category !== undefined && category !== null && typeof category !== 'string') {
    throw new ToolInputError('"category" must be a string when present');
  }
  const wanted = typeof category === 'string' ? category.trim() : '';
  const filtered = wanted === '' ? topics : topics.filter((t) => t?.category === wanted);
  return {
    count: filtered.length,
    // `slug` is added, not renamed: it is the id get_article takes, and deriving it
    // client-side from `url` is a rule every consumer would have to be told.
    topics: filtered.map((topic) => ({
      slug: typeof topic?.url === 'string' ? topic.url.replace(/^\//, '') : '',
      title: topic?.title ?? '',
      description: topic?.description ?? '',
      category: topic?.category ?? '',
      tags: Array.isArray(topic?.tags) ? topic.tags : [],
      url: topic?.url ?? '',
      readingTime: topic?.readingTime ?? null,
      date: topic?.date ?? null,
    })),
  };
}

/* -- get_article ----------------------------------------------------------- */

export async function getArticle(params, env, options) {
  const slug = requireString(params, 'slug').replace(/^\//, '');
  if (!SLUG_RE.test(slug)) {
    throw new ToolInputError(
      `"${slug}" is not a valid article slug; expected "category/name" in kebab-case`,
    );
  }
  const path = `/kb/articles/${slug}.md`;
  const response = await fetchSite(env, path, options);
  if (response.status === 404) {
    throw new ToolInputError(
      `no article "${slug}" exists in this knowledge base; call list_topics or search for the ` +
        'slugs that do',
    );
  }
  if (!response.ok) {
    throw new ToolUnavailableError(`${path} responded with HTTP ${response.status}`);
  }
  return { slug, url: `/${slug}`, markdown: await response.text() };
}

/* -- search ---------------------------------------------------------------- */

/**
 * Keyword match over the site's plain-array fallback index, whose documents are
 * `{t: title, d: description, u: url, tags, lang}`.
 *
 * Every whitespace-separated term must appear somewhere in one document's searchable
 * text (AND, not OR), which is what keeps a two-word query from returning everything
 * that mentions either word. Ranking is by how many terms hit the title, then the
 * description, so an exact title match sorts above a passing mention.
 */
export async function search(params, env, options) {
  const query = requireString(params, 'query');
  const limit = resolveLimit(params);
  const documents = await fetchSiteJson(env, '/kb/search-index.json', options);
  if (!Array.isArray(documents)) {
    throw new ToolUnavailableError('/kb/search-index.json did not return an array');
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const doc of documents) {
    const title = String(doc?.t ?? '').toLowerCase();
    const description = String(doc?.d ?? '').toLowerCase();
    const tags = (Array.isArray(doc?.tags) ? doc.tags : []).join(' ').toLowerCase();
    const haystack = `${title} ${description} ${tags}`;
    if (!terms.every((term) => haystack.includes(term))) continue;
    const score =
      terms.filter((term) => title.includes(term)).length * 4 +
      terms.filter((term) => tags.includes(term)).length * 2 +
      terms.filter((term) => description.includes(term)).length;
    scored.push({ score, doc });
  }
  scored.sort((left, right) => right.score - left.score);

  return {
    query,
    // An empty list is a real answer, not a failure: this tool succeeds and says the
    // knowledge base has nothing matching, rather than erroring or padding the result.
    count: scored.length,
    results: scored.slice(0, limit).map(({ doc }) => ({
      slug: typeof doc?.u === 'string' ? doc.u.replace(/^\//, '') : '',
      title: doc?.t ?? '',
      description: doc?.d ?? '',
      tags: Array.isArray(doc?.tags) ? doc.tags : [],
      url: doc?.u ?? '',
    })),
  };
}

/* -- semantic_search ------------------------------------------------------- */

/**
 * The one tool that reads the bundled corpus, and the one that costs Workers AI
 * neurons. `corpus` and `floor` are resolved by the caller (src/index.mjs), which is
 * also where the rate limit that protects the account allowance is applied.
 */
export async function semanticSearch(params, env, options = {}) {
  const { corpus, floor } = options;
  const query = requireString(params, 'query');
  const limit = resolveLimit(params);

  let embedded;
  try {
    embedded = await env.AI.run(EMBED_MODEL, { text: [query] });
  } catch (error) {
    throw new ToolUnavailableError(`query embedding is unavailable: ${error.message}`);
  }

  let ranked;
  try {
    ranked = retrieve(embedded?.data?.[0], corpus, { floor, topK: limit });
  } catch (error) {
    throw new ToolUnavailableError(error.message);
  }

  return {
    query,
    // Below the floor, nothing is returned at all. Top-k alone would hand back the k
    // least-bad passages for a question this corpus cannot answer, and a model reading
    // them has no way to tell that from a real hit.
    count: ranked.length,
    results: ranked.map(({ chunk, score }) => ({
      slug: chunk.slug,
      title: chunk.title,
      heading: chunk.heading,
      url: chunk.url,
      score: Number(score.toFixed(4)),
      text: chunk.text,
    })),
  };
}
