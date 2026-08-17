# @brglng/pi-bailian

> For a Chinese version, see [README.zh.md](README.zh.md).

An Aliyun Bailian provider for the [Pi coding agent](https://pi.dev/), with
Token Plan, Coding Plan, and configurable workspaces.

## Installation

```bash
pi install /absolute/path/to/pi-packages/packages/pi-bailian
```

After publication:

```bash
pi install npm:@brglng/pi-bailian
```

## Configuration

The extension reads these files; project configuration overrides global
configuration:

- Global: `~/.pi/agent/extensions/pi-bailian/config.json`
- Project: `<cwd>/.pi/extensions/pi-bailian/config.json`

```json
{
  "workspaceId": "token-plan",
  "plan": "token-plan",
  "discoverModels": true,
  "preferResponses": true
}
```

Set the API key before starting Pi:

```bash
export DASHSCOPE_API_KEY="your Bailian API key"
```

`workspaceId` distinguishes Token Plan, Coding Plan, and ordinary Bailian
workspaces. Token Plan defaults to `token-plan`. A Coding Plan setup commonly
looks like:

```json
{
  "workspaceId": "coding-plan",
  "plan": "coding-plan"
}
```

Coding Plan's official OpenAI-compatible URL is
`https://coding.dashscope.aliyuncs.com/v1`. For another workspace or gateway,
set `baseUrl` to override the default. For normal Bailian workspaces, the URL
should include `/compatible-mode/v1` (Coding Plan is the exception).

## Features

- Attempts to discover models from Bailian's `/compatible-mode/v1/models`
endpoint at startup.
- Uses `openai-responses` for the Qwen model families documented by Bailian as
Responses-compatible, and `openai-completions` for other models.
- Uses model-list metadata for context length, output limits, input
modalities, and prices.
- Pi displays provider-reported token usage. The provider cannot reliably show
account Credit balance because the available model API does not expose it.
- `/bailian refresh` refreshes the model catalog.
- `/bailian upload <path> [category]` obtains a temporary upload lease and
  uploads a file.
- `/bailian status` shows the active provider configuration.

Model discovery and chat use the configured `workspaceId` and
`DASHSCOPE_API_KEY`. If the API key has exhausted its quota, chat or catalog
refresh may return a Bailian error; the extension retains its previous model
list and reports the error.

## Limitations

- Bailian's Responses compatibility list is maintained in its official
documentation. This extension uses a conservative known-family matcher;
unknown models use Chat Completions. Set `preferResponses: false` to disable
Responses globally.
- The provider reports Token usage but not account Credit balance or percentage.
- File upload leases require the corresponding Bailian data permission and are
  intended for model or application file workflows.
- Coding Plan has dedicated interactive-coding-tool usage restrictions; follow
  Bailian's terms. The extension does not mix Token Plan and Coding Plan
endpoints, while both use the same `DASHSCOPE_API_KEY` environment-variable
name.

## License

MPL-2.0
