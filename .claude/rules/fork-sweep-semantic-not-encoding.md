# Fork-code sweep: semantic grep, not just codepoint grep

The CJK codepoint grep (`rg '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]'`) proves CJK
codepoints are absent. It does NOT prove fork-era code is removed. ASCII-encoded fork
constructs pass the codepoint grep trivially:

- Path constants: `SPORE-BLUEPRINTS/`, `SPORE-HARVESTS/`, `/memory/`, `/diary/`, `/reports/`
- Language identifiers: `zh-TW`, `ja`, `ko`, `_LANG_DIRS`, `APPLIES_TO`
- Place-brand strings in fixtures: `Taiwan.md`, `taiwan-md`
- Dead dispatch machinery: `is_translation`, `target.lang` routing (when only `en` exists)

**After the codepoint grep, run a semantic sweep** for known fork constructs:

```sh
rg -ni 'SPORE|APPLIES_TO|_LANG_DIRS|zh-TW|taiwan\.md|is_translation' scripts/ tests/
```

Tailor the pattern list to what the fork file actually contained. Any hit is dead fork code
unless it is a negative assertion (`assert not hasattr(...)` confirming absence).

**The rule:** a "dead fork code removed" claim requires BOTH greps clean. A codepoint-only
clean is not evidence of semantic clean, and must not be presented as such in a work summary.

**Why (LB-20):** the executor claimed "Residual CJK/lang dead code removed" based solely on
`rg CJK scripts/` returning no matches. The review found `APPLIES_TO` plugin filters,
`_LANG_DIRS` sets, `SPORE-*` path-skip branches in ~10 check files, and `author: 'Taiwan.md'`
in test fixtures, all passing the codepoint grep because they are ASCII. Cost: a full second
review cycle (round 1 request-changes → round 2 approve) adding ~7 hours to the task.
