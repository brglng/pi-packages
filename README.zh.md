# pi-packages

由 brglng 维护的 Pi coding-agent 扩展集合。

## Packages

| 包名 | 功能简述 | 与上游的区别 | Upstream |
| --- | --- | --- | --- |
| [@brglng/pi-auto-review](packages/pi-auto-review) | 基于模型的 Pi 安全边界审批代理。 | brglng fork；读取完整的结构化命令证据，确保链式 shell 命令作为整体进行审核。 | [Pi Packages](https://pi.dev/packages/@erichll/pi-auto-review) · [NPM](https://www.npmjs.com/package/@brglng/pi-auto-review) · [Repository](https://github.com/brglng/pi-packages/tree/main/packages/pi-auto-review) |
| [@brglng/pi-portable-sessions](packages/pi-portable-sessions) | 为 Pi 提供可移植的 session 路径和 `/portable-sessions` 命令。 | —（原创，无上游） | — |
| [@brglng/pi-bailian](packages/pi-bailian) | 阿里云百炼 Token Plan 和 Coding Plan Provider。 | —（原创，无上游） | — |
| [@brglng/pi-custom-providers](packages/pi-custom-providers) | 可配置的自定义 Provider 模型发现扩展。 | —（原创，无上游） | — |
| [@brglng/pi-currency-cost](packages/pi-currency-cost) | 将已配置的 Provider/Model 费用换算为 USD。 | —（原创，无上游） | — |

每个包都是独立的 npm 包，可分别发布与安装：

```bash
cd packages/<name>
npm publish
```

如需在仓库根目录一次性发布所有包（需要 pnpm）：

```bash
pnpm install
pnpm run publish:all
```

后续可能新增其他包；当新包不是对现有上游的 fork 时，
上游一栏填写 `—`，区别一栏同样填写 `—`。

## License

本仓库中的原创代码以 [MPL-2.0](LICENSE) 许可发布。
`packages/` 下的 fork 扩展遵循各自上游的许可证，以各包自己的 `LICENSE` 文件为准。

英文版见 [README.md](README.md)。
