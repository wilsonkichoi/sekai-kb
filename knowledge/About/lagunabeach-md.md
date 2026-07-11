---
title: 'LagunaBeach.md: How This Project Works'
description: 'An open-source knowledge base about Laguna Beach, California. Forked from Taiwan.md, built on Astro, curated by humans and AI together. This is how the system works under the hood.'
date: 2026-06-20
tags: ['about', 'meta', 'open-source', 'infrastructure']
author: 'LagunaBeach.md'
category: 'About'
readingTime: 7
featured: false
lastVerified: 2026-06-20
lastHumanReview: false
---

# LagunaBeach.md: How This Project Works

> **30-second overview:** LagunaBeach.md is an open-source knowledge base about Laguna Beach, California. It's forked from Taiwan.md, a project that grew from zero to 1,000+ GitHub stars and 900+ articles in three months. We took the infrastructure — the build system, editorial pipeline, quality gates, multilingual routing, and AI-friendly format — and adapted it for a seven-mile stretch of Southern California coastline. This article explains how the system works.

## What This Is

A curated knowledge base. Not Wikipedia (we have perspective). Not a travel guide (we don't sell anything). Not a blog (we maintain and update articles over time).

The voice is a knowledgeable local showing you around: "See that tower on Victoria Beach? That's not actually a pirate tower. A politician built it in 1926 as a private staircase to the beach. Here's what happened..."

## The Stack

- **Content format:** Markdown files in `knowledge/` (the single source of truth)
- **Static site generator:** Astro (builds to static HTML, fast, SEO-friendly)
- **Hosting:** GitHub Pages via Cloudflare
- **Search:** MiniSearch, indexes all articles at build time
- **Map:** Leaflet + OpenStreetMap tiles (real streets, real coastline)
- **Knowledge graph:** D3 force-directed graph showing connections between articles
- **Languages:** English (default), Chinese Traditional (secondary)
- **Quality gates:** Pre-commit hooks validate frontmatter, detect credentials, enforce editorial standards

## The Fork Relationship

LagunaBeach.md is a fork of [frank890417/taiwan-md](https://github.com/frank890417/taiwan-md). The relationship:

**What we inherited (universal infrastructure):**

- Build pipeline with prebuild scripts (search index, map markers, OG images, RSS, sitemap)
- Multilingual routing with language switcher and hreflang
- Pre-commit quality checks (credential detection, frontmatter validation)
- Editorial philosophy and article grading system
- Knowledge graph visualization
- AI-friendly format (robots.txt, llms.txt welcomes crawlers)

**What we changed (content and identity):**

- 8 Laguna Beach categories instead of Taiwan's 14
- English as default language (flipped from zh-TW)
- Leaflet map instead of D3 SVG (a coastal city needs real map tiles, not an island outline)
- All branding, domain, social handles
- All content in knowledge/

**What stays untouched:**

- Chinese comments in the code (they describe infrastructure logic, not Taiwan content)
- Semiont docs in docs/semiont/ (dormant, for future Phase 5 adoption)
- All npm scripts and devDependencies
- The pre-commit hook system

## English-First, Hard-Forked

LagunaBeach.md started by tracking upstream Taiwan.md for infrastructure updates, leaving the upstream Chinese files untouched and writing English versions alongside so merges never conflicted. As the fork matured it hard-forked its own application layer and documentation:

- The site code and the English docs are now LagunaBeach.md's own, protected from being overwritten by upstream merges.
- Upstream infrastructure improvements are pulled in deliberately, file by file, rather than merged automatically.
- The English `.md` docs are first-class canon, not summaries of a Chinese original; the upstream Chinese files live in the upstream Taiwan.md repository.

## Content Structure

```
knowledge/
├── History/           → founding, indigenous peoples, art colony origins
├── Art & Galleries/   → plein air tradition, Pageant, galleries
├── Nature & Marine Life/ → tide pools, marine reserves, wildlife
├── Food/              → restaurants, cafes, local specialties
├── Beaches/           → coves, surf spots, access points
├── Trails/            → hiking, canyon walks, coastal paths
├── Events & Festivals/ → Pageant, Sawdust, Art-A-Fair
├── Neighborhoods/     → North, Village, South, Top of the World, Canyon
└── About/             → meta articles (including this one)
```

Articles are Markdown with YAML frontmatter (title, description, date, tags, category). The sync script (`scripts/core/sync.sh`) copies them to `src/content/` at build time.

## Editorial Standards

Every article follows the principles in [EDITORIAL.md](https://github.com/wilsonkichoi/lagunabeach-md/blob/main/docs/editorial/EDITORIAL.md):

- **Story over information.** Narrative arc, not bullet points.
- **Verifiable facts.** Every claim needs a source. Every quote must be real.
- **Concrete details.** Every paragraph has at least one anchor noun (name, year, place, number).
- **Find the tension first.** No tension = no article.
- **End first.** Write the ending before the body to avoid generic closings.

## How to Contribute

1. Find a topic in one of the 8 categories
2. Research using primary sources (not other summaries)
3. Write a Markdown file following the frontmatter schema
4. Put it in the correct `knowledge/{Category}/` directory
5. Open a pull request

No programming skills needed. The build system handles everything else.

---

## Current Status

Phase 4 complete: shadow translations, editorial guide, this boot system. 15+ articles across 8 categories. Map working with Leaflet. Search indexing all content. Pre-commit hooks enforcing quality. Build producing static site with RSS, sitemap, OG images.

Next: more articles, more contributors, more depth in each category.
