/**
 * agent-boot.ts — the `/kb/agent.md` boot file, rendered from a place config.
 *
 * `llms.txt` tells a browsing AI what articles exist. This file tells it what to DO:
 * who published this corpus, which endpoints answer which question, and in what order
 * to fetch them so it reads one index and then only the articles it needs. The two are
 * complementary rather than redundant -- llms.txt follows a convention whose shape is
 * fixed by llmstxt.org, and the fetch protocol this site actually implements does not
 * fit inside it.
 *
 * PURE, and deliberately so: it takes a config and an article list and returns a
 * string. Nothing here reads the filesystem, so the same inputs always produce the same
 * bytes and a test can render a synthetic place without a repository behind it. The
 * caller that owns the disk is `scripts/core/build-kb-index.mjs`, which already scans
 * `knowledge/` once for `topics.json` and llms.txt and hands the same scan here.
 *
 * URL CLOSURE is the property that lets `npm run postbuild:internal-links` check this
 * file at all: every URL rendered here is either this site's own origin, the configured
 * repository, or the configured MCP endpoint. There is no fourth kind, so a URL that is
 * none of those is a defect the post-build check can name rather than an outbound link
 * it has to guess about. Keep it that way -- a convention link or a vendor doc URL added
 * here would have to teach that checker a new class.
 *
 * This file lives under src/, which both machine gates scan: its source is pure ASCII
 * and carries no place-specific string.
 */
import type { PlaceConfig } from '../../place.config';
// Explicit `.ts`, because this module is imported by plain-Node callers
// (scripts/core/build-kb-index.mjs, scripts/core/check-internal-links.mjs) whose
// resolver requires the extension. Every .mjs caller of src/lib/ already spells it
// this way; only the type-only import above is erased before resolution.
import { resolveMcp } from './mcp.ts';

/**
 * Site-root-absolute paths of the static AI protocol this build publishes. Both the
 * boot file and the `/ai` page render from these, so the page cannot document an
 * endpoint the build does not emit.
 */
export const KB_PATHS = {
  llmsTxt: '/llms.txt',
  agentBoot: '/kb/agent.md',
  topics: '/kb/topics.json',
  searchIndex: '/kb/search-index.json',
  /** A URL TEMPLATE, not a resolvable path: it carries `{category}` and `{slug}`. */
  articleTemplate: '/kb/articles/{category}/{slug}.md',
} as const;

/** The four tools `workers/mcp/` exposes, in the order its own tool list returns them. */
export const MCP_TOOLS = ['list_topics', 'get_article', 'search', 'semantic_search'] as const;

/** The article fields the boot file's topic index renders. */
export interface AgentBootArticle {
  title: string;
  description: string;
  /** Category slug, matched against `config.categories[].slug`. */
  category: string;
  /** Site-root-absolute reader page, `/{category}/{slug}`. */
  url: string;
  /** Site-root-absolute raw markdown, `/kb/articles/{category}/{slug}.md`. */
  kb: string;
}

/** `https://{place.domain}`, never with a trailing slash. */
export function siteOrigin(config: PlaceConfig): string {
  return `https://${config.place.domain}`;
}

/**
 * The brand as a reader sees it in the header and footer: `place.name` plus
 * `place.brandSuffix`, falling back to the domain's last label when no suffix is
 * declared. Mirrors `BrandMark.astro` and `Footer.astro` rather than inventing a third
 * spelling of the same identity.
 */
export function brandName(config: PlaceConfig): string {
  const { name, brandSuffix, domain } = config.place;
  return `${name}${brandSuffix ?? `.${domain.split('.').pop()}`}`;
}

/**
 * The `/kb/agent.md` body for this place.
 *
 * The order is the D4 order the `/ai` page also uses: the static protocol first,
 * because it serves any consumer able to fetch a URL at zero infrastructure cost, and
 * the MCP endpoint second, for what the static protocol cannot do. An instance with no
 * MCP endpoint renders no MCP section at all rather than a section saying it has none:
 * this file is read by machines, and a documented capability that does not exist is a
 * request they will make and a failure they will report.
 */
