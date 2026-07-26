# RELEASE — Explicit adopter releases

Adopter releases are maintainer decisions. Routine article and maintenance pull
requests do not change `VERSION`. The `/release` skill drives this same flow for
an AI CLI.

## Version ownership

| Value | Meaning | Format |
| --- | --- | --- |
| `VERSION` | adopter release SSOT | `vX.Y.Z` |
| `package.json.version` | npm-compatible mirror of `VERSION` | `X.Y.Z` |
| root `package-lock.json` versions | lockfile mirrors of `VERSION` | `X.Y.Z` |
| `FRAMEWORK-VERSION` | adopted Sekai release, unchanged by adopter releases | `vX.Y.Z` |

The Sekai template does not contain `VERSION`. Init creates it at `v0.0.0` for a
new adopter.

## Prepare a release

Start from a clean adopter checkout. The command rejects the Sekai template and
accepts exactly one semantic release level.

```bash
git status --short
npm run version:check
npm run release:bump -- patch --dry-run
npm run release:bump -- patch
git diff -- VERSION package.json package-lock.json
npm run version:check
npm run test
npm run build
```

Replace `patch` with `minor` or `major` when that is the maintainer's explicit
choice. The command updates only `VERSION`, `package.json`, and
`package-lock.json`. It never changes `FRAMEWORK-VERSION`, commits, tags, pushes,
or merges.

After verification, handle the release commit and tag according to the adopter's
own repository policy. Sekai framework tags use a separate release train and are
not valid adopter tags.

## Failure behavior

The bump command stops without writing when:

- `.sekai-template` exists.
- The release level is not `patch`, `minor`, or `major`.
- `VERSION` is not a v-prefixed semantic version.
- `package.json` or either lockfile root version has drifted from `VERSION`.

Run `npm run version:check` to identify and repair drift before retrying.
