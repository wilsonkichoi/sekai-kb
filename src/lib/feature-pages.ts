/**
 * feature-pages.ts -- the pages this build produces but does not advertise.
 *
 * Five pages ALWAYS build, whatever `features` says: `/chat`, `/map`, `/graph`,
 * `/soundscape`, and `/dashboard`. The flag decides which of two states each one
 * renders, live or "not enabled here", and that decision happens inside the template
 * at render time. It leaves no trace in the route table or in `dist/`, so nothing
 * downstream can infer it from the build output: a disabled page is a real page with
 * real HTML at a real URL.
 *
 * The Header and Footer already act on this knowledge by omitting the nav link, on the
 * reasoning `chat.template.astro` states -- a link to a page that says "not enabled
 * here" is worse than no link. The sitemap is the crawler's version of that nav link
 * and needs the same answer, so the mapping from page to flag lives here once rather
 * than being spelled out again in `astro.config.ts`.
 *
 * Absent-safe (iron rule 4): every flag is compared with `=== true`, so a config
 * written before a key existed reads as off, and the page is withheld from the sitemap
 * rather than advertised on the strength of a missing value.
 *
 * This file lives under src/, which both machine gates scan: its source is pure ASCII
 * and carries no place-specific string.
 */
import type { PlaceConfig } from '../../place.config';
// Explicit `.ts`: scripts/core/post-build-check.mjs imports this module under plain
// Node, whose resolver requires the extension (see src/lib/ai-paths.ts).
import { resolveChat } from './chat.ts';

/**
 * Site-root-absolute paths, with the trailing slash Astro's built routes carry, for
 * every always-built feature page this config has switched off. An instance with every
 * feature on yields an empty array, and the sitemap then carries every rendered page.
 *
 * `/chat` resolves through `resolveChat` rather than reading `features.chat` directly,
 * because that surface's gate is both halves: the flag AND a configured endpoint.
 */
export function unadvertisedPaths(config: PlaceConfig): string[] {
  const paths: string[] = [];
  if (!resolveChat(config).enabled) paths.push('/chat/');
  if (config.features?.map !== true) paths.push('/map/');
  if (config.features?.graph !== true) paths.push('/graph/');
  if (config.features?.soundscape !== true) paths.push('/soundscape/');
  if (config.features?.dashboard !== true) paths.push('/dashboard/');
  return paths;
}
