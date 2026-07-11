# Pin build-toolchain deps to an exact, build-verified version — never caret ranges

When a task copies dependencies from the fork (`lagunabeach-md-v1`) `package.json`, pin
`astro`, `tailwindcss`, `@tailwindcss/vite`, and any coupled build-toolchain packages to an
**exact** version (no `^`/`~`), and commit `package-lock.json`. A packet's suggested `^6` /
`^4` ranges are advisory; caret ranges silently drift to a broken latest on every fresh
install.

**The contract is a known-good, build-verified exact pin — not the fork's version.** The
fork's installed version is a convenient *starting baseline* (it built once), not an
authority. This repo is a rebuild and holds authority over its own dependency set; the fork
can be stale or carry unpatched CVEs. Always prefer the newer, safer version:

- **Security patches take precedence over matching the fork.** If the fork's pinned version
  has a known advisory, move the pin to the patched version even though it diverges from the
  fork. Verify vite/toolchain-major compatibility and that `npm run build` stays green, then
  commit the lockfile. Do NOT "revert to the fork's version" to satisfy this rule — that
  reopens the vulnerability.
- **The gate is a green build, not a lockfile vite-major count.** Verify the exact pinned set
  with `npm run build`; do not gate on "how many vite majors are in the tree." Multiple vite
  majors coexisting is normal and healthy — see the note below.

**Why (LB-1 crash):** the packet's `astro ^6` / `tailwindcss ^4` floated to astro 6.4.8 +
tailwind 4.3.2, and *that specific caret-resolved combination* produced a broken build —
astro's build resolved onto an incompatible vite and the rolldown resolver crashed with
`Missing field tsconfigPaths`. The fix was pinning an exact, build-verified set (then astro
6.2.1 / tailwind 4.2.2 / @tailwindcss/vite 4.2.2). The lesson is "caret floats produce
un-verified resolutions," not "a specific version number is required."

**Note — multi-major vite coexistence is expected, do not flag it.** The current known-good
lockfile contains two vite majors: `node_modules/vite` 8.1.3 (top-level, satisfies
`@tailwindcss/vite`'s peer `^5.2.0 || ^6 || ^7 || ^8`) and `node_modules/astro/node_modules/vite`
7.3.6 (nested, satisfies astro's `vite ^7.3.2`). astro uses its own nested copy; the two never
collide. `@tailwindcss/vite`'s vite peer range is *identical* across 4.2.2 and 4.3.2, so the
LB-1 break was never "tailwind pulled vite 8" — it was the floated resolution as a whole. A
"toolchain consistency" check MUST NOT flag this healthy nesting; the only invariant that
matters is `npm run build` green on the exact pinned set.

**Precedent (2026-07-07 security scan):** bumped astro 6.2.1 → 6.4.8 to patch three
XSS/SSRF advisories (GHSA-8hv8-536x-4wqp, GHSA-jrpj-wcv7-9fh9, GHSA-2pvr-wf23-7pc7), keeping
tailwind/@tailwindcss/vite at 4.2.2. Safe because astro's `vite ^7.3.2` dep is identical
between 6.2.1 and 6.4.8, so the bump does not touch the vite-major situation. Build verified
green. The pin now intentionally diverges from the fork (still on 6.2.1); that is correct.
