// robots.txt — crawl policy plus the Sitemap: directive that points crawlers at
// the sitemap @astrojs/sitemap emits. Built as a route rather than a static
// public/ file so the host comes from place.config.ts and is never hardcoded.
//
// `context.site` is `https://${place.domain}` (astro.config.ts). The fallback
// reads the same key directly, so an invocation without a configured site still
// produces an absolute URL rather than a relative one a crawler ignores.
import type { APIContext } from 'astro';
import placeConfig from '../../place.config';

export function GET(context: APIContext) {
  const origin = (context.site?.href ?? `https://${placeConfig.place.domain}/`).replace(/\/+$/, '');

  const body = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
