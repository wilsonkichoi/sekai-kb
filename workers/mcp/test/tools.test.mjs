/**
 * LB-95 contract tests for the four MCP tools (workers/mcp/src/tools.mjs).
 *
 * These run WITHOUT the corpus artifact on disk: tools.mjs imports only the pure
 * ranking code from workers/lib/corpus.mjs, and `semantic_search` takes its decoded
 * corpus as an option. The transport suite (mcp.test.mjs) is the one that installs an
 * artifact, so only one file in this worker touches that shared path.
 *
 * Nothing here performs network I/O: every site fetch goes through an injected stub.
 * No test reads the implementation source.
 *
 * This file lives under workers/, which both machine gates scan: its source is pure
 * ASCII and carries no denylisted place term.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_RELEVANCE_FLOOR } from '../../lib/corpus.mjs';
import {
  DEFAULT_RESULT_LIMIT,
  KB_CACHE_TTL_SECONDS,
  MAX_RESULT_LIMIT,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  ToolInputError,
  ToolUnavailableError,
  getArticle,
  listTopics,
  search,
  semanticSearch,
} from '../src/tools.mjs';
import {
  ALPHA_MARKDOWN,
  FIXTURE_CORPUS,
  FLOORED_TITLES,
  SITE_ORIGIN,
  TOPICS,
  createAiStub,
  createFetchStub,
  makeEnv,
} from './helpers.mjs';

const opts = (fetchImpl) => ({ fetchImpl });

describe('the tool catalogue', () => {
  test('declares exactly the four tools the spec names, each with a JSON Schema', () => {
    assert.deepEqual(TOOL_NAMES, ['list_topics', 'get_article', 'search', 'semantic_search']);
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 0, `${tool.name} needs a description`);
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
  });

  test('every required argument is declared as a property of its own schema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      for (const name of tool.inputSchema.required ?? []) {
        assert.ok(
          Object.hasOwn(tool.inputSchema.properties, name),
          `${tool.name} requires "${name}" but does not declare it`,
        );
      }
    }
  });
});

describe('list_topics', () => {
  test('returns every article from the deployed site, with the slug get_article takes', async () => {
    const fetchImpl = createFetchStub();
    const result = await listTopics({}, makeEnv(), opts(fetchImpl));

    assert.equal(result.count, TOPICS.length);
    assert.deepEqual(
      result.topics.map((topic) => topic.slug),
      ['guides/alpha', 'guides/bravo', 'notes/charlie'],
    );
    assert.equal(result.topics[0].title, 'Alpha Guide');
    assert.deepEqual(result.topics[0].tags, ['alpha', 'reference']);
  });

  test('fetches the site over HTTP with an edge cache TTL and holds no bundled copy', async () => {
    const fetchImpl = createFetchStub();
    await listTopics({}, makeEnv(), opts(fetchImpl));

    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, `${SITE_ORIGIN}/kb/topics.json`);
    assert.deepEqual(fetchImpl.calls[0].init.cf, {
      cacheTtl: KB_CACHE_TTL_SECONDS,
      cacheEverything: true,
    });
  });

  test('an optional category restricts the listing', async () => {
    const result = await listTopics({ category: 'notes' }, makeEnv(), opts(createFetchStub()));
    assert.equal(result.count, 1);
    assert.equal(result.topics[0].slug, 'notes/charlie');
  });

  test('a category nothing matches is an empty listing, not an error', async () => {
    const result = await listTopics({ category: 'absent' }, makeEnv(), opts(createFetchStub()));
    assert.equal(result.count, 0);
    assert.deepEqual(result.topics, []);
  });

  test('an unconfigured SITE_ORIGIN is reported rather than fetched blindly', async () => {
    await assert.rejects(
      () => listTopics({}, makeEnv({ SITE_ORIGIN: '' }), opts(createFetchStub())),
      (error) => error instanceof ToolUnavailableError && /SITE_ORIGIN/.test(error.message),
    );
  });

  test('an unreachable site is an availability failure, not a wrong answer', async () => {
    const fetchImpl = createFetchStub({ '/kb/topics.json': { status: 503 } });
    await assert.rejects(
      () => listTopics({}, makeEnv(), opts(fetchImpl)),
      (error) => error instanceof ToolUnavailableError && /503/.test(error.message),
    );
  });
});

describe('get_article', () => {
  test('returns the raw markdown of one article, frontmatter included', async () => {
    const fetchImpl = createFetchStub();
    const result = await getArticle({ slug: 'guides/alpha' }, makeEnv(), opts(fetchImpl));

    assert.equal(result.slug, 'guides/alpha');
    assert.equal(result.url, '/guides/alpha');
    assert.equal(result.markdown, ALPHA_MARKDOWN);
    assert.equal(fetchImpl.calls[0].url, `${SITE_ORIGIN}/kb/articles/guides/alpha.md`);
  });

  test('an UNKNOWN SLUG is a tool input error naming how to find the real ones', async () => {
    // DoD 2: the named unknown-slug case. The site answers 404 and the tool turns that
    // into an actionable message rather than an empty article or a transport failure.
    await assert.rejects(
      () => getArticle({ slug: 'guides/nonexistent' }, makeEnv(), opts(createFetchStub())),
      (error) =>
        error instanceof ToolInputError &&
        /no article "guides\/nonexistent"/.test(error.message) &&
        /list_topics/.test(error.message),
    );
  });

  test('a missing or blank slug is rejected before any fetch', async () => {
    const fetchImpl = createFetchStub();
    for (const params of [{}, { slug: '' }, { slug: '   ' }, { slug: 42 }]) {
      await assert.rejects(
        () => getArticle(params, makeEnv(), opts(fetchImpl)),
        (error) => error instanceof ToolInputError,
      );
    }
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('a slug that could steer the fetch off the configured origin is refused', async () => {
    // The slug is interpolated into a URL, so this is a boundary and not a nicety: each
    // of these would reach a path (or a host) that is not an article of this site.
    const fetchImpl = createFetchStub();
    const hostile = [
      '../../../etc/passwd',
      'guides/../../secret',
      'https://elsewhere.example.invalid/x',
      'guides/alpha?x=1',
      'guides/alpha#frag',
      'guides%2Falpha',
      'Guides/Alpha',
      'guides',
      'guides/alpha/extra',
    ];
    for (const slug of hostile) {
      await assert.rejects(
        () => getArticle({ slug }, makeEnv(), opts(fetchImpl)),
        (error) => error instanceof ToolInputError,
        `"${slug}" must be refused`,
      );
    }
    assert.equal(fetchImpl.calls.length, 0, 'no hostile slug may reach a fetch');
  });
});

describe('search', () => {
  test('matches titles, descriptions, and tags, ranking title hits highest', async () => {
    const result = await search({ query: 'guide' }, makeEnv(), opts(createFetchStub()));
    assert.equal(result.count, 2);
    assert.deepEqual(
      result.results.map((hit) => hit.slug),
      ['guides/alpha', 'guides/bravo'],
    );
  });

  test('every term must match, so a second word narrows rather than widens', async () => {
    const result = await search({ query: 'guide bravo' }, makeEnv(), opts(createFetchStub()));
    assert.equal(result.count, 1);
    assert.equal(result.results[0].slug, 'guides/bravo');
  });

  test('ZERO MATCHES is a successful empty result, not an error', async () => {
    // DoD 2: the named zero-match case. "The knowledge base has nothing on this" is an
    // answer a model can act on; an error is not, and padded results are worse than both.
    const result = await search({ query: 'zulu' }, makeEnv(), opts(createFetchStub()));
    assert.equal(result.count, 0);
    assert.deepEqual(result.results, []);
    assert.equal(result.query, 'zulu');
  });

  test('limit defaults, is honoured, and is bounded', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      t: `Match ${index}`,
      d: 'shared term',
      u: `/notes/match-${index}`,
      tags: [],
      lang: 'en',
    }));
    const fetchImpl = createFetchStub({
      '/kb/search-index.json': { body: JSON.stringify(many) },
    });

    const byDefault = await search({ query: 'shared' }, makeEnv(), opts(fetchImpl));
    assert.equal(byDefault.count, 40, 'count reports the whole match set');
    assert.equal(byDefault.results.length, DEFAULT_RESULT_LIMIT);

    const limited = await search({ query: 'shared', limit: 3 }, makeEnv(), opts(fetchImpl));
    assert.equal(limited.results.length, 3);

    for (const limit of [0, -1, 1.5, MAX_RESULT_LIMIT + 1, '5']) {
      await assert.rejects(
        () => search({ query: 'shared', limit }, makeEnv(), opts(fetchImpl)),
        (error) => error instanceof ToolInputError,
        `limit ${JSON.stringify(limit)} must be refused`,
      );
    }
  });

  test('a blank query is rejected before any fetch', async () => {
    const fetchImpl = createFetchStub();
    await assert.rejects(
      () => search({ query: '  ' }, makeEnv(), opts(fetchImpl)),
      (error) => error instanceof ToolInputError,
    );
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe('semantic_search', () => {
  const run = (params, env, extra = {}) =>
    semanticSearch(params, env, { corpus: FIXTURE_CORPUS, floor: DEFAULT_RELEVANCE_FLOOR, ...extra });

  test('embeds the query in the corpus model space and returns passages best first', async () => {
    const AI = createAiStub({ query: [10, 0, 0] });
    const result = await run({ query: 'which guide matches?' }, makeEnv({ AI }));

    assert.equal(AI.calls.length, 1);
    assert.equal(AI.calls[0].model, '@cf/baai/bge-m3');
    assert.deepEqual(AI.calls[0].input, { text: ['which guide matches?'] });

    assert.deepEqual(result.results.map((hit) => hit.title), FLOORED_TITLES);
    assert.ok(result.results[0].score >= result.results.at(-1).score);
    assert.equal(result.results[0].slug, 'guides/alpha');
    assert.equal(typeof result.results[0].text, 'string');
    assert.equal(typeof result.results[0].heading, 'string');
  });

  test('BELOW THE RELEVANCE FLOOR returns nothing, never the least-bad matches', async () => {
    // DoD 2: the named below-floor case, and the reason the floor exists at all. This
    // query direction is orthogonal to every fixture vector, so every passage scores 0
    // against the SHIPPED default floor -- the shape of a real question this corpus
    // cannot answer. Top-k alone would still hand back its five nearest passages, and a
    // model reading them has no way to tell that from a real hit.
    const AI = createAiStub({ query: [0, 0, 10] });
    const result = await run({ query: 'a question the corpus cannot answer' }, makeEnv({ AI }));

    assert.equal(result.count, 0);
    assert.deepEqual(result.results, []);
  });

  test('the floor is applied before the limit, so a generous limit cannot resurrect a weak match', async () => {
    const AI = createAiStub({ query: [10, 0, 0] });
    const floored = await run({ query: 'q', limit: 6 }, makeEnv({ AI }));
    assert.equal(floored.count, FLOORED_TITLES.length, 'the limit does not widen the floor');

    // Dropping the floor to zero admits the fifth passage (0.197) and still excludes the
    // sixth, which points the other way (-1.0). Filtering after slicing would have
    // returned the same four here and the five nearest above -- the two orders are only
    // distinguishable when fewer than `limit` passages clear the bar, which is the case
    // above.
    const unfloored = await run({ query: 'q', limit: 6 }, makeEnv({ AI }), { floor: 0 });
    assert.equal(unfloored.count, 5);
  });

  test('an exhausted or unavailable Workers AI allowance is an availability failure', async () => {
    const AI = createAiStub({ throws: 'no more neurons' });
    await assert.rejects(
      () => run({ query: 'q' }, makeEnv({ AI })),
      (error) => error instanceof ToolUnavailableError && /no more neurons/.test(error.message),
    );
  });

  test('an embedding from another model space is reported, not silently ranked', async () => {
    const AI = createAiStub({ query: [1, 0, 0, 0, 0] });
    await assert.rejects(
      () => run({ query: 'q' }, makeEnv({ AI })),
      (error) => error instanceof ToolUnavailableError && /dimension/.test(error.message),
    );
  });

  test('a blank query is rejected before any neuron is spent', async () => {
    const AI = createAiStub();
    await assert.rejects(
      () => run({ query: '' }, makeEnv({ AI })),
      (error) => error instanceof ToolInputError,
    );
    assert.equal(AI.calls.length, 0);
  });
});
