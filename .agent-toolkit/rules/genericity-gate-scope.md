---
tier: doctrine
---

# Genericity gates: exact scope and exclusions

The genericity guard consists of `scripts/ci/check-genericity.sh` (place-name
denylist) and `scripts/ci/check-english-only.mjs` (CJK codepoints).

- **Template mode** — when `.sekai-template` is present at the repo root, both
  gates scan the whole repository.
- **Instance mode, `check-genericity.sh`** — four roots: `src/`, `scripts/`,
  `tests/`, `.claude/skills/`.
- **Instance mode, `check-english-only.mjs`** — five roots: `src/`, `scripts/`,
  `tests/`, `workers/`, `.claude/skills/`. The two root sets are not the same
  list: `workers/` is in the CJK gate's roots for when that tree arrives, so in
  instance mode a denylisted place string under `workers/` is unguarded.
- Either gate skips a scan root absent from the checkout, so a tree that does not
  exist yet is out of scope rather than an error.
- Denylist data lives in `scripts/ci/genericity-denylist.txt`. The genericity gate
  reads it additively with `scripts/ci/genericity-denylist.local.txt` when the local
  file exists.
- Both gates scan comments and doc-strings, not only executable code.
- Neither gate checks hex colors.

This file deliberately diverges from the instance repository's same-named rule
because framework whole-tree scanning requires denylist-clean rule text.
