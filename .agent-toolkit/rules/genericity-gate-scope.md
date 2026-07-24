---
tier: doctrine
---

# Genericity gates: exact scope and exclusions

The genericity guard consists of `scripts/ci/check-genericity.sh` and
`scripts/ci/check-english-only.mjs`.

- In template mode, when `.sekai-template` is present, both gates scan the whole
  repository. In instance mode, both gates scan `src/`, `scripts/`, `tests/`, and
  `.claude/skills/`.
- Denylist data lives in `scripts/ci/genericity-denylist.txt`. The genericity gate
  reads it additively with `scripts/ci/genericity-denylist.local.txt` when the local
  file exists.
- Both gates scan comments and doc-strings, not only executable code.
- Neither gate checks hex colors.

This file deliberately diverges from the instance repository's same-named rule
because framework whole-tree scanning requires denylist-clean rule text.
