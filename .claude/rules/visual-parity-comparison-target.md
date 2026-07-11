# Visual parity: comparison target and method

When a task's DoD requires visual/design parity, the comparison target is the v1 fork:

- **Fork dev server:** `cd ../lagunabeach-md-v1 && npm run dev -- --port 4322`
- **New version:** `npm run dev` in the task worktree (default port 4321)
- **Check both desktop and mobile widths** (~375px) for every page the task touches

The fork is the extraction source of truth for layout, spacing, color, and section presence.
Differences are intentional only when the task packet explicitly calls for a change.

**Why (LB-7):** 4 visible gaps (↗ arrows, missing Latest section, missing Contributors,
missing commit link) shipped to PR because the executor never ran both servers side-by-side.
A 30-second visual check would have caught all 4 before the review cycle.
