# pi-packages

由 brglng 维护的 Pi coding-agent 扩展集合。

## Packages

| 包名 | 功能简述 | 与上游的区别 | Upstream |
| --- | --- | --- | --- |
| [@brglng/pi-permission-system](packages/pi-permission-system) | 为 Pi coding agent 提供集中、确定性的权限门控，覆盖 tool、bash、MCP、skill 及特殊操作。 | 在权限结果（及审核日志）中增加 `fullCommand` 字段，使 `@brglng/pi-auto-review` 等 authorizer 链接能收到完整的链式 bash 命令，而不仅是匹配到的子命令。 | [Pi Packages](https://pi.dev/packages/@gotgenes/pi-permission-system) · [NPM](https://www.npmjs.com/package/@gotgenes/pi-permission-system) · [Repository](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) |
| [@brglng/pi-auto-review](packages/pi-auto-review) | 基于模型的边界审批代理，作为 authorizer 链的一环与 pi-permission-system 集成。 | 优先使用 `@brglng/pi-permission-system` 提供的 `fullCommand` 字段，将链式命令作为整体审核；类型导入与 peer 依赖均指向 brglng fork。 | [Pi Packages](https://pi.dev/packages/@erichll/pi-auto-review) · [NPM](https://www.npmjs.com/package/@erichll/pi-auto-review) · [Repository](https://github.com/erichll/pi-packages/tree/main/packages/pi-auto-review) |
| [@brglng/pi-portable-sessions](packages/pi-portable-sessions) | 将 Pi 按项目划分的 session 存储目录重命名为可移植、与机器无关的名字（家目录前缀 → `HOME`、其他根目录 → `ROOT`、其余部分 URL 编码），并提供 `/portable-sessions` 命令。 | —（原创，无上游） | — |
| [@brglng/pi-bailian](packages/pi-bailian) | 阿里云百炼 Token Plan 与 Coding Plan Provider，支持可配置 workspaceId、模型自动发现，并按模型选择 Responses 或 Chat Completions。 | —（原创，无上游） | — |
| [@brglng/pi-custom-providers](packages/pi-custom-providers) | 可配置多 Provider 的模型自动发现扩展，支持按模型覆盖 Endpoint、API 类型和模型参数。 | —（原创，无上游） | — |
| [@brglng/pi-currency-cost](packages/pi-currency-cost) | 在每条最终确定的 assistant 消息上，将已配置 Provider/Model 的用量费用换算为 USD，支持按 Provider 设置币种与按模型精确覆盖；使用内置的固定汇率来源（默认 Frankfurter，可选中国银行），每种币种保存一个 `usdRate`，并在会话开始时自动更新汇率（提供 `status`/`refresh`/`help` 命令）。 | —（原创，无上游） | — |

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
