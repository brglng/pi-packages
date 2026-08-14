# pi-packages

A collection of Pi coding-agent extensions maintained by brglng.

## Packages

| Package | Upstream npm package | Upstream repository | Type |
| --- | --- | --- | --- |
| [@brglng/pi-permission-system](packages/pi-permission-system) | `@gotgenes/pi-permission-system` | [gotgenes/pi-packages](https://github.com/gotgenes/pi-packages) (`packages/pi-permission-system`) | fork extension |
| [@brglng/pi-permission-auto-review](packages/pi-permission-auto-review) | `@erichll/pi-auto-review` | [erichll/pi-packages](https://github.com/erichll/pi-packages) (`packages/pi-auto-review`) | fork extension |

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
upstream, list the upstream as `—` and the type as `original`.

## License

See each package's own `LICENSE` file.
