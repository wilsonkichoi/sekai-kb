import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import remarkWikilinks from './plugins/remark-wikilinks.mjs';
import placeConfig from './place.config';
import { unadvertisedPaths } from './src/lib/feature-pages';

// The pages this build produces but does not advertise, resolved once rather than
// per URL. See src/lib/feature-pages.ts: an always-built page whose feature is off
// renders a "not enabled here" state and carries no nav link, so submitting it to a
// crawler contradicts what the Header and Footer already decided about it.
const unadvertised = new Set(unadvertisedPaths(placeConfig));

export default defineConfig({
  site: `https://${placeConfig.place.domain}`,
  // The `filter` carries exactly one rule, the feature-gated pages above. Everything
  // else this framework wants excluded is already absent: the integration collects
  // only routes Astro typed `page`, so the endpoints (`feed.xml`, `robots.txt`,
  // `rss.xml`) never enter the URL set; `404` is dropped by the integration's own
  // status-page rule; and `/kb/*` plus `llms.txt` are static assets
  // `build-kb-index.mjs` writes into `public/`, not routes. Restating those here
  // would be a rule nothing exercises.
  integrations: [sitemap({ filter: (page) => !unadvertised.has(new URL(page).pathname) })],
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
