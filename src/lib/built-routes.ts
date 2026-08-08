/**
 * built-routes.ts — the routes an `astro build` of this instance produces.
 *
 * Two pages validate a `knowledge/` manifest's declared `article` link against the
 * built route set before rendering it: `/soundscape` (a category's `article`) and
 * `/chat` (a context's `article`). Both need the same answer, and the answer is a
 * restatement of what `src/pages/[category]/[slug].astro`'s `getStaticPaths` filter
 * does — so it lives in one place rather than being derived twice and drifting the
 * first time the route rules change.
 *
 * The collection is passed in rather than fetched here: `getCollection` is an
 * `astro:content` import that only resolves inside the Astro build, and keeping it
 * out means this module is readable — and testable — as plain Node.
 *
 * This file lives under src/, which both machine gates scan: its source is pure
 * ASCII and carries no place-specific string.
 */
import { readdirSync } from 'node:fs';

import type { PlaceConfig } from '../../place.config';

/** The one field of a content-collection entry this needs: `<category>/<name>.md`. */
export interface CollectionEntryId {
  id: string;
}

/**
 * Every site-root-absolute route this build produces:
 *
 *   - the file-based static pages under `src/pages/` (dynamic `[...]` routes
 *     excluded — they are the article routes, derived below from the collection);
 *   - one hub per configured category;
 *   - one article route per collection entry whose category is configured, which is
 *     the same filter `src/pages/[category]/[slug].astro` applies in
 *     `getStaticPaths`. An article in a directory that is not a configured category
 *     has no page, so a link to it would be a 404.
 */
export function builtRoutes(
  config: PlaceConfig,
  collection: CollectionEntryId[],
  pagesDir = 'src/pages',
): string[] {
  const categorySlugs = new Set(config.categories.map((category) => category.slug));

  const staticRoutes = readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro') && !entry.name.startsWith('['))
    .map((entry) => entry.name.replace(/\.astro$/, ''))
    .map((name) => (name === 'index' ? '/' : `/${name}`));

  const hubRoutes = [...categorySlugs].map((slug) => `/${slug}`);

  const articleRoutes = collection
    .map((article) => {
      const parts = article.id.split('/');
      if (parts.length < 2) return null;
      return `/${parts[0]}/${parts.slice(1).join('/').replace(/\.md$/, '')}`;
    })
    .filter((route): route is string => route !== null && categorySlugs.has(route.split('/')[1]));

  return [...staticRoutes, ...hubRoutes, ...articleRoutes];
}
