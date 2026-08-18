# @brglng/pi-custom-providers

A Pi extension for connecting any number of custom model providers. Each JSON
file in the provider configuration directory defines one provider; the file
name becomes the provider ID.

## Installation

```bash
pi install /absolute/path/to/pi-packages/packages/pi-custom-providers
```

After publication:

```bash
pi install npm:@brglng/pi-custom-providers
```

## Configuration

The extension reads provider files from these directories; project files
override global files with the same provider name:

- Global: `~/.pi/agent/extensions/pi-custom-providers/`
- Project: `<cwd>/.pi/extensions/pi-custom-providers/`

Every `*.json` file is one provider. For example,
`~/.pi/agent/extensions/pi-custom-providers/gateway.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/brglng/pi-packages/main/packages/pi-custom-providers/schemas/config.schema.json",
  "name": "My Gateway",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "$GATEWAY_API_KEY",
  "api": "openai-completions",
  "discoverModels": true,
  "modelsPath": "/models",
  "models": {
    "special-model": {
      "api": "openai-responses",
      "baseUrl": "http://192.168.5.46:18000/v1",
      "maxTokens": 32768
    }
  }
}
```

The filename `gateway.json` produces provider ID `gateway`. The provider
object no longer needs an `id` field. `baseUrl` is the provider default URL
and `apiKey` uses Pi's native config value syntax. API keys are provider-level;
Pi's native model configuration does not support a separate API key per model.
It supports literals, `$ENV_VAR`, `${ENV_VAR}`, and leading `!command`
values. The key is never stored in the configuration when an environment
variable or command reference is used.

Project configuration overrides a global provider with the same filename. A
project provider with a new filename is added alongside global providers.

## Model discovery and overrides

When `discoverModels` is enabled, the extension requests
`<baseUrl><modelsPath>` (default `/models`) with a Bearer token. It accepts
common OpenAI-style responses (`data`), bare arrays, and catalogs nested under
`models` or `output.models`.

Server model metadata is used by default. A model entry under `models` only
needs to specify the fields that should be overridden. Configured model IDs are
also retained when the server does not return them. Supported fields include
`name`, `api`, `baseUrl`, `reasoning`, `thinkingLevelMap`, `input`, `cost`,
`contextWindow`, `maxTokens`, `samplingParams`, `headers`, and `compat`.
This allows each model to select a different endpoint and API type such as `openai-completions`,
`openai-responses`, or `anthropic-messages`. The spelling `anthropic-message`
is accepted as an alias.

If discovery fails, explicitly configured models remain available. Set
`discoverModels` to `false` to use only configured models. Set `PI_OFFLINE=1` to
skip all network requests during startup.

## Commands

- `/custom-providers status` shows configured providers and model counts.
- `/custom-providers refresh` refreshes every catalog.
- `/custom-providers refresh <provider>` refreshes one catalog.

## License

MPL-2.0
