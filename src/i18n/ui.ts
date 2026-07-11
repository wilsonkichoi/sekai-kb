/**
 * ui.ts — generic interface strings (English).
 *
 * Trimmed en-only port of the fork's i18n bundle (task 1.1a). Holds ONLY
 * place-agnostic UI labels — nav chrome, footer section headers, search
 * affordances. Place strings (site name, category titles) never live here;
 * they flow from `place.config.ts`. This keeps the genericity gate green while
 * preserving the fork's `t()` call sites.
 */

export const defaultLang = 'en';
export const showDefaultLang = false;

export const ui = {
  en: {
    // header nav
    'nav.explore': 'Explore',
    'nav.latest': 'Latest',
    'nav.map': 'Map',
    'nav.graph': 'Knowledge Graph',
    'nav.about': 'About',
    'nav.contribute': 'Contribute',
    'nav.changelog': 'Changelog',
    'nav.dashboard': 'Dashboard',
    // header aria + search
    'nav.aria-home': 'Home',
    'nav.aria-main-navigation': 'Main navigation',
    'nav.aria-mobile-navigation': 'Mobile navigation',
    'nav.aria-search': 'Search',
    'nav.aria-toggle-menu': 'Toggle menu',
    'nav.search-placeholder': 'Search articles',
    'nav.search-type-to-search': 'Type to search across all articles',
    // footer
    'footer.explore': 'Explore',
    'footer.project': 'Project',
    'footer.contact': 'Contact',
    'footer.about': 'About',
    'footer.graph': 'Knowledge Graph',
    'footer.dashboard': 'Dashboard',
    'footer.contribute': 'Contribute',
    'footer.changelog': 'Changelog',
    'footer.report': 'Report an issue',
    'footer.discuss': 'Discussions',
    'footer.rss': 'RSS',
    'footer.builtWith': 'Built with Astro — open source, AI-friendly.',
    'footer.support': 'Support',
    'footer.support.cta': 'Star on GitHub',
    // article page
    'article.home': 'Home',
    'article.backToHome': 'Back to Home',
    // category hub
    'category.articleCount': '{n} articles',
    'category.readGuide': 'Read the full guide →',
    'category.topic': 'Topics',
    'category.otherTopics': 'Other Topics',
    'category.featured': 'Featured',
    'category.searchPlaceholder': 'Filter articles...',
    'category.noResults': 'No articles match your search.',
    'category.citations': '{n} citations',
    // hub essay / empty state
    'hub.essay.heading': 'Guide',
    'hub.empty.title': 'Coming Soon',
    'hub.empty.description':
      'We are working on content for this category.',
    'hub.empty.future': 'Planned coverage: ',

    // about page
    'about.meta.title': 'About',
    'about.meta.description':
      'The story behind this knowledge base, how it works, and how to contribute.',
    'about.naming.title': 'Why .md?',
    'about.naming.subtitle':
      'An open knowledge base in the most AI-friendly format',
    'about.naming.tech.title': 'Technical Level',
    'about.naming.tech.desc.html':
      ', the most universal document format in the programming world. Using the most AI-friendly format to share knowledge with the world.',
    'about.naming.symbol.title': 'Symbolic Level',
    'about.naming.symbol.desc.html':
      " happens to be Moldova's country-code top-level domain. Place + Markdown = connecting community knowledge through open source.",
    'about.naming.lucky.title': 'Open Source',
    'about.naming.lucky.desc':
      'Built on an open-source knowledge base framework. Community-driven, AI-friendly, and freely forkable for any city or topic.',
    'about.vision.p1':
      "This is more than a website. It's a curated knowledge base about a place with an outsized story.",
    'about.vision.p2':
      "With an open-source spirit, a curator's eye, and AI-friendly formats, we aim to provide the most comprehensive answer for anyone who wants to know this place, whether human or AI.",
    'about.vision.p3.html':
      'This is not a travel guide, not a real estate brochure, not an advertisement.<br />This is a living knowledge base, open and always evolving.',
    'about.origin.title': 'Origin',
    'about.origin.subtitle':
      'How this knowledge base came to be',
    'about.timeline.start.date': '2026',
    'about.timeline.start.title': 'The Framework',
    'about.timeline.start.desc':
      'Built on an open-source knowledge base framework: Astro static site, search indexing, quality gates, editorial standards, knowledge graph visualization, and the philosophy of "story over information."',
    'about.timeline.what.date': '2026',
    'about.timeline.what.title': 'What We Built',
    'about.timeline.what.desc':
      'Full-text search, automated quality checks, AI-friendly endpoints (/kb/, /llms.txt), RSS, sitemap, knowledge graph, and content covering multiple domains. Open source, open data, open to contributions.',
    'about.guide.title': 'One Layer Deeper',
    'about.guide.subtitle': 'Meta-articles about how this knowledge base works',
    'about.guide.born.title': 'How an Article Is Born',
    'about.guide.born.desc':
      'From idea to published article: research, writing, fact-checking, and the editorial pipeline.',
    'about.guide.viz.title': 'Visualization Catalog',
    'about.guide.viz.desc':
      'Every chart, map, and interactive element used across the site, cataloged.',
    'about.guide.meta.title': 'About This Project',
    'about.guide.meta.desc':
      'The technical architecture, design decisions, and philosophy behind the knowledge base.',
    'about.guide.cta': 'Read more',
    'about.faq.title': 'FAQ',
    'about.faq.subtitle': 'Common questions about this project',
    'about.faq.q1': 'Is this an official government project?',
    'about.faq.a1.html':
      'No. This is an independent, open-source project. It is not affiliated with any government, chamber of commerce, or tourism board.',
    'about.faq.q2': 'Can I use this content?',
    'about.faq.a2.html':
      'Yes. All content is licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. You can share and adapt it with attribution.',
    'about.faq.q3': 'How can I contribute?',
    'about.faq.a3.html':
      'See the <a href="/contribute">Contribution Guide</a>. You can submit content via email or open a pull request on GitHub.',
    'about.contact.title': 'Contact',
    'about.contact.subtitle': 'Get in touch',
    'about.contact.cta.text':
      'Want to contribute or collaborate? We welcome all kinds of input.',

    // changelog page
    'changelog.meta.title': 'Changelog',
    'changelog.meta.description':
      'Update history — track every content addition and site improvement.',

    // contribute page
    'contribute.meta.title': 'Contribute',
    'contribute.meta.description':
      'How to contribute to this open-source knowledge base.',
    'contribute.hero.title': 'Contribute',
    'contribute.hero.subtitle':
      'This knowledge base is open source. Every article, every source, every line of code is public. If you know something we missed, you can fix it.',
    'contribute.how.title': 'How It Works',
    'contribute.how.md.title': '1. Write in Markdown',
    'contribute.how.md.desc':
      'Articles are plain .md files. Write your knowledge, add sources, and submit.',
    'contribute.how.review.title': '2. Review',
    'contribute.how.review.desc':
      'Every submission goes through fact-checking and editorial review before publishing.',
    'contribute.how.publish.title': '3. Publish',
    'contribute.how.publish.desc':
      'Approved articles go live on the site, credited to you, and become part of the permanent knowledge base.',
    'contribute.paths.title': 'Ways to Contribute',
    'contribute.paths.easy.badge': 'Easy',
    'contribute.paths.easy.title': 'Share What You Know',
    'contribute.paths.easy.desc':
      'Send us your knowledge via email. No technical skills required.',
    'contribute.paths.easy.feature1': 'No GitHub account needed',
    'contribute.paths.easy.feature2': 'Write in any format',
    'contribute.paths.easy.feature3': 'We handle the formatting',
    'contribute.paths.easy.button': 'Email Your Contribution',
    'contribute.paths.dev.badge': 'Developer',
    'contribute.paths.dev.title': 'Open a Pull Request',
    'contribute.paths.dev.desc':
      'Fork the repo, add or edit articles, and submit a PR.',
    'contribute.paths.dev.feature1': 'Full editorial control',
    'contribute.paths.dev.feature2': 'See your changes in preview',
    'contribute.paths.dev.feature3': 'Direct credit in git history',
    'contribute.paths.dev.button': 'View on GitHub',
    'contribute.guides.title': 'Writing Guidelines',
    'contribute.guides.desc':
      'A few principles that keep the knowledge base consistent and trustworthy.',
    'contribute.guides.writing.title': 'Writing Standards',
    'contribute.guides.writing.desc':
      'Good articles tell stories, not just list facts.',
    'contribute.guides.writing.rule1': 'Lead with narrative, support with evidence',
    'contribute.guides.writing.rule2': 'Cite primary sources whenever possible',
    'contribute.guides.writing.rule3': 'Write for density: every sentence should earn its place',
    'contribute.guides.images.title': 'Image Guidelines',
    'contribute.guides.images.desc':
      'Images must be properly licensed and attributed.',
    'contribute.guides.images.rule1': 'Wikimedia Commons (preferred)',
    'contribute.guides.images.rule2': 'Government/public domain sources',
    'contribute.guides.images.rule3': 'Your own photography (with release)',
    'contribute.ideas.title': 'Article Ideas',
    'contribute.ideas.idea1': 'Local history that is not on Wikipedia',
    'contribute.ideas.idea2': 'Recipes with cultural context',
    'contribute.ideas.idea3': 'Oral histories from longtime residents',
    'contribute.ideas.idea4': 'Hidden spots only locals know',
    'contribute.ideas.idea5': 'Stories from community elders',
    'contribute.ideas.idea6': 'Nature observations and seasonal patterns',
  },
} as const;
