/**
 * categoryConfig.ts — category metadata (colors, icons, descriptions).
 *
 * Derives from place.config.ts categories; adds display colors for the article
 * surface (hero tints, tag badges, sidebar accents). The fork hardcoded these;
 * here they derive from config so the genericity gate stays green.
 */
import placeConfig from '../../place.config';

export interface CategoryConfig {
  name: string;
  description: string;
  icon: string;
  color: string;
  colorLight: string;
}

const COLOR_PALETTE: Record<string, { color: string; colorLight: string }> = {
  history: { color: '#92400e', colorLight: '#f59e0b20' },
  beaches: { color: '#0284c7', colorLight: '#0284c720' },
  nature: { color: '#0e7490', colorLight: '#0e749020' },
  trails: { color: '#15803d', colorLight: '#15803d20' },
  food: { color: '#ea580c', colorLight: '#ea580c20' },
};

const DEFAULT_COLOR = { color: '#475569', colorLight: '#47556920' };

const configs: Record<string, CategoryConfig> = Object.fromEntries(
  placeConfig.categories.map((cat) => {
    const palette = COLOR_PALETTE[cat.slug] ?? DEFAULT_COLOR;
    return [
      cat.slug,
      {
        name: cat.title,
        description: cat.description,
        icon: cat.icon,
        ...palette,
      },
    ];
  }),
);

export type CategoryKey = string;

export const categoryList: string[] = placeConfig.categories.map((c) => c.slug);

export function getCategoryConfig(slug: string): CategoryConfig | undefined {
  return configs[slug];
}

export function getCategoryConfigs(): Record<string, CategoryConfig> {
  return configs;
}
