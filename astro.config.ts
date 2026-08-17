import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import remarkWikilinks from './plugins/remark-wikilinks.mjs';
import placeConfig from './place.config';

export default defineConfig({
  site: `https://${placeConfig.place.domain}`,
  // No `filter` is needed for the exclusion set this framework wants. The
  // integration collects only routes Astro typed `page`, so the endpoints
  // (`feed.xml`, `robots.txt`, `rss.xml`) never enter the URL set; `404` is
  // dropped by the integration's own status-page rule; and `/kb/*` plus
  // `llms.txt` are static assets `build-kb-index.mjs` writes into `public/`,
  // not routes. A filter listing entries that are already absent would be a
  // rule nothing exercises.
  integrations: [sitemap()],
  markdown: {
    processor: unified({
      remarkPlugins: [
        [remarkWikilinks, { categories: placeConfig.categories }],
      ],
    }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
