# pi-packages

> For a Chinese version of this document, see [README.zh.md](README.zh.md).

A collection of Pi coding-agent extensions maintained by brglng.

## Packages

| Package | Description | Differences from upstream | Upstream |
| --- | --- | --- | --- |
| [@brglng/pi-auto-review](packages/pi-auto-review) | Model-backed approval broker for Pi security boundaries. | Brglng fork; reviews complete structured command evidence so chained shell commands are assessed as a whole. | [Pi Packages](https://pi.dev/packages/@erichll/pi-auto-review) · [NPM](https://www.npmjs.com/package/@erichll/pi-auto-review) · [Repository](https://github.com/erichll/pi-packages/tree/main/packages/pi-auto-review) |
| [@brglng/pi-portable-sessions](packages/pi-portable-sessions) | Portable Pi session paths with a `/portable-sessions` command. | — (original; no upstream) | — |
| [@brglng/pi-bailian](packages/pi-bailian) | Aliyun Bailian Token Plan and Coding Plan provider. | — (original; no upstream) | — |
| [@brglng/pi-custom-providers](packages/pi-custom-providers) | Configurable custom-provider model discovery for Pi. | — (original; no upstream) | — |
| [@brglng/pi-currency-cost](packages/pi-currency-cost) | Converts configured provider/model costs to USD. | — (original; no upstream) | — |

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
