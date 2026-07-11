/**
 * place.config.ts — THE ingress for this instance's place identity.
 *
 * Everything place-specific (name, categories, map, feature toggles, SEO) lives
 * here. `src/` and `scripts/` stay generic and read from this file, so the Phase 5
 * framework cut ("sekai-kb") can strip this one file to re-place the whole site.
 * Init-time fields (place, categories, map) are written once by the `npm run init`
 * wizard; `features` and `languages` are runtime-toggleable. See SPEC.md
 * "place.config.ts" and .fable/STRATEGIC-DIRECTION.md §B.
 */

export interface PlaceConfig {
  place: {
    name: string;
    tagline: string;
    domain: string;
    locale: string;
    languages: string[];
  };
  /** 5-14 categories. slug/icon/description feed nav, hubs, and category pages. */
  categories: Array<{
    slug: string;
    title: string;
    icon: string;
    description: string;
  }>;
  /** Leaflet init: center [lat, lng], zoom, and maxBounds [[S,W],[N,E]]. */
  map: {
    center: [number, number];
    zoom: number;
    maxBounds: [[number, number], [number, number]];
  };
  features: {
    graph: boolean;
    map: boolean;
    dashboard: boolean;
    soundscape: boolean;
    feedback: boolean;
    chat: boolean;
    social: boolean;
    analytics: boolean;
  };
  /**
   * Outbound identity links. `repo` + `email` are always rendered (footer,
   * SEO sameAs/contactPoint, the "edit on GitHub" affordance). `social`
   * handles feed the footer social row and SEO sameAs, and render ONLY when
   * `features.social` is true. Handles include the leading `@`; component
   * code strips it when building platform URLs.
   * Added by task 1.1a (shell): §B's schema had no home for these; extending
   * it was Wilson's call (diverges from STRATEGIC-DIRECTION §B, tracked on LB-3).
   */
  links: {
    repo: string;
    email: string;
    social: {
      twitter?: string;
      threads?: string;
      instagram?: string;
    };
  };
  seo: {
    defaultOgImage: string;
    twitterHandle?: string;
  };
  home: {
    hero: {
      subtitle: string;
      description: string;
      highlight: string;
      cta: { explore: string; github: string };
    };
    stats: Array<{ icon: string; number: string; label: string }>;
    doors: Array<{
      icon: string;
      href: string;
      title: string;
      sub: string;
      tone: 'green' | 'blue' | 'amber' | 'plum';
    }>;
    coverStory: {
      heading: string;
      lead: string;
      quotes: Array<{
        era: string;
        quote: string;
        cite: string;
      }>;
      closing: string[];
      aboutLinkText: string;
    };
    randomDiscovery: {
      button: string;
      subtitle: string;
      description: string;
    };
    features: {
      title: string;
      cards: Array<{ icon: string; title: string; description: string }>;
      cta: { graph: string; ssot: string };
    };
    exhibitions: {
      heading: string;
      divider: string;
      halls: Array<{
        label: string;
        paragraphs: Array<{
          text: string;
          pillHref: string;
          pillIcon: string;
          pillLabel: string;
          categorySlug: string;
        }>;
      }>;
    };
    recentUpdates: {
      heading: string;
      subtitle: string;
      viewAll: string;
      latestLabel: string;
    };
    contribute: {
      heading: string;
      description: string;
      guideLabel: string;
      githubLabel: string;
    };
  };
}

