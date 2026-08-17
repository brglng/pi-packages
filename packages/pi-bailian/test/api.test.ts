import { describe, expect, it } from "vitest";
import { mapModel } from "#src/api";
import { DEFAULT_CONFIG, defaultBaseUrl, normalizeConfig } from "#src/config";

describe("Bailian configuration", () => {
  it("defaults to Token Plan with the documented environment variable", () => {
    expect(DEFAULT_CONFIG.workspaceId).toBe("token-plan");
    expect(DEFAULT_CONFIG.plan).toBe("token-plan");
    expect(defaultBaseUrl(DEFAULT_CONFIG)).toBe(
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("allows Coding Plan and custom workspace IDs", () => {
    const result = normalizeConfig({
      workspaceId: "my-workspace",
      plan: "custom",
    });
    expect(result.config.workspaceId).toBe("my-workspace");
    expect(result.config.plan).toBe("custom");

    const coding = normalizeConfig({ plan: "coding-plan" }).config;
    expect(defaultBaseUrl(coding)).toBe(
      "https://coding.dashscope.aliyuncs.com/v1",
    );
  });
});

describe("Bailian model mapping", () => {
  it("selects Responses only for the documented compatible model family", () => {
    const responses = mapModel(
      {
        model: "qwen3.8-max",
        name: "Qwen3.8 Max",
        capabilities: ["TG", "Reasoning"],
        inference_metadata: { request_modality: ["Text", "Image"] },
        model_info: { context_window: 1000000, max_output_tokens: 131072 },
      },
      { ...DEFAULT_CONFIG, preferResponses: true },
    );
    expect(responses?.api).toBe("openai-responses");
    expect(responses?.input).toEqual(["text", "image"]);
    expect(responses?.reasoning).toBe(true);
    expect(responses?.contextWindow).toBe(1000000);

    const qwenVariant = mapModel(
      { model: "qwen3.9-special-model-v2", name: "Qwen3.9 variant" },
      { ...DEFAULT_CONFIG, preferResponses: true },
    );
    expect(qwenVariant?.api).toBe("openai-responses");

    const qwenMajorOnly = mapModel(
      { model: "qwen3-special-model-v2", name: "Qwen3 variant" },
      { ...DEFAULT_CONFIG, preferResponses: true },
    );
    expect(qwenMajorOnly?.api).toBe("openai-responses");

    const nonVersionedQwen = mapModel(
      { model: "qwen-special-model", name: "Non-versioned Qwen" },
      { ...DEFAULT_CONFIG, preferResponses: true },
    );
    expect(nonVersionedQwen?.api).toBe("openai-completions");

    const completions = mapModel(
      { model: "deepseek-v4-flash-0731", name: "DeepSeek" },
      { ...DEFAULT_CONFIG, preferResponses: true },
    );
    expect(completions?.api).toBe("openai-completions");
  });
});
