// The `/kb/agent.md` boot file and the AI path list -- run with
// `node --experimental-strip-types --test tests/agent-boot.test.mjs`.
//
// LB-96 DoD 1 (the prebuild emits agent.md, llms.txt links it, and every place
// string in both comes from place.config.ts) and DoD 4 (the boot file carries
// identity, a topic index with resolvable urls, and fetch instructions). The
// MCP-off half of DoD 3 is here too, as the `aiPaths` combination that must
// yield exactly the three remaining paths.
//
// Why each property below is pinned:
//
// * `renderAgentBoot` is the only thing a visiting agent reads before it decides
//   what to fetch, so the file has to be self-sufficient: who this is, where the
//   index lives, and how to turn an index entry into a request. A boot file with
//   site-root-relative urls is not self-sufficient -- an agent that fetched it
//   through a proxy, a cache, or a copied paste has no origin to resolve `/kb/`
//   against. Hence every url assertion here is an ABSOLUTE url assertion.
//
// * The function is pure by contract (config in, bytes out, nothing read from
//   disk). That is what lets the same renderer serve the prebuild and any later
//   surface without them drifting, so determinism and the absence of any string
//   that did not come from the passed config are asserted directly, not assumed.
//
// * The MCP section is asserted as an if-and-only-if against `resolveMcp`, not
//   against `features.mcp`. Half a gate advertises an endpoint that refuses every
//   connection (tests/mcp-gate.test.mjs), and a boot file is precisely the
//   document an agent trusts blindly. The flag-off case additionally pins the
//   ABSENCE of the substring `MCP` anywhere in the output: DoD 3's "no dangling
//   MCP section" means no leftover sentence about a capability this instance does
//   not serve, not merely a missing heading.
//
// * The prebuild case runs the real `scripts/core/build-kb-index.mjs` against a
//   disposable instance built in a temp directory -- its own place.config.ts, its
//   own knowledge/ tree. Rendering in-process would prove the renderer works and
//   nothing about whether the build emits the file, and running against this
//   repository's own corpus would let the template's demo strings satisfy an
//   assertion that is supposed to prove the strings came from config.
//
// Fixtures here are synthetic. tests/ is framework code that ships to every
// adopter, so nothing may assume the demo corpus, the demo config, or any place
// name, and this file's source is pure ASCII.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { KB_PATHS, brandName, renderAgentBoot, siteOrigin } from '../src/lib/agent-boot.ts';
import { aiPaths } from '../src/lib/ai-paths.ts';
import { resolveMcp } from '../src/lib/mcp.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// This repository's own config, read rather than copied, so the leak assertion in
// the prebuild case compares against whatever it actually says today.
const { default: realPlaceConfig } = await import(
  pathToFileURL(join(REPO, 'place.config.ts')).href
);

/* ------------------------------------------------------------------ fixtures */

const category = (slug, title) => ({
  slug,
  title,
  icon: 'X',
  description: `${title} articles.`,
});

/**
 * Place A. `Weather` is configured with no article in it, which is the case that
 * separates "renders the configured categories" from "renders the categories that
 * have something to read".
 */
const placeA = () => ({
  place: {
    name: 'Example Basin',
    brandSuffix: '-notes',
    tagline: 'A synthetic place that exists only inside this test file.',
    domain: 'kb.example.test',
    locale: 'en',
    languages: ['en'],
  },
  categories: [category('guides', 'Guides'), category('harbor', 'Harbor'), category('weather', 'Weather')],
  features: { mcp: false, chat: false },
  links: {
    repo: 'https://code.example.test/example-basin',
    email: 'hello@kb.example.test',
    social: {},
  },
  workers: {},
});

/** Place B shares no token with place A, and its MCP gate is fully on. */
const placeB = () => ({
  place: {
    name: 'Second Sample',
    brandSuffix: '-wiki',
    tagline: 'Another synthetic place, deliberately sharing no word with the first.',
    domain: 'docs.other.invalid',
    locale: 'en',
    languages: ['en'],
  },
  categories: [category('routes', 'Routes'), category('markets', 'Markets')],
  features: { mcp: true, chat: true },
  links: {
    repo: 'https://code.other.invalid/second-sample',
    email: 'hello@docs.other.invalid',
    social: {},
  },
  workers: {
    mcp: 'https://second-sample-mcp.workers.invalid',
    chat: 'https://second-sample-chat.workers.invalid',
  },
});

