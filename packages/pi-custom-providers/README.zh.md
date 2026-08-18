# @brglng/pi-custom-providers

一个 Pi 扩展，用 Provider 目录中的多个 JSON 文件接入任意数量的自定义模型 Provider，
支持 OpenAI 兼容、Anthropic、Mistral、Google 及 Pi 已注册的其他 API 类型。
每个 JSON 文件对应一个 Provider，
文件名就是 Provider 名称。

## 安装

```bash
pi install /absolute/path/to/pi-packages/packages/pi-custom-providers
```

发布后：

```bash
pi install npm:@brglng/pi-custom-providers
```

## 配置

扩展读取以下配置文件，项目级配置覆盖全局配置：

- 全局：`~/.pi/agent/extensions/pi-custom-providers/`
- 项目：`<cwd>/.pi/extensions/pi-custom-providers/`

每个 `*.json` 文件对应一个 Provider，文件名就是 Provider ID。

参考 [`config/config.example.json`](config/config.example.json)。例如 `gateway.json` 定义名为
`gateway` 的 Provider。每个文件需要配置默认 `baseUrl` 和 Pi 原生格式的 `apiKey`，
因此可以添加任意多个 Provider。`apiKey` 支持环境变量引用。

## 模型发现与覆盖

启用 `discoverModels` 后，扩展请求 `<baseUrl><modelsPath>`（默认 `/models`），
并使用 Bearer API key。支持常见 OpenAI `data` 响应、裸数组，以及 `models` 或
`output.models` 响应。

服务端返回的模型参数默认全部保留。即使服务端没有返回，`models` 中配置的模型 ID 也会保留。
`models` 中的同名配置只需写需要覆盖的字段，支持
`name`、`api`、`baseUrl`、`reasoning`、`thinkingLevelMap`、`input`、`cost`、
`contextWindow`、`maxTokens`、`headers` 与 `compat`。
因此每个模型可以单独指定 `openai-completions`、`openai-responses` 或
`anthropic-messages`，也可以单独指定 Endpoint。`anthropic-message` 也可作为别名。

模型发现失败时，显式配置的模型仍然可用。将 `discoverModels` 设为 `false` 可完全使用
静态模型配置；设置 `PI_OFFLINE=1` 可在启动时跳过网络请求。

## 命令

- `/custom-providers status` 查看 Provider 和模型数量。
- `/custom-providers refresh` 刷新所有模型目录。
- `/custom-providers refresh <provider>` 刷新指定目录。

## License

MPL-2.0
