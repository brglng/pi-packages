# pi-packages

由 brglng 维护的 Pi coding-agent 扩展集合。

## Packages

| 包名 | 功能简述 | 与上游的区别 | Upstream npm 包 | Upstream 仓库 |
| --- | --- | --- | --- | --- |
| [@brglng/pi-permission-system](packages/pi-permission-system) | 为 Pi coding agent 提供集中、确定性的权限门控，覆盖 tool、bash、MCP、skill 及特殊操作。 | 在权限结果（及审核日志）中增加 `fullCommand` 字段，使 `@brglng/pi-permission-auto-review` 等 authorizer 链接能收到完整的链式 bash 命令，而不仅是匹配到的子命令。 | `@gotgenes/pi-permission-system` | [gotgenes/pi-packages](https://github.com/gotgenes/pi-packages) (`packages/pi-permission-system`) |
| [@brglng/pi-permission-auto-review](packages/pi-permission-auto-review) | 基于模型的边界审批代理，作为 authorizer 链的一环与 pi-permission-system 集成。 | 优先使用 `@brglng/pi-permission-system` 提供的 `fullCommand` 字段，将链式命令作为整体审核；类型导入与 peer 依赖均指向 brglng fork。 | `@erichll/pi-auto-review` | [erichll/pi-packages](https://github.com/erichll/pi-packages) (`packages/pi-auto-review`) |
| [@brglng/pi-portable-sessions](packages/pi-portable-sessions) | 将 Pi 按项目划分的 session 存储目录重命名为可移植、与机器无关的名字（家目录前缀 → `HOME`、其他根目录 → `ROOT`、其余部分 URL 编码），并提供 `/portable-sessions` 命令。 | —（原创，无上游） | — | — |

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
