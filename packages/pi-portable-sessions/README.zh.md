# @brglng/pi-portable-sessions

为 [Pi coding agent](https://github.com/earendil-works/pi-mono)
提供可移植的 session 存储目录名。

默认情况下，Pi 会把每个项目的 session 存放在以「编码后的工作目录」命名的子目录中：

```text
~/.pi/agent/sessions/--Users-zpan-my-project--/20240816_1234abcd.jsonl
```

目录名里嵌入了绝对路径，因此在不同的机器上各不相同（用户名不同、
挂载点不同）。`@brglng/pi-portable-sessions` 会把该目录重命名为**可移植**的
形式——家目录前缀变为 `HOME`、其他根目录变为 `ROOT`、其余路径部分做
URL 编码——使同一项目在任何机器上都映射到相同的目录名，从而让 session
目录可以跨机器同步与共享。

## 工作原理

Pi 硬编码了 `--<encoded-cwd>--` 目录名，本扩展无法修改 Pi 内部的编码逻辑，
因此它迁移目录并在 Pi 的默认路径上留下**符号链接桥**：

```text
~/.pi/agent/sessions/
├── HOME%2Fmy-project/          ← 真实目录（可移植名）
└── --Users-zpan-my-project--   ← symlink → HOME%2Fmy-project
```

Pi 会继续通过符号链接写入，因此当前 session、`/resume` 以及之后的每次启动都照常工作，而磁盘上的目录名已经变成可移植形式。

## 命名规则

1. 优先匹配最长的 `extraPrefixes` 项。
2. 否则家目录前缀替换为 `homeLabel`。
3. 否则根目录前缀（`/`）替换为 `rootLabel`。
4. 路径其余部分做 percent 编码（URL 编码），保证名字可逆且不含对文件系统不友好的字符。

| 工作目录 | 可移植名 |
|-------------------|---------------|
| `/Users/zpan/my-project`（家目录 `/Users/zpan`） | `HOME%2Fmy-project` |
| `/Users/zpan` | `HOME` |
| `/var/www` | `ROOT%2Fvar%2Fwww` |
| `/Volumes/Backup/data`（配置了 `{"/Volumes/Backup": "BACKUP"}`） | `BACKUP%2Fdata` |

## 安装

```bash
npm install -g @brglng/pi-portable-sessions
```

包通过 `pi.extensions` 注册，会被自动加载。

## 配置

扩展读取标准的 Pi 扩展配置文件：

- 全局：`~/.pi/agent/extensions/pi-portable-sessions/config.json`
- 项目级：`<cwd>/.pi/extensions/pi-portable-sessions/config.json`

项目级配置覆盖全局配置；`extraPrefixes` 映射会合并。参见
[`config/config.example.json`](config/config.example.json) 与
[`schemas/config.schema.json`](schemas/config.schema.json)。

```json
{
  "$schema": "https://raw.githubusercontent.com/brglng/pi-packages/main/packages/pi-portable-sessions/schemas/config.schema.json",
  "homeLabel": "HOME",
  "rootLabel": "ROOT",
  "extraPrefixes": {
    "/Volumes/Backup": "BACKUP"
  },
  "notifyOnStart": true
}
```

| 选项 | 默认值 | 说明 |
|--------|---------|-------------|
| `homeLabel` | `HOME` | 替换家目录前缀的标签。 |
| `rootLabel` | `ROOT` | 替换根目录前缀的标签。 |
| `extraPrefixes` | `{}` | 额外的「绝对路径前缀 → 标签」映射。 |
| `notifyOnStart` | `true` | Pi 启动后提示哪些 session 目录可以迁移及应运行的命令。 |

session 根目录不在配置中：它由 Pi 自身解析，优先级与 Pi 一致——
`PI_CODING_AGENT_SESSION_DIR`、`settings.json` 中的 `sessionDir`、默认的
`<agentDir>/sessions`。

## 命令

### `/portable-sessions status`

显示当前项目的可移植名、Pi 的默认目录与可移植目录。

### `/portable-sessions migrate`

把当前项目的 session 目录迁移为可移植名，并在 Pi 的默认路径留下符号链接。

- 不带参数：迁移当前项目。
- 指定 `<name>...`：迁移一个或多个指定的 session 目录——可以是默认目录名
  （`--<encoded-cwd>--`）、可移植名，或绝对的工作目录路径。
- `--all`：迁移 sessions 根目录下所有默认命名的 session 目录（通过读取
  session 文件头部的 `cwd` 识别，因为 Pi 的编码不可逆）。
- `--dry-run`：只预览将要发生的变化，不移动任何文件。
- `--yes`：跳过确认对话框（非 TUI 模式下必需）。

移动任何内容之前，会弹出确认对话框，逐条显示重命名——当前目录名与其可移植目标：

```text
Migrate 2 session directories?
  --Users-zpan-project-a--  →  HOME%2Fproject-a
  --var-www--               →  ROOT%2Fvar%2Fwww
```

迁移期间，Pi 会阻止 session 操作（`/new`、`/resume`、`/fork`、`/tree`、
`/compact`），并吞掉用户输入同时给出警告，确保不会有 session 文件写入到
即将被重命名或合并的目录中。

当可移植目录里已存在与待迁移目录同名的 session 文件时，两份文件会用 Pi 的
默认模型合并：通过嵌套的 `pi -p`（print 模式，`--no-session`）运行，把两个
JSONL 文件合并进目标文件。合并运行的 session 被隔离在一个临时目录中，事后
删除——因此它永远不会被迁移，也不留痕迹。合并失败的冲突会被跳过，并在迁移
汇总中报告。

迁移是幂等的：再次运行只会报告已迁移的目录并跳过。

## 启动提示

Pi 启动后，扩展会扫描 sessions 根目录，并在仍有 session 目录可迁移时给出
通知，列出每个重命名项及应运行的命令（当前项目用 `/portable-sessions
migrate`，全部迁移用 `/portable-sessions migrate --all`）。可在配置中设置
`"notifyOnStart": false` 关闭。

## 局限

- Pi 的*当前* session 文件仍通过 `--<encoded-cwd>--` 符号链接寻址，只有物理
  目录名改变。这是有意为之——正是它保证了迁移前后 Pi 完全可用。
- 当可移植目录已存在（例如从另一台机器同步而来）时，迁移会合并文件而不覆盖
  已有文件；未能合并的同名 jsonl 会以 `*-conflicted.jsonl` 名称保留，避免数据
  丢失。
- `--all` 无法迁移读不到 session 文件头部的目录；这类目录会被报告并跳过。

## License

MIT