const config: PlaceConfig = {
  place: {
    name: 'LagunaBeach',
    tagline:
      'Open-source, AI-friendly knowledge base about Laguna Beach, California.',
    domain: 'lagunabeach.md',
    locale: 'en',
    languages: ['en'],
  },
  categories: [
    {
      slug: 'history',
      title: 'History',
      icon: '📜',
      description:
        'Founding, indigenous peoples, artists colony, historical events',
    },
    {
      slug: 'art-galleries',
      title: 'Art & Galleries',
      icon: '🎨',
      description: 'Plein air painting, galleries, public art, art festivals',
    },
    {
      slug: 'nature-marine-life',
      title: 'Nature & Marine Life',
      icon: '🌊',
      description:
        'Tide pools, coastal ecology, marine protected areas, wildlife',
    },
    {
      slug: 'food',
      title: 'Food',
      icon: '🍽️',
      description: 'Restaurants, cafes, food history, local specialties',
    },
    {
      slug: 'beaches',
      title: 'Beaches',
      icon: '🏖️',
      description: 'Individual beaches, access, conditions, surfing',
    },
    {
      slug: 'trails',
      title: 'Trails',
      icon: '🥾',
      description: 'Hiking, coastal walks, trail conditions, views',
    },
    {
      slug: 'events-festivals',
      title: 'Events & Festivals',
      icon: '🎭',
      description:
        'Pageant of the Masters, Sawdust Art Festival, seasonal events',
    },
    {
      slug: 'neighborhoods',
      title: 'Neighborhoods',
      icon: '🏘️',
      description: 'Top of the World, Village, South Laguna, Canyon areas',
    },
  ],
  map: {
    center: [33.5427, -117.7854],
    zoom: 13,
    // City extent (SW → NE corners), keeps panning within Laguna Beach.
    maxBounds: [
      [33.48, -117.83],
      [33.61, -117.72],
    ],
  },
  features: {
    graph: true,
    map: true,
    dashboard: true,
    soundscape: false,
    feedback: false,
    chat: false,
    social: false,
    analytics: false,
  },
  links: {
    repo: 'https://github.com/wilsonkichoi/lagunabeach-md',
    email: 'hello@lagunabeach.md',
    social: {
      twitter: '@lagunabeachmd',
      threads: '@lagunabeachmd',
      instagram: '@lagunabeachmd',
    },
  },
  seo: {
    defaultOgImage: '/og-default.png',
    twitterHandle: '@lagunabeachmd',
  },
  home: {
    hero: {
      subtitle: 'Knowledge, curated.',
      description:
        'An open-source, AI-friendly knowledge base covering every facet of this coastal city, from tide pools to art festivals.',
      highlight: 'Sourced. Verified. Always evolving.',
      cta: { explore: 'Explore Topics', github: 'Star on GitHub' },
    },
    stats: [
      { icon: '🏝️', number: '7 mi', label: 'of coastline' },
      { icon: '🌿', number: '30+', label: 'coves & beaches' },
      { icon: '🎨', number: '100+', label: 'galleries' },
      { icon: '📚', number: '8', label: 'knowledge domains' },
    ],
    doors: [
      {
        icon: '🚪',
        href: '#cover-story',
        title: 'First time here?',
        sub: 'Start with the story',
        tone: 'green',
      },
      {
        icon: '🔍',
        href: '/explore',
        title: 'Search everything',
        sub: 'Full-text across all articles',
        tone: 'blue',
      },
      {
        icon: '🎲',
        href: '#random-discovery',
        title: 'Surprise me',
        sub: 'Random deep-dive article',
        tone: 'amber',
      },
      {
        icon: '📊',
        href: '/dashboard',
        title: 'Site health',
        sub: 'Freshness and coverage stats',
        tone: 'plum',
      },
    ],
    coverStory: {
      heading: 'The Story So Far',
      lead: 'Seven miles of coast. Thousands of years of history. One knowledge base to hold it all.',
      quotes: [
        {
          era: 'Pre-contact',
          quote:
            'The Acjachemen and Tongva peoples lived along these bluffs for millennia, shaping the land before any map named it.',
          cite: 'Archaeological record, Crystal Cove',
        },
        {
          era: '1904',
          quote:
            'Norman St. Claire built a shack on the bluffs and started painting. Within a decade, a colony of plein air artists followed.',
          cite: 'First Art Colony, historical record',
        },
        {
          era: '1927',
          quote:
            'The town incorporated specifically to block oil drilling. Conservation was the founding act, not an afterthought.',
          cite: 'City Charter, 1927',
        },
        {
          era: '1933',
          quote:
            'The Festival of Arts opened in a eucalyptus grove. Ninety years later, it still runs every summer.',
          cite: 'Festival of Arts archives',
        },
        {
          era: '1993',
          quote:
            'The firestorm destroyed 441 homes in a single afternoon. The city rebuilt without losing its character.',
          cite: 'Fire Department records',
        },
        {
          era: 'Today',
          quote:
            'An artist colony that became a city, still governed by the impulse to protect what makes it different.',
          cite: 'Contemporary observation',
        },
        {
          era: '.md',
          quote:
            'This knowledge base exists to document all of it: sourced, verified, and open for anyone to read or improve.',
          cite: 'Project mission statement',
        },
      ],
      closing: [
        'Every article in this knowledge base traces back to primary sources.',
        'The goal is not promotion. The goal is the most complete, accurate account of this place that exists anywhere.',
      ],
      aboutLinkText: 'Read the full story',
    },
    randomDiscovery: {
      button: 'Roll the dice',
      subtitle: 'Random deep-dive article',
      description:
        'Every article has footnotes. Some have dozens. Hit the button and land somewhere you did not expect.',
    },
    features: {
      title: 'What Makes This Different',
      cards: [
        {
          icon: '🎯',
          title: 'Curated, Not Scraped',
          description:
            'Every article is written and fact-checked by hand, not generated from search results.',
        },
        {
          icon: '🤖',
          title: 'AI-Friendly',
          description:
            'Structured endpoints at /kb/ and /llms.txt for LLM consumption. Built for machines and humans.',
        },
        {
          icon: '🔍',
          title: 'Source-Traced',
          description:
            'Footnotes cite primary sources. Claims link to evidence. Verification dates are visible.',
        },
        {
          icon: '📚',
          title: 'Comprehensive',
          description:
            'Eight domains covering the full spectrum: history, nature, art, food, beaches, trails, events, neighborhoods.',
        },
      ],
      cta: { graph: 'Explore the Knowledge Graph', ssot: 'View Raw Knowledge' },
    },
    exhibitions: {
      heading: 'Exhibition Halls',
      divider: 'All Categories',
      halls: [
        {
          label: 'I — The Coast',
          paragraphs: [
            {
              text: 'Seven miles of coastline, compressed between the Pacific and the San Joaquin Hills. Over 30 coves and beaches, each with a different character. Thousand Steps rewards the descent with tidepools and sea caves. Victoria Beach hides a pirate tower built in 1926.',
              pillHref: '/beaches',
              pillIcon: '🏖️',
              pillLabel: 'The beaches',
              categorySlug: 'beaches',
            },
            {
              text: 'Below the tideline, kelp forests shelter garibaldi, sea hares, and octopus. The Marine Protected Area off the coast is one of the most studied in California. Tide pools at Crystal Cove and Shaw\'s Cove hold creatures most aquariums can\'t replicate.',
              pillHref: '/nature-marine-life',
              pillIcon: '🌊',
              pillLabel: 'Nature & marine life',
              categorySlug: 'nature-marine-life',
            },
          ],
        },
        {
          label: 'II — The Story',
          paragraphs: [
            {
              text: 'The Acjachemen people lived here for thousands of years. Then ranchers, then plein air painters who arrived in the 1900s and never left. The town incorporated in 1927 specifically to prevent oil drilling. The 1993 firestorm destroyed 441 homes in a single afternoon.',
              pillHref: '/history',
              pillIcon: '📜',
              pillLabel: 'History',
              categorySlug: 'history',
            },
            {
              text: 'The painters stayed and multiplied. The Pageant of the Masters has recreated classical artworks with live actors since 1933. The Sawdust Art Festival fills a eucalyptus grove with working studios every summer. Over 100 galleries line the village streets.',
              pillHref: '/art-galleries',
              pillIcon: '🎨',
              pillLabel: 'Art & Galleries',
              categorySlug: 'art-galleries',
            },
          ],
        },
        {
          label: 'III — The Land',
          paragraphs: [
            {
              text: 'Behind the beach, 22,000 acres of protected wilderness. The Top of the World trail gives you the entire Orange County coast in a single glance. The wilderness park holds California gnatcatchers, bobcats, and the last coastal cactus scrub in the county.',
              pillHref: '/trails',
              pillIcon: '🥾',
              pillLabel: 'Trails',
              categorySlug: 'trails',
            },
            {
              text: 'Canyon neighborhoods climb the hillsides in narrow winding roads. Top of the World feels like a mountain village. The Village downtown is walkable galleries and restaurants along PCH. South areas keep an older, quieter character.',
              pillHref: '/neighborhoods',
              pillIcon: '🏘️',
              pillLabel: 'Neighborhoods',
              categorySlug: 'neighborhoods',
            },
          ],
        },
        {
          label: 'IV — The Life',
          paragraphs: [
            {
              text: 'The Pageant of the Masters, Sawdust Art Festival, Festival of Arts, all running since the 1930s. First Thursdays bring the village alive monthly. The Fourth of July parade has been uninterrupted since 1966.',
              pillHref: '/events-festivals',
              pillIcon: '🎭',
              pillLabel: 'Events & Festivals',
              categorySlug: 'events-festivals',
            },
            {
              text: 'The Cliff Restaurant has served the same ocean view since 1946. Taco Loco has been at the same corner since 1989. The food scene is not fast-casual chains, it is the kind of place where the owner remembers your order.',
              pillHref: '/food',
              pillIcon: '🍽️',
              pillLabel: 'Food',
              categorySlug: 'food',
            },
          ],
        },
      ],
    },
    recentUpdates: {
      heading: 'Recent Updates',
      subtitle: 'Latest changes to the knowledge base',
      viewAll: 'View All Changes',
      latestLabel: 'Latest Articles',
    },
    contribute: {
      heading: 'Contribute',
      description:
        'This is an open-source project. Every article, every source, every line of code is public. If you know something we missed, you can fix it.',
      guideLabel: 'Contribution Guide',
      githubLabel: 'View on GitHub',
    },
  },
};

export default config;
