---
title: 'Visualization Catalog: How LagunaBeach.md Turns Data Into Pictures'
description: 'The visual modules available for LagunaBeach.md articles — from single-stat callouts to comparison tables and timelines. Each module renders as semantic HTML that both humans and AI crawlers can read.'
date: 2026-06-20
tags: ['about', 'meta', 'data-visualization', 'editorial']
author: 'LagunaBeach.md'
category: 'About'
readingTime: 5
featured: false
lastVerified: 2026-06-20
lastHumanReview: false
---

# Visualization Catalog: How LagunaBeach.md Turns Data Into Pictures

> **30-second overview:** When an article has numbers, timelines, or comparisons, prose alone makes readers zone out by the third percentage. LagunaBeach.md uses a set of visual modules — rendered as semantic HTML and inline SVG — so humans see a chart while AI crawlers read the same underlying data. This page shows what each module looks like, using real Laguna Beach data.

## Why Static Visualizations

Interactive JavaScript charts look impressive but have a fatal flaw: AI crawlers (GPTBot, ClaudeBot, PerplexityBot) don't execute JavaScript. A D3 chart is a blank void to them. Our visualizations use semantic HTML and inline SVG — the data lives in the source code, readable by every crawler in every language.

## Available Modules

### Big Number (tw-figure)

A single dramatic statistic displayed large. Best for opening a section with a sledgehammer fact.

```tw-figure
1918 → Today
The Laguna Beach Art Association, founded in 1918, is still active 108 years later
Laguna Beach Historical Society
```

### Stat Group (tw-stat)

Three to four parallel numbers in card layout. Replaces a paragraph stuffed with competing statistics.

```tw-stat
7,000 acres | Laguna Coast Wilderness Park protected area
22 miles | Coastline within city limits
30+ | Art galleries in the Village alone
1993 | Year of the firestorm that destroyed 441 homes
```

### Timeline (tw-timeline)

Vertical timeline for chronological sequences. Each entry has a date, event, and optional detail.

```tw-timeline
1876 | First homesteaders arrive in Laguna Canyon
1918 | Art Association founded by Anna Hills and colleagues
1932 | First Festival of Arts (later becomes Pageant of the Masters)
1927 | Laguna Beach incorporated as a city
1971 | Laguna Greenbelt established to protect surrounding hills
1993 | Firestorm destroys 441 homes in 2 hours
2012 | Crystal Cove cottages restored as historic district
```

### Comparison Table (tw-compare)

Side-by-side comparison when two things need contrasting. Better than prose for parallel structure.

```tw-compare
| | North Laguna | South Laguna |
|---|---|---|
| Character | Residential, quiet coves | Wilder coastline, tide pools |
| Access | Street-end stairways | Longer trails down bluffs |
| Crowds | Moderate | Light |
| Best for | Sunset watching, snorkeling | Exploring, solitude |
```

### Quote Block (tw-quote)

A pull quote with attribution. For real quotes only — verified, traceable to a source.

```tw-quote
"We didn't set out to create an art colony. We just wanted to paint where the light was good."
— Anna Hills, 1920 (paraphrased from Laguna Beach Art Association archives)
```

### Data Bar (tw-bar)

Horizontal bar chart for comparing magnitudes. Semantic HTML, no JavaScript.

```tw-bar
Festival of Arts | 60,000 visitors/year
Sawdust Art Festival | 200,000 visitors/year
Art-A-Fair | 40,000 visitors/year
Pageant of the Masters | 150,000 visitors/year
```

---

## Design Principles

1. **One module per idea.** Don't stack three visualizations in a row. Prose → visual → prose → visual.
2. **Media density band.** Target 0.8–1.2 visuals per 1,000 words. Below that is too text-heavy; above is visual clutter.
3. **Every module must have a source.** The last line of the data block names where the numbers came from.
4. **Semantic over decorative.** If the visualization doesn't add understanding that prose can't, delete it.

Full syntax reference: [docs/editorial/graph.md](https://github.com/wilsonkichoi/lagunabeach-md/blob/main/docs/editorial/graph.md)
