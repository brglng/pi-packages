import { describe, expect, it } from "vitest";
import { mapModel } from "../src/api";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/config";
import { mergeModels } from "../src/index";

const provider = {
  id: "gateway",
  baseUrl: "https://gateway.example/v1",
  apiKey: "$GATEWAY_KEY",
  discoverModels: true,
  modelsPath: "/models",
  models: {},
};

describe("custom provider configuration", () => {
  it("supports any number of providers", () => {
    const one = normalizeConfig(
      { baseUrl: "https://one.test/v1", apiKey: "$ONE_KEY" },
      "one",
    );
    const two = normalizeConfig(
      { baseUrl: "https://two.test/v1", apiKey: "$TWO_KEY" },
      "two",
    );
    expect(one.config.providers[0]?.id).toBe("one");
    expect(two.config.providers[0]?.id).toBe("two");
  });

  it("ignores model-level API keys because Pi resolves auth per provider", () => {
    const result = normalizeConfig(
      {
        baseUrl: "https://api.test",
        apiKey: "$PROVIDER_KEY",
        models: { model: { apiKey: "$MODEL_KEY" } },
      },
      "gateway",
    );
    expect(result.config.providers[0]?.apiKey).toBe("$PROVIDER_KEY");
    expect(result.config.providers[0]?.models.model).not.toHaveProperty(
      "apiKey",
    );
  });

  it("normalizes the singular anthropic API alias", () => {
    const result = normalizeConfig(
      {
        baseUrl: "https://api.test",
        apiKey: "$API_KEY",
        api: "anthropic-message",
      },
      "anthropic",
    );
    expect(result.config.providers[0]?.api).toBe("anthropic-messages");
  });
});

describe("model mapping", () => {
  it("prefers explicit model settings and keeps server metadata", () => {
    const model = mapModel(
      {
        ...provider,
        models: {
          model: {
            api: "openai-responses",
            maxTokens: 4096,
            cost: { output: 3 },
          },
        },
      },
      {
        id: "model",
        name: "Server name",
        api: "openai-completions",
        context_window: 200000,
        max_output_tokens: 10000,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
    );
    expect(model?.api).toBe("openai-responses");
    expect(model?.maxTokens).toBe(4096);
    expect(model?.contextWindow).toBe(200000);
    expect(model?.cost).toEqual({
      input: 1,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("keeps configured models that the server does not return", () => {
    const result = mergeModels(
      [
        {
          id: "server-model",
          name: "Server model",
          api: "openai-completions",
          baseUrl: provider.baseUrl,
          reasoning: false,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
      {
        ...provider,
        models: {
          "server-model": { maxTokens: 4096 },
          "local-only-model": {
            api: "openai-responses",
            contextWindow: 200000,
          },
        },
      },
    );
    expect(result.map((model) => model.id)).toEqual([
      "server-model",
      "local-only-model",
    ]);
    expect(result[0]?.maxTokens).toBe(4096);
    expect(result[1]?.api).toBe("openai-responses");
    expect(result[1]?.contextWindow).toBe(200000);
  });

  it("starts with an empty provider list", () => {
    expect(DEFAULT_CONFIG.providers).toEqual([]);
  });
});