export function renderAgentBoot(config: PlaceConfig, articles: AgentBootArticle[]): string {
  const site = siteOrigin(config);
  const mcp = resolveMcp(config);
  const url = (path: string) => `${site}${path}`;

  // Categories in config order; only those with articles are rendered. A configured
  // category with nothing in it yet is a fact about the site, but not one an agent can
  // act on, and an empty heading reads to a machine as a fetch target that returns
  // nothing.
  const byCategory = new Map<string, AgentBootArticle[]>(
    config.categories.map((category) => [category.slug, []]),
  );
  for (const article of articles) byCategory.get(article.category)?.push(article);
  const listed = config.categories.flatMap((category) => byCategory.get(category.slug) ?? []);

  const lines: string[] = [];

  lines.push(`# ${brandName(config)}`);
  lines.push('');
  lines.push(`> ${config.place.tagline}`);
  lines.push(`> Website: ${site}`);
  lines.push(`> Source: ${config.links.repo}`);
  lines.push('');
  lines.push(
    'You are reading the agent boot file for this knowledge base. It states what is',
  );
  lines.push(
    'published here and how to read it, so that one fetch of this file is enough to use',
  );
  lines.push('everything below without crawling the site.');
  lines.push('');

  lines.push('## How to read this knowledge base');
  lines.push('');
  lines.push(
    '1. Fetch the topic index and decide from it what you need. It carries every',
  );
  lines.push('   article: title, description, category, tags, and reading time.');
  lines.push('');
  lines.push(`   ${url(KB_PATHS.topics)}`);
  lines.push('');
  lines.push('2. Fetch only those articles, as raw Markdown, one request each. Nothing');
  lines.push('   is paginated and nothing needs a key.');
  lines.push('');
  lines.push(`   ${url(KB_PATHS.articleTemplate)}`);
  lines.push('');
  lines.push('3. To match words rather than browse, fetch the prebuilt keyword index');
  lines.push('   instead of requesting every article.');
  lines.push('');
  lines.push(`   ${url(KB_PATHS.searchIndex)}`);
  lines.push('');
  lines.push('4. Every article also has a human page. Cite that URL, not the raw file,');
  lines.push('   when you show a reader where an answer came from.');
  lines.push('');
  lines.push(`   ${url(KB_PATHS.llmsTxt)} lists the same corpus in the llms.txt convention.`);
  lines.push('');

  // Second, and only when this instance runs one. See the file header on URL closure:
  // `resolveMcp` is the absent-safe read of both halves, so a config predating either
  // key renders nothing here rather than advertising an endpoint that refuses.
  if (mcp.enabled) {
    lines.push('## Remote MCP endpoint');
    lines.push('');
    lines.push('If you cannot fetch arbitrary URLs, or you want retrieval by meaning');
    lines.push('rather than by word, register this Streamable HTTP endpoint instead:');
    lines.push('');
    lines.push(`   ${mcp.endpoint}`);
    lines.push('');
    lines.push(`Tools: ${MCP_TOOLS.join(', ')}. The first three re-serve the files above;`);
    lines.push('semantic_search is the one thing the static protocol cannot do.');
    lines.push('');
  }

  lines.push(`## Topics (${listed.length})`);
  lines.push('');
  for (const category of config.categories) {
    const inCategory = byCategory.get(category.slug) ?? [];
    if (inCategory.length === 0) continue;
    lines.push(`### ${category.title}`);
    lines.push('');
    for (const article of inCategory) {
      const description = article.description ? `: ${article.description}` : '';
      lines.push(`- ${article.title}${description}`);
      lines.push(`  raw: ${url(article.kb)}`);
      lines.push(`  page: ${url(article.url)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
