# AGENTS.md

Guidelines for agents working in this repository.

## Merge from upstream before every push

Before pushing any commit, merge the latest upstream into each forked package.
The upstream remotes are:

- `@brglng/pi-permission-system` → `https://github.com/gotgenes/pi-packages` (path `packages/pi-permission-system`)
- `@brglng/pi-auto-review` → `https://github.com/erichll/pi-packages` (path `packages/pi-auto-review`)

For each package with an upstream, run the upstream fetch and merge before
pushing. When a functional conflict arises during the merge, stop and ask the
user how to resolve it — do not resolve functional conflicts unilaterally.

Non-functional conflicts (e.g. whitespace, documentation) may be resolved
directly without asking.

## Every package supports standalone publish

Each package under `packages/` is a self-contained npm package. Publish them
individually from their own directory:

```bash
cd packages/<name>
npm publish
```
