/**
 * post-build-check.mjs — post-build smoke test.
 *
 * Catches silent build collapse (getStaticPaths returning 0 paths, empty catch
 * swallowing errors, a category hub rendering a placeholder instead of its cards)
 * and silent absence of the crawl-discovery artifacts (`sitemap-index.xml`,
 * `robots.txt`), which the framework advertises and no doc gate can derive.
 * Exit code 1 = CI must NOT deploy.
 *
 * Categories flow from place.config.ts (genericity gate). Scaled for any corpus
 * size: it does NOT require every category to be populated (false at fixture
 * scale) — it verifies the build produced the expected structural surfaces and
 * that populated categories actually render article cards.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const placeConfig = (await import(resolve(ROOT, 'place.config.ts'))).default;
const DIST = resolve(ROOT, 'dist');
const CATEGORIES = placeConfig.categories.map((c) => c.slug);

// Floor scales with the category set; below it, getStaticPaths likely collapsed.
const MIN_TOTAL_PAGES = CATEGORIES.length + 3;

const errors = [];
const warnings = [];

async function countHtml(dir) {
  let count = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) count += await countHtml(full);
      else if (entry.name.endsWith('.html')) count++;
    }
  } catch {}
  return count;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ── 1. Total pages above collapse floor ──
const totalPages = await countHtml(DIST);
console.log(`📊 Total HTML pages: ${totalPages}`);
if (totalPages < MIN_TOTAL_PAGES) {
  errors.push(
    `Total pages (${totalPages}) below floor (${MIN_TOTAL_PAGES}). Likely a getStaticPaths failure.`,
  );
}

// ── 2. Structural surfaces this task and the shell must produce ──
const REQUIRED = [
  ['home page', 'index.html'],
  ['explore page', 'explore/index.html'],
  ['latest page', 'latest/index.html'],
  ['ai page', 'ai/index.html'],
  ['404 page', '404.html'],
  ['sitemap index', 'sitemap-index.xml'],
  ['robots.txt', 'robots.txt'],
];
for (const [label, rel] of REQUIRED) {
  if (!(await exists(join(DIST, rel)))) errors.push(`missing ${label} (dist/${rel})`);
}

// ── 2a. robots.txt points crawlers at the sitemap this build emitted ──
// The framework advertises both artifacts (`/about` copy, DEPLOY.md's `place.domain`
// claim) and they were promised for a long time before they existed. Neither has a
// prose source a doc gate can derive, so this is their guard: a missing file above, or
// a `Sitemap:` host that drifted from place.config.ts, blocks the deploy. The host
// comparison is what makes the "never a hardcoded host" property mechanical — an
// instance that sets its own `place.domain` gets a robots.txt naming that domain or a
// red build, not a silently wrong directive pointing at someone else's site.
//
// The host comparison is case-insensitive because the two sides normalize differently:
// `new URL(...).host` lowercases per WHATWG, while the init wizard's `place.domain`
// validator (`scripts/init/prompt-table.mjs`) accepts mixed case. An adopter who
// answered `Example.Com` would otherwise fail every build on a message that reads like
// a real mismatch. The error text still prints `place.domain` as written.
//
// The last check derives the `dist/` path from the directive itself rather than from a
// second `sitemap-index.xml` literal: the entry in REQUIRED above proves the build
// emitted a sitemap index (DoD 5), and this proves robots.txt points at a file this
// build actually wrote. A renamed route or a `sitemap({ filenameBase })` that made the
// two disagree would send every crawler to a 404 while both halves still passed.
const robotsPath = join(DIST, 'robots.txt');
if (await exists(robotsPath)) {
  const robots = await readFile(robotsPath, 'utf-8');
  const sitemapDirective = robots.match(/^Sitemap:[ \t]*(\S+)[ \t]*$/m);
  if (!sitemapDirective) {
    errors.push('dist/robots.txt carries no `Sitemap:` directive');
  } else {
    let sitemapUrl = null;
    try {
      sitemapUrl = new URL(sitemapDirective[1]);
    } catch {}
    let targetIsFile = false;
    if (sitemapUrl !== null) {
      try {
        targetIsFile = (await stat(join(DIST, sitemapUrl.pathname))).isFile();
      } catch {}
    }
    if (sitemapUrl === null) {
      errors.push(
        `dist/robots.txt \`Sitemap: ${sitemapDirective[1]}\` is not an absolute URL; ` +
          'a relative sitemap directive is ignored by crawlers',
      );
    } else if (sitemapUrl.host !== placeConfig.place.domain.toLowerCase()) {
      errors.push(
        `dist/robots.txt points at sitemap host ${sitemapUrl.host}, ` +
          `but place.config.ts declares ${placeConfig.place.domain}`,
      );
    } else if (!targetIsFile) {
      errors.push(
        `dist/robots.txt points at ${sitemapUrl.pathname}, ` +
          `but this build emitted no file at dist${sitemapUrl.pathname}`,
      );
    } else {
      console.log(`  ✅ robots.txt: Sitemap: directive on ${sitemapUrl.host}${sitemapUrl.pathname}`);
    }
  }
}

// ── 2b. /ai documents exactly the paths this instance serves ──
// The page renders one `data-ai-path` section per `aiPaths()` entry, so this compares
// the built page against the config rather than against a hardcoded list. It is what
// makes "no dangling MCP section" a build-time fact: an instance with `features.mcp`
// off publishes an /ai page with no MCP section AND no MCP content, and an instance
// that turns the flag on without deploying the worker gets the same answer, because
// the gate is both halves. A section for a path the instance does not serve, or a
// missing section for one it does, blocks the deploy.
const { aiPaths } = await import(resolve(ROOT, 'src/lib/ai-paths.ts'));
const expectedPaths = aiPaths(placeConfig).map((path) => path.id);
const aiPage = join(DIST, 'ai', 'index.html');
if (await exists(aiPage)) {
  const html = await readFile(aiPage, 'utf-8');
  const rendered = [...html.matchAll(/data-ai-path="([a-z]+)"/g)].map((match) => match[1]);
  if (rendered.join(',') !== expectedPaths.join(',')) {
    errors.push(
      `/ai documents [${rendered.join(', ')}] but this config serves [${expectedPaths.join(', ')}]`,
    );
  }
  console.log(`  ✅ /ai: ${rendered.length} AI consumption path(s) documented`);
}

// ── 3. Every configured category has a hub; populated ones render cards ──
for (const cat of CATEGORIES) {
  const catDir = join(DIST, cat);
  const indexPath = join(catDir, 'index.html');
  if (!(await exists(indexPath))) {
    errors.push(`/${cat}/ hub missing in dist/`);
    continue;
  }
  let articleDirs = [];
  try {
    articleDirs = (await readdir(catDir, { withFileTypes: true })).filter(
      (e) => e.isDirectory() && e.name !== 'index',
    );
  } catch {}
  if (articleDirs.length === 0) {
    console.log(`  · /${cat}/: hub only (no articles at this corpus size)`);
    continue;
  }
  // Populated category: hub must show article cards, and a sample article must be real.
  const html = await readFile(indexPath, 'utf-8');
  if (!html.includes('article-card') && !html.includes('articlesGrid')) {
    errors.push(`/${cat}/index.html has articles on disk but renders no article cards`);
  }
  const sampleHtml = join(catDir, articleDirs[0].name, 'index.html');
  if (await exists(sampleHtml)) {
    const s = await stat(sampleHtml);
    if (s.size < 1024) {
      warnings.push(`/${cat}/${articleDirs[0].name}/index.html suspiciously small (${s.size}B)`);
    }
  }
  console.log(`  ✅ /${cat}/: ${articleDirs.length} article(s)`);
}

// ── Report ──
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  warnings.forEach((w) => console.log(`   - ${w}`));
}
if (errors.length) {
  console.log(`\n🔴 ${errors.length} error(s):`);
  errors.forEach((e) => console.log(`   - ${e}`));
  console.log('\n❌ Post-build check FAILED. Deploy blocked.');
  process.exit(1);
}
console.log(`\n✅ Post-build check passed. ${totalPages} pages, all surfaces present.`);
