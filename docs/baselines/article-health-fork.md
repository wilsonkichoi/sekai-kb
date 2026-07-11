# Fork Article-Health Baseline

Generated: 2026-07-10
Source: lagunabeach-md-v1 (fork), `article-health.py --all`

| Article | Category | Hard | Warn | Info | Pass |
|---------|----------|------|------|------|------|
| how-an-article-is-born | About | 0 | 7 | 4 | Yes |
| lagunabeach-md | About | 0 | 6 | 4 | Yes |
| visualization-catalog | About | 0 | 8 | 4 | Yes |
| laguna-art-museum | Art & Galleries | 0 | 6 | 10 | Yes |
| plein-air-painting | Art & Galleries | 0 | 7 | 8 | Yes |
| thousand-steps-beach | Beaches | 0 | 6 | 6 | Yes |
| victoria-beach | Beaches | 0 | 6 | 7 | Yes |
| pageant-of-the-masters | Events & Festivals | 0 | 6 | 7 | Yes |
| sawdust-art-festival | Events & Festivals | 0 | 7 | 6 | Yes |
| the-cliff-restaurant | Food | 0 | 7 | 6 | Yes |
| founding-and-early-history | History | 0 | 7 | 6 | Yes |
| the-1993-firestorm | History | 0 | 8 | 6 | Yes |
| tide-pools | Nature & Marine Life | 0 | 7 | 7 | Yes |
| whale-watching | Nature & Marine Life | 0 | 6 | 8 | Yes |
| south-laguna | Neighborhoods | 0 | 6 | 9 | Yes |
| the-village | Neighborhoods | 0 | 7 | 6 | Yes |
| laguna-coast-wilderness-park | Trails | 0 | 6 | 9 | Yes |
| top-of-the-world | Trails | 0 | 6 | 6 | Yes |

**Total articles:** 18 (15 articles + 3 About)
**Passing:** 18/18 (all pass at `fail_on: warn` — 0 hard violations)
**Totals:** 0 hard, 119 warn, 119 info

## Notes

- The fork's `article-health.py` runs 25 checks (auto-discovered from `lib/article_health/checks/`).
- `fail_on: warn` is the fork's default profile; all articles pass (no hard violations).
- Warnings are predominantly: missing images, missing Further Reading section, missing `rationale:` frontmatter block, low footnote density. These are editorial quality signals, not structural failures.
- This baseline is the parity target for task 4.1 (article-health check ported to this repo).
