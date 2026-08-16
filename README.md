# pi-packages

A collection of Pi coding-agent extensions maintained by brglng.

## Packages

| Package | Description | Differences from upstream | Upstream npm package | Upstream repository |
| --- | --- | --- | --- | --- |
| [@brglng/pi-permission-system](packages/pi-permission-system) | Centralized, deterministic permission gates over tool, bash, MCP, skill, and special operations for the Pi coding agent. | Adds a `fullCommand` field to permission results (and the review log) so an authorizer link such as `@brglng/pi-permission-auto-review` receives the full chained bash command instead of only the matched sub-command. | `@gotgenes/pi-permission-system` | [gotgenes/pi-packages](https://github.com/gotgenes/pi-packages) (`packages/pi-permission-system`) |
| [@brglng/pi-permission-auto-review](packages/pi-permission-auto-review) | A model-backed boundary approval broker that integrates with pi-permission-system as an authorizer-chain link. | Prefers the `fullCommand` field from `@brglng/pi-permission-system` so a chained command is reviewed as a whole; type imports and the peer dependency point at the brglng fork. | `@erichll/pi-auto-review` | [erichll/pi-packages](https://github.com/erichll/pi-packages) (`packages/pi-auto-review`) |
| [@brglng/pi-portable-sessions](packages/pi-portable-sessions) | Renames Pi's per-project session directories to portable, machine-independent names (home prefix → `HOME`, other roots → `ROOT`, remainder URL-encoded), with a `/portable-sessions` command. | — (original; no upstream) | — | — |

Each package is a standalone npm package and can be published and installed
independently:

```bash
cd packages/<name>
npm publish
```

To publish all packages at once from the repository root (requires pnpm):

```bash
pnpm install
pnpm run publish:all
```

New packages may be added over time; when they are not forks of an existing
upstream, list the upstream as `—` and leave the differences column as `—`.

## License

Original code in this repository is licensed under the [MPL-2.0](LICENSE).
Forked extensions under `packages/` follow their respective upstream
licenses, as stated in each package's own `LICENSE` file.

For a Chinese version of this document, see [README.zh.md](README.zh.md).