/**
 * A config predating both keys: no `features.mcp`, no `workers` block at all.
 * An instance merges a framework release without editing its config, so this is
 * the shape the renderer meets in the field, not a hypothetical.
 */
const placeLegacy = () => ({
  place: {
    name: 'Third Sample',
    tagline: 'A place whose config was written before either worker key existed.',
    domain: 'notes.third.invalid',
    locale: 'en',
    languages: ['en'],
  },
  categories: [category('guides', 'Guides')],
  features: { chat: false },
  links: { repo: 'https://code.third.invalid/third-sample', email: 'hi@notes.third.invalid', social: {} },
});

const article = (title, slug, cat) => ({
  title,
  description: `About ${title}.`,
  category: cat,
  url: `/${cat}/${slug}`,
  kb: `/kb/articles/${cat}/${slug}.md`,
});

/**
 * Two articles in `guides` (in a deliberate non-alphabetical order, so "input
 * order" is distinguishable from "sorted"), one in `harbor`, none in `weather`,
 * and one in `archive`, which place A does not configure at all. An article whose
 * category has no configured route has no reader page to link, so listing it
 * would hand an agent a url that 404s.
 */
const articlesA = () => [
  article('Zephyr Guide', 'zephyr-guide', 'guides'),
  article('Alpha Guide', 'alpha-guide', 'guides'),
  article('North Dock', 'north-dock', 'harbor'),
  article('Orphan Note', 'orphan-note', 'archive'),
];

const articlesB = () => [
  article('Ridge Route', 'ridge-route', 'routes'),
  article('Dawn Market', 'dawn-market', 'markets'),
];

/**
 * The rendered entry for one article: the list item that names it, plus any
 * continuation lines up to the next item, heading, or blank line. Used so the
 * "carries both urls" case and the "is one line" case fail separately.
 */
function entryFor(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*[-*]\s/.test(l) && l.includes(title));
  assert.notEqual(start, -1, `no list item names ${title}`);

  const entry = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*[-*]\s/.test(line) || line.startsWith('#') || line.trim() === '') break;
    entry.push(line);
  }
  return entry.join('\n');
}

