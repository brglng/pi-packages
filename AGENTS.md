# AGENTS.md

Guidelines for agents working in this repository.

## Ask before merging from upstream

Before modifying a forked extension package, ask the user whether to first
merge the latest upstream functionality. Offer an option to skip upstream
merges for the rest of the current session, without asking again.

The upstream remotes are:

- `@brglng/pi-permission-system` → `https://github.com/gotgenes/pi-packages` (path `packages/pi-permission-system`)
- `@brglng/pi-permission-auto-review` → `https://github.com/erichll/pi-packages` (path `packages/pi-auto-review`)

Do not use `git merge`: this repo shares no common ancestor with the upstream
repos. Compare the code directly and merge at the functional level. When a
functional conflict arises during the merge, stop and ask the user how to
resolve it — do not resolve functional conflicts unilaterally.

## Versioning

- If upstream's latest version is newer than ours, merge upstream first, then
  publish `X.Y.Z-brglng.1` (taking upstream's `X.Y.Z`). If upstream is not
  newer, bump current `-brglng.x` version to `-brglng.x+1`.
- The published version should carry the `latest` dist-tag; publish with
  `--tag latest` (npm requires an explicit tag for prerelease versions).
