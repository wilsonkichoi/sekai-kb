# .fable/ — execution payload for the lagunabeach-md rebuild

Everything needed to run the rebuild (STRATEGIC-DIRECTION.md §E) in the fresh
repo, in one copy-over location. Authored by Fable 5, 2026-07-04.

> **PARTIALLY SUPERSEDED 2026-07-07** (Wilson's call, per the same-dated revision
> note in STRATEGIC-DIRECTION.md): execution runs through the dev plugin
> (Linear tracker, `/dev:*` lifecycle), not the two-session `.handoff/` loop.
> The `handoff/` and `skills/` payload entries were deliberately NOT copied into
> this repo; the copy mapping and "operating loop" sections below are historical.
> Operative process docs: `.claude/dev.md` + `docs/` in this repo.

## Copy mapping (Wilson, at task 0.1 step 4)

From this directory in the v1 repo, into the fresh `lagunabeach-md` clone:

| Source (here) | Destination (new repo) |
|---|---|
| `STRATEGIC-DIRECTION.md`, `README.md` | `.fable/` (same path) |
| `skills/lb-implement/SKILL.md` | `.claude/skills/lb-implement/SKILL.md` |
| `skills/lb-review/SKILL.md` | `.claude/skills/lb-review/SKILL.md` |
| `handoff/*.md` | `.handoff/*.md` |
| `diagrams/*` (architecture, data-flow, repo-topology; .drawio + .png) | `docs/diagrams/*` |

One-liner from inside the new clone (v1 checkout as sibling dir):

```bash
SRC=../lagunabeach-md-v1/.fable
mkdir -p .fable .claude/skills/lb-implement .claude/skills/lb-review .handoff docs/diagrams
cp "$SRC"/STRATEGIC-DIRECTION.md "$SRC"/README.md .fable/
cp "$SRC"/skills/lb-implement/SKILL.md .claude/skills/lb-implement/
cp "$SRC"/skills/lb-review/SKILL.md .claude/skills/lb-review/
cp "$SRC"/handoff/*.md .handoff/
cp "$SRC"/diagrams/* docs/diagrams/
git add -A && git commit -m "chore: seed rebuild execution payload from v1 .fable/"
```

Commit it as the repo's first commit, then start the loop.

## The operating loop

Two terminals, both in the new repo, kept open across rounds; `/clear` between
rounds is expected — every round is self-contained.

1. **Session 1 (implementer):** `/lb-implement`. Reads the queued round from
   `.handoff/TO-IMPLEMENTER.md` (Round 1 = task 0.2 is pre-seeded — no manual
   seeding session needed), does the work, builds, commits, writes the report +
   self-check to `.handoff/TO-REVIEWER.md`, tells you it's done.
2. **Session 2 (reviewer):** `/lb-review`. Re-verifies every claim against the
   repo, may ask you for decisions, ticks `.handoff/PROGRESS.md`, triages
   `.handoff/BACKLOG.md`, queues the next round to `TO-IMPLEMENTER.md`.
3. Alternate `/lb-implement` ↔ `/lb-review` until a ⛔ Wilson gate (phase
   transition, design sign-off, cutover) stops the loop for your call.
4. Discovered tasks: the implementer parks them in `BACKLOG.md`; the reviewer
   brings them to you at phase gates. You decide what enters the plan.
5. Lost state (both TO-* files consumed, you forgot where things stand): run
   `/lb-review` — it recovers from `PROGRESS.md` + `LEDGER.md`.

## Where the rules live

- **Universal rules (5):** inside each skill — the only rules kept there.
- **Everything else:** `.fable/STRATEGIC-DIRECTION.md` — §E.0 (protocol, model
  policy, binding references, gates) and the per-task §E blocks. The reviewer
  restates the applicable rules inside every queued round, so the implementer
  reads them at point of use; nothing depends on the model remembering skill
  prose (the v1-era failure mode).

## Not in this payload (deliberate)

The other `lb-*` skills (lb-write, lb-validate, lb-sync, …) port later at
their §F trigger points, extraction source `../lagunabeach-md-v1/.claude/skills/`.
Only the loop skills needed from Round 1 are refined and carried here.