/** Every http(s) url in a rendered body, with trailing sentence punctuation dropped. */
const urlsIn = (text) =>
  [...text.matchAll(/https?:\/\/[^\s)\]<>"'`]+/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));

/* ------------------------------------------------------------ siteOrigin */

describe('siteOrigin', () => {
  test('is the https origin of place.domain and never carries a trailing slash', () => {
    // Callers concatenate: `siteOrigin(config) + KB_PATHS.topics`. A trailing
    // slash there produces `//kb/topics.json`, which some servers serve and some
    // 404, so the shape is part of the contract rather than cosmetic.
    assert.equal(siteOrigin(placeA()), 'https://kb.example.test');
    assert.equal(siteOrigin(placeB()), 'https://docs.other.invalid');
    assert.equal(siteOrigin(placeA()).endsWith('/'), false);
  });
});

/* ------------------------------------------------------------- brandName */

describe('brandName', () => {
  test('appends place.brandSuffix when the instance sets one', () => {
    assert.equal(brandName(placeA()), 'Example Basin-notes');
    assert.equal(brandName(placeB()), 'Second Sample-wiki');
  });

  test('falls back to the last domain label when brandSuffix is unset', () => {
    // The fallback is what an adopter who never set a suffix gets, so it has to
    // be a name and not an empty string. Place C's domain ends `.invalid`.
    assert.equal(brandName(placeLegacy()), 'Third Sample.invalid');
  });

  test('an empty brandSuffix is a set value, not an unset one', () => {
    // `?? ` and `|| ` differ on exactly this input, and the difference is visible to
    // a reader: an adopter whose place name already reads as a whole name sets the
    // suffix to '' to suppress the domain label. Falling back here would append a
    // label they deliberately removed, on every surface that shows the brand.
    assert.equal(brandName({ ...placeA(), place: { ...placeA().place, brandSuffix: '' } }), 'Example Basin');
  });
});

/* --------------------------------------------------------------- KB_PATHS */

describe('KB_PATHS', () => {
  test('publishes the static protocol paths the boot file points at', () => {
    assert.deepEqual({ ...KB_PATHS }, {
      llmsTxt: '/llms.txt',
      agentBoot: '/kb/agent.md',
      topics: '/kb/topics.json',
      searchIndex: '/kb/search-index.json',
      articleTemplate: '/kb/articles/{category}/{slug}.md',
    });
  });

  test('the article path is a template, so it is never used as a fetchable url', () => {
    // Pinned so a later change cannot quietly turn the template into a real path
    // and leave every consumer fetching a literal `{slug}`.
    assert.match(KB_PATHS.articleTemplate, /\{category\}/);
    assert.match(KB_PATHS.articleTemplate, /\{slug\}/);
  });
});

/* ------------------------------------------------ renderAgentBoot: identity */

describe('renderAgentBoot identity (DoD 4)', () => {
  test('the first line is the brand name from config', () => {
    const config = placeA();
    const out = renderAgentBoot(config, articlesA());
    assert.equal(out.split('\n')[0], `# ${brandName(config)}`);
  });

  test('the body carries the tagline, the site origin, and the source repo', () => {
    // Identity is three answers to an agent's three questions: what is this, where
    // does it live, and where does the text actually come from. All three come
    // from config; none is a constant.
    const config = placeA();
    const out = renderAgentBoot(config, articlesA());
    assert.ok(out.includes(config.place.tagline), 'the tagline must appear verbatim');
    assert.ok(
      out.includes(`Website: ${siteOrigin(config)}`),
      'the boot file must state the site origin as `Website: <origin>`',
    );
    assert.ok(
      out.includes(`Source: ${config.links.repo}`),
      'the boot file must state the source repository as `Source: <repo>`',
    );
  });
});

/* ---------------------------------------- renderAgentBoot: how to read this */

describe('renderAgentBoot fetch instructions (DoD 4)', () => {
  test('names the topic index, the search index, and the article template absolutely', () => {
    const config = placeA();
    const origin = siteOrigin(config);
    const out = renderAgentBoot(config, articlesA());

    assert.ok(
      out.includes('## How to read this knowledge base'),
      'the fetch instructions need their own section heading',
    );
    for (const path of [KB_PATHS.topics, KB_PATHS.searchIndex, KB_PATHS.articleTemplate]) {
      assert.ok(
        out.includes(`${origin}${path}`),
        `fetch instructions must name ${path} as an absolute url under ${origin}`,
      );
    }
  });
});

/* -------------------------------------------- renderAgentBoot: topic index */

describe('renderAgentBoot topic index (DoD 4)', () => {
  test('the heading counts the articles it actually lists', () => {
    // The count introduces the index directly below it, so it counts what appears
    // there: articles in configured categories. An article whose category is not
    // configured has no reader page and no listing, and counting it would send a
    // consumer looking for a topic this file never names. In the real prebuild the
    // two numbers coincide -- the scan only visits configured categories -- so the
    // distinction is only observable from a caller that hands over more than it
    // configured, which is exactly what `articlesA()` does.
    const out = renderAgentBoot(placeA(), articlesA());
    const listed = articlesA().filter((a) => a.category !== 'archive').length;
    assert.ok(
      out.includes(`## Topics (${listed})`),
      `expected \`## Topics (${listed})\`: four articles were handed over, one uncategorized`,
    );
    assert.ok(
      renderAgentBoot(placeB(), articlesB()).includes('## Topics (2)'),
      'expected `## Topics (2)` for a two-article corpus',
    );
  });

  test('one subheading per non-empty configured category, in config order, by title', () => {
    const out = renderAgentBoot(placeA(), articlesA());
    const headings = [...out.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    // Titles, not slugs: `### Guides`, never `### guides`. The slug is a routing
    // detail; the title is what the category is called.
    assert.deepEqual(headings, ['Guides', 'Harbor']);
  });

  test('a configured category with no articles is omitted entirely', () => {
    // An agent that fetched a category with nothing behind it wasted a request and
    // learned that the index lies.
    const out = renderAgentBoot(placeA(), articlesA());
    assert.equal(out.includes('Weather'), false, 'an empty category must not appear at all');
  });

  test('an article whose category is not configured is omitted', () => {
    const out = renderAgentBoot(placeA(), articlesA());
    assert.equal(out.includes('Orphan Note'), false, 'an unroutable article must not be listed');
    assert.equal(out.includes('/archive/'), false, 'nor may its urls appear');
  });

  test("each listed article's entry carries its title and both absolute urls", () => {
    // Both, because they answer different questions: `kb` is the raw markdown an
    // agent should fetch, `url` is the human page it should cite. Absolute, because
    // an agent reading this file through a cache or a paste has no origin to
    // resolve a site-root path against.
    const config = placeA();
    const origin = siteOrigin(config);
    const out = renderAgentBoot(config, articlesA());

    for (const item of articlesA().filter((a) => a.category !== 'archive')) {
      const entry = entryFor(out, item.title);
      assert.ok(
        entry.includes(`${origin}${item.kb}`),
        `${item.title} must carry its absolute kb url; entry was:\n${entry}`,
      );
      assert.ok(
        entry.includes(`${origin}${item.url}`),
        `${item.title} must carry its absolute page url; entry was:\n${entry}`,
      );
    }
  });

  test('each listed article labels which of its two urls is which', () => {
    // The entry is deliberately not one line. `llms.txt` is the compact listing and
    // already exists; what this file adds is being unambiguous to a machine, and a
    // topic carrying two urls that differ only in path shape is exactly where an
    // unlabeled listing gets read wrong -- a consumer citing the raw Markdown url to
    // a reader, or fetching the HTML page and parsing it. The labels are the contract;
    // the line count is not.
    const out = renderAgentBoot(placeA(), articlesA());
    const origin = siteOrigin(placeA());
    for (const item of articlesA().filter((a) => a.category !== 'archive')) {
      const entry = entryFor(out, item.title);
      const labelled = entry.split('\n').map((line) => line.trim());
      assert.ok(
        labelled.includes(`raw: ${origin}${item.kb}`),
        `${item.title} must label its raw url; entry was:\n${entry}`,
      );
      assert.ok(
        labelled.includes(`page: ${origin}${item.url}`),
        `${item.title} must label its page url; entry was:\n${entry}`,
      );
    }
  });

  test('articles keep their input order inside a category', () => {
    // The caller decides the order (the prebuild sorts by title); the renderer must
    // not impose a second, different one, or two surfaces built from one corpus
    // disagree about what "first" means.
    const out = renderAgentBoot(placeA(), articlesA());
    assert.ok(
      out.indexOf('Zephyr Guide') < out.indexOf('Alpha Guide'),
      'the renderer must preserve input order, not re-sort',
    );
  });
});

/* ------------------------------------------- renderAgentBoot: the MCP gate */

describe('renderAgentBoot MCP section', () => {
  const mcpOffButConfigured = () => ({ ...placeB(), features: { mcp: false, chat: true } });
  const mcpOnButUndeployed = () => ({ ...placeB(), workers: { chat: 'https://c.invalid' } });

  test('appears if and only if resolveMcp reports the surface enabled', () => {
    for (const make of [placeA, placeB, placeLegacy, mcpOffButConfigured, mcpOnButUndeployed]) {
      const config = make();
      const out = renderAgentBoot(config, []);
      assert.equal(
        out.includes('## Remote MCP endpoint'),
        resolveMcp(config).enabled,
        'the MCP section must track the shared both-halves gate, not features.mcp alone',
      );
    }
  });

  test('when present it names the resolved endpoint and all four tools', () => {
    const config = placeB();
    const out = renderAgentBoot(config, articlesB());
    assert.ok(out.includes(config.workers.mcp), 'the section must name the resolved endpoint');
    for (const tool of ['list_topics', 'get_article', 'search', 'semantic_search']) {
      assert.ok(out.includes(tool), `the section must name the ${tool} tool`);
    }
  });

  test('when the gate is off the string MCP appears nowhere (DoD 3)', () => {
    // Not just the heading: a leftover sentence about an endpoint this instance
    // does not serve is exactly the dangling section DoD 3 forbids.
    for (const make of [placeA, placeLegacy, mcpOffButConfigured, mcpOnButUndeployed]) {
      const out = renderAgentBoot(make(), articlesA());
      assert.equal(out.includes('MCP'), false, 'a gated-off build must not mention MCP at all');
    }
  });

  test('a config predating both keys renders instead of throwing', () => {
    // Absent-safety is a SPEC invariant: an instance upgrades and rebuilds without
    // editing its config first, so a missing key is off, never an exception.
    const out = renderAgentBoot(placeLegacy(), [article('Alpha', 'alpha', 'guides')]);
    assert.match(out, /^# Third Sample\.invalid\n/);
  });
});

/* --------------------------------- renderAgentBoot: closure, encoding, purity */

describe('renderAgentBoot url closure and encoding', () => {
  test('every url is the site origin, the source repo, or the MCP endpoint', () => {
    // A boot file is read by something that will follow what it finds. Anything
    // outbound that is not this instance's own identity is a link an agent was
    // told to trust on this instance's behalf.
    for (const make of [placeA, placeB, placeLegacy]) {
      const config = make();
      const origin = siteOrigin(config);
      const endpoint = resolveMcp(config).endpoint;
      const articles = make === placeB ? articlesB() : articlesA();
      for (const url of urlsIn(renderAgentBoot(config, articles))) {
        const known =
          url === origin ||
          url.startsWith(`${origin}/`) ||
          url === config.links.repo ||
          (resolveMcp(config).enabled && url === endpoint);
        assert.ok(known, `unexpected outbound url in the boot file: ${url}`);
      }
    }
  });

  test('the output ends with exactly one trailing newline', () => {
    const out = renderAgentBoot(placeA(), articlesA());
    assert.ok(out.endsWith('\n'), 'a text file must end with a newline');
    assert.equal(out.endsWith('\n\n'), false, 'exactly one, so the bytes are stable');
  });
});

describe('renderAgentBoot purity (DoD 1)', () => {
  test('identical inputs produce identical bytes', () => {
    assert.equal(renderAgentBoot(placeA(), articlesA()), renderAgentBoot(placeA(), articlesA()));
  });

  test('no place string survives from one config into another config output', () => {
    // The DoD 1 property, stated as a leak test: render two places that share no
    // word, and neither output may carry a token of the other. A hardcoded place
    // string, a cached module-level value, or a read of the real place.config.ts
    // all fail here, and nothing else does.
    const a = renderAgentBoot(placeA(), articlesA());
    const b = renderAgentBoot(placeB(), articlesB());

    const tokensOf = (config, articles) => [
      config.place.name,
      config.place.tagline,
      config.place.domain,
      config.links.repo,
      ...config.categories.map((c) => c.title),
      ...articles.map((x) => x.title),
    ];

    for (const token of tokensOf(placeA(), articlesA().filter((x) => x.category !== 'archive'))) {
      assert.equal(b.includes(token), false, `place A's "${token}" leaked into place B's boot file`);
    }
    for (const token of tokensOf(placeB(), articlesB())) {
      assert.equal(a.includes(token), false, `place B's "${token}" leaked into place A's boot file`);
      // ... and the same tokens are present where they belong, so the loop above
      // cannot pass by rendering nothing at all.
      assert.ok(b.includes(token), `place B's "${token}" is missing from its own boot file`);
    }
  });
});

/* ---------------------------------------------------------------- aiPaths */

describe('aiPaths', () => {
  const ids = (config) => aiPaths(config).map((p) => p.id);

  const config = ({ mcp = false, chat = false, mcpUrl = '', chatUrl = '' } = {}) => ({
    features: { mcp, chat },
    workers: { mcp: mcpUrl, chat: chatUrl },
  });

  const MCP_URL = 'https://mcp.example.invalid';
  const CHAT_URL = 'https://chat.example.invalid';

  test('the static protocol is always served, in D4 order', () => {
    // `/llms.txt` and `/kb/` cost no infrastructure and need no flag, which is why
    // the SPEC calls them primary and why they lead the page.
    assert.deepEqual(ids(config()), ['llms', 'kb']);
  });

  test('MCP off and chat on yields exactly the three remaining paths (DoD 3)', () => {
    // The load-bearing DoD 3 case: with the MCP worker undeployed the page still
    // documents three real paths and offers no fourth.
    assert.deepEqual(ids(config({ chat: true, chatUrl: CHAT_URL })), ['llms', 'kb', 'chat']);
  });

  test('MCP on and chat off yields llms, kb, mcp', () => {
    assert.deepEqual(ids(config({ mcp: true, mcpUrl: MCP_URL })), ['llms', 'kb', 'mcp']);
  });

  test('both workers on yields all four, MCP before chat', () => {
    // D4: the static paths first, then MCP, then chat. Order is the page's whole
    // recommendation, so it is asserted rather than treated as presentation.
    assert.deepEqual(
      ids(config({ mcp: true, mcpUrl: MCP_URL, chat: true, chatUrl: CHAT_URL })),
      ['llms', 'kb', 'mcp', 'chat'],
    );
  });

  test('each gate needs both halves', () => {
    // A flag on without a deployed worker points readers and agents at a url that
    // refuses every connection; an endpoint configured while the flag is off is a
    // deliberate "not yet".
    assert.deepEqual(ids(config({ mcp: true })), ['llms', 'kb']);
    assert.deepEqual(ids(config({ mcpUrl: MCP_URL })), ['llms', 'kb']);
    assert.deepEqual(ids(config({ chat: true })), ['llms', 'kb']);
    assert.deepEqual(ids(config({ chatUrl: CHAT_URL })), ['llms', 'kb']);
  });

  test('a config predating either feature key resolves instead of throwing', () => {
    assert.deepEqual(ids({}), ['llms', 'kb']);
    assert.deepEqual(ids({ features: {} }), ['llms', 'kb']);
    assert.deepEqual(ids({ workers: {} }), ['llms', 'kb']);
  });

  test('only the MCP path is external, and its href is the resolved endpoint', () => {
    // `external` drives how a link is rendered; getting it wrong on a site-root
    // path produces a link that leaves the site for nowhere.
    const paths = aiPaths(config({ mcp: true, mcpUrl: MCP_URL, chat: true, chatUrl: CHAT_URL }));
    const byId = Object.fromEntries(paths.map((p) => [p.id, p]));

    assert.equal(byId.llms.href, KB_PATHS.llmsTxt);
    // The topic index, because it is where a consumer of the fetch protocol starts:
    // the other two `/kb/` endpoints are reached from what it lists.
    assert.equal(byId.kb.href, KB_PATHS.topics);
    assert.equal(byId.chat.href, '/chat');
    assert.equal(byId.mcp.href, MCP_URL);

    assert.deepEqual(
      paths.filter((p) => p.external).map((p) => p.id),
      ['mcp'],
      'only the MCP endpoint lives off this origin',
    );
  });
});

/* -------------------------------------------- the prebuild emit (DoD 1) */

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The place.config.ts source for a disposable instance. */
function configSource(config) {
  return `export interface PlaceConfig {
  place: {
    name: string;
    brandSuffix?: string;
    tagline: string;
    domain: string;
    locale: string;
    languages: string[];
  };
  categories: Array<{ slug: string; title: string; icon: string; description: string }>;
  features: Record<string, boolean>;
  links: { repo: string; email: string; social: Record<string, string> };
  workers?: Record<string, string>;
}
const config: PlaceConfig = ${JSON.stringify(config, null, 2)};
export default config;
`;
}

/**
 * A miniature instance the prebuild can run against: its own place.config.ts, its
 * own knowledge/ tree, and a copy of src/lib/ so the script's imports resolve
 * inside the fixture rather than reaching back into this repository's config.
 *
 * `articles` are given as `<Category Title>/<file>.md`, because that is the layout
 * the scanner reads -- a knowledge directory is named for the category's TITLE
 * while its route carries the SLUG. A fixture that named the directories after the
 * slugs could not tell a reader that confused the two.
 */
function makeInstance(config, articles) {
  const root = mkdtempSync(join(tmpdir(), 'agent-boot-'));
  roots.push(root);

  writeFileSync(join(root, 'place.config.ts'), configSource(config), 'utf8');

  mkdirSync(join(root, 'src'), { recursive: true });
  cpSync(join(REPO, 'src/lib'), join(root, 'src/lib'), { recursive: true });
  // The script imports gray-matter; resolution walks up from the fixture, so it
  // needs this repository's installed dependencies.
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));

  for (const [dir, file, title] of articles) {
    mkdirSync(join(root, 'knowledge', dir), { recursive: true });
    writeFileSync(
      join(root, 'knowledge', dir, file),
      `---\ntitle: ${title}\ndescription: About ${title}.\n---\n\nBody text.\n`,
      'utf8',
    );
  }
  return root;
}

/** Runs the prebuild exactly as `npm run prebuild:kb-index` does. */
function runKbIndex(root) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(REPO, 'scripts/core/build-kb-index.mjs')],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `build-kb-index.mjs exited ${result.status}: ${result.stderr}`);
  return {
    agentBoot: existsSync(join(root, 'public/kb/agent.md'))
      ? readFileSync(join(root, 'public/kb/agent.md'), 'utf8')
      : null,
    llmsTxt: readFileSync(join(root, 'public/llms.txt'), 'utf8'),
  };
}

