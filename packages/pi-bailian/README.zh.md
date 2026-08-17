# @brglng/pi-bailian

为 [Pi coding agent](https://pi.dev/) 提供阿里云百炼 Provider，支持 Token Plan、Coding
Plan 和自定义业务空间。

## 安装

```bash
pi install /absolute/path/to/pi-packages/packages/pi-bailian
```

发布后也可以使用：

```bash
pi install npm:@brglng/pi-bailian
```

## 配置

扩展读取以下配置文件，项目级配置覆盖全局配置：

- 全局：`~/.pi/agent/extensions/pi-bailian/config.json`
- 项目：`<cwd>/.pi/extensions/pi-bailian/config.json`

```json
{
  "workspaceId": "token-plan",
  "plan": "token-plan",
  "discoverModels": true,
  "preferResponses": true
}
```

必须在启动 Pi 前设置：

```bash
export DASHSCOPE_API_KEY="你的百炼 API Key"
```

`workspaceId` 是区分 Token Plan、Coding Plan 或普通百炼业务空间的关键配置。
Token Plan 默认使用 `token-plan`；Coding Plan 通常使用：

```json
{
  "workspaceId": "coding-plan",
  "plan": "coding-plan"
}
```

Coding Plan 的官方 OpenAI 兼容地址是
`https://coding.dashscope.aliyuncs.com/v1`。如果使用其他业务空间或特殊网关，
可以设置 `baseUrl` 覆盖默认地址；该地址应包含
`/compatible-mode/v1`（Coding Plan 除外）。

## 功能

- 启动时尽量从百炼 `/compatible-mode/v1/models` 自动获取模型列表。
- 对百炼官方支持 Responses API 的 Qwen 模型使用 `openai-responses`，其他模型使用
`openai-completions`。
- 使用模型列表返回的上下文长度、输出上限、输入模态和价格信息。
- Pi 会显示请求返回的 Token 用量；扩展无法可靠显示账户 Credit 余额。
- `/bailian refresh` 手动刷新模型列表。
- `/bailian upload <path> [category]` 申请临时上传 URL 并上传文件。
- `/bailian status` 查看当前 Provider 配置。

模型发现和聊天会使用配置的 `workspaceId` 与 `DASHSCOPE_API_KEY`。
如果 API Key 已用完额度，聊天或模型刷新可能返回百炼错误；扩展会保留已有模型并显示错误。

## 局限

- Responses 支持列表由百炼官方文档维护，扩展采用已知 Qwen 模型系列的安全匹配；未被识别的模型使用
Chat Completions。可通过 `preferResponses: false` 全局关闭 Responses。
- 扩展显示 Token 用量，但不显示账户 Credit 余额或百分比。
- 文件上传租约需要对应的百炼数据权限，适用于模型或应用的文件工作流。
- Coding Plan 对交互式编程工具有专门的使用限制，请遵守百炼服务条款。
扩展不会把 Token Plan 和
Coding Plan 的 API Key 混用，但二者仍使用同一个 `DASHSCOPE_API_KEY` 环境变量名。

## License

MPL-2.0