const FIXTURE_CONFIG = {
  place: {
    name: 'Example Basin',
    brandSuffix: '-notes',
    tagline: 'A synthetic place that exists only inside this test file.',
    domain: 'kb.example.test',
    locale: 'en',
    languages: ['en'],
  },
  categories: [
    { slug: 'guides', title: 'Guides', icon: 'X', description: 'Guides articles.' },
    { slug: 'harbor', title: 'Harbor', icon: 'X', description: 'Harbor articles.' },
    { slug: 'weather', title: 'Weather', icon: 'X', description: 'Weather articles.' },
  ],
  features: { mcp: false, chat: false },
  links: {
    repo: 'https://code.example.test/example-basin',
    email: 'hello@kb.example.test',
    social: {},
  },
  workers: {},
};

const FIXTURE_ARTICLES = [
  ['Guides', 'zephyr-guide.md', 'Zephyr Guide'],
  ['Guides', 'alpha-guide.md', 'Alpha Guide'],
  ['Harbor', 'north-dock.md', 'North Dock'],
];

describe('the prebuild emits /kb/agent.md and links it from llms.txt (DoD 1)', () => {
  test('build-kb-index.mjs writes public/kb/agent.md', () => {
    const { agentBoot } = runKbIndex(makeInstance(FIXTURE_CONFIG, FIXTURE_ARTICLES));
    assert.ok(agentBoot, 'the prebuild must write public/kb/agent.md');
  });

  test('the emitted file is exactly renderAgentBoot over the scanned corpus', () => {
    // Byte equality, so the prebuild cannot grow a second, drifting copy of the
    // boot file's wording. The expected article list is the scan sorted by title,
    // which is the order the same script already gives topics.json and llms.txt.
    const root = makeInstance(FIXTURE_CONFIG, FIXTURE_ARTICLES);
    const { agentBoot } = runKbIndex(root);

    const expectedArticles = FIXTURE_ARTICLES.map(([dir, file, title]) => {
      const slug = file.replace(/\.md$/, '');
      const cat = FIXTURE_CONFIG.categories.find((c) => c.title === dir).slug;
      return {
        title,
        description: `About ${title}.`,
        category: cat,
        url: `/${cat}/${slug}`,
        kb: `/kb/articles/${cat}/${slug}.md`,
      };
    }).sort((a, b) => a.title.localeCompare(b.title, 'en'));

    assert.equal(agentBoot, renderAgentBoot(FIXTURE_CONFIG, expectedArticles));
  });

  test('llms.txt links the boot file absolutely, inside its machine endpoints block', () => {
    // llms.txt is the entry point an agent finds first; a boot file it does not
    // link is a file nothing will ever fetch. The link belongs with the other
    // machine endpoints, not buried under the article list.
    const { llmsTxt } = runKbIndex(makeInstance(FIXTURE_CONFIG, FIXTURE_ARTICLES));
    const url = `https://${FIXTURE_CONFIG.place.domain}${KB_PATHS.agentBoot}`;

    const at = llmsTxt.indexOf(url);
    assert.notEqual(at, -1, `llms.txt must name ${url}`);
    assert.ok(
      llmsTxt.indexOf('## Machine endpoints') < at && at < llmsTxt.indexOf('## Articles ('),
      'the agent.md link must sit in the machine endpoints block',
    );
  });

  test('every place string in both outputs comes from the fixture config (DoD 1)', () => {
    // The reason this case builds its own instance: run against this repository's
    // own corpus, and the template's demo strings would satisfy every assertion
    // above while proving nothing about where they came from.
    const { agentBoot, llmsTxt } = runKbIndex(makeInstance(FIXTURE_CONFIG, FIXTURE_ARTICLES));

    for (const output of [agentBoot, llmsTxt]) {
      for (const token of [
        realPlaceConfig.place.name,
        realPlaceConfig.place.domain,
        realPlaceConfig.place.tagline,
        realPlaceConfig.links.repo,
      ]) {
        assert.equal(
          output.includes(token),
          false,
          `a string from this repository's own place.config.ts reached a fixture build: ${token}`,
        );
      }
      assert.ok(
        output.includes(FIXTURE_CONFIG.place.domain),
        'the fixture domain must appear in the output built from the fixture config',
      );
    }
  });
});
