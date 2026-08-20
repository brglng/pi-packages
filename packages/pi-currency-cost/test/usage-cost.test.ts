import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { CurrencyCostConfig } from "#src/config";
import { convertUsageCost, selectCurrency } from "#src/usage-cost";

const CONFIG: CurrencyCostConfig = {
  currencies: {
    CNY: { usdRate: 0.145 },
    JPY: { usdRate: 0.0067 },
    EUR: { usdRate: 1.15 },
  },
  providers: {
    openrouter: { currency: "USD" },
    bailian: {
      currency: "CNY",
      models: { "qwen3.8-max": { currency: "USD" } },
    },
    eurGateway: { currency: "EUR" },
  },
  rateSource: { type: "boc" },
};

interface AssistantLike {
  role: "assistant";
  provider: string;
  model: string;
  responseModel?: string;
  content: unknown;
  usage: {
    cost: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Narrow the AgentMessage union to the assistant shape for assertions. */
function asAssistant(
  message: MessageEndEvent["message"] | undefined,
): AssistantLike {
  return message as unknown as AssistantLike;
}

function assistantMessage(
  overrides: Record<string, unknown> = {},
): MessageEndEvent["message"] {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "bailian",
    model: "qwen3.7-plus",
    responseModel: undefined,
    content: [],
    stopReason: "stop",
    timestamp: 1,
    usage: {
      input: 100,
      output: 200,
      cacheRead: 50,
      cacheWrite: 10,
      totalTokens: 360,
      cost: {
        input: 0.0001,
        output: 0.0002,
        cacheRead: 0.00005,
        cacheWrite: 0.00001,
        total: 0.00036,
      },
    },
    ...overrides,
  } as unknown as MessageEndEvent["message"];
}

describe("currency selection", () => {
  it("uses the model override over the provider currency", () => {
    expect(selectCurrency(CONFIG.providers, "bailian", "qwen3.8-max")).toBe(
      "USD",
    );
    expect(selectCurrency(CONFIG.providers, "bailian", "other-model")).toBe(
      "CNY",
    );
  });

  it("ignores inherited prototype keys when selecting providers/models", () => {
    expect(
      selectCurrency(CONFIG.providers, "constructor", "m"),
    ).toBeUndefined();
    expect(
      selectCurrency(CONFIG.providers, "hasOwnProperty", "m"),
    ).toBeUndefined();
    expect(selectCurrency(CONFIG.providers, "__proto__", "m")).toBeUndefined();
    // A model requested through the prototype chain falls back to the
    // provider currency instead of resolving an inherited entry.
    const providers = {
      bailian: {
        currency: "CNY",
        models: { "gpt-4": { currency: "USD" } },
      },
    };
    expect(selectCurrency(providers, "bailian", "constructor")).toBe("CNY");
  });

  it("returns undefined for unmapped providers", () => {
    expect(
      selectCurrency(CONFIG.providers, "anthropic", "claude"),
    ).toBeUndefined();
  });

  it("uses provider-level currency when no model override exists", () => {
    expect(selectCurrency(CONFIG.providers, "eurGateway", "m")).toBe("EUR");
  });
});

describe("usage cost conversion", () => {
  it("converts mapped provider usage cost to USD and recomputes total", () => {
    const replacement = asAssistant(
      convertUsageCost(assistantMessage(), CONFIG),
    );
    expect(replacement.role).toBe("assistant");
    const cost = replacement.usage.cost;
    expect(cost.input).toBeCloseTo(0.0001 * 0.145, 12);
    expect(cost.output).toBeCloseTo(0.0002 * 0.145, 12);
    expect(cost.cacheRead).toBeCloseTo(0.00005 * 0.145, 12);
    expect(cost.cacheWrite).toBeCloseTo(0.00001 * 0.145, 12);
    expect(cost.total).toBeCloseTo(
      (0.0001 + 0.0002 + 0.00005 + 0.00001) * 0.145,
      12,
    );
  });

  it("uses the response model when present for matching", () => {
    const message = assistantMessage({
      model: "catalog-name",
      responseModel: "qwen3.8-max",
    });
    expect(convertUsageCost(message, CONFIG)).toBeUndefined(); // USD override
  });

  it("leaves USD providers untouched", () => {
    const message = assistantMessage({ provider: "openrouter" });
    expect(convertUsageCost(message, CONFIG)).toBeUndefined();
  });

  it("leaves unconfigured providers untouched", () => {
    const message = assistantMessage({
      provider: "anthropic",
      model: "claude",
    });
    expect(convertUsageCost(message, CONFIG)).toBeUndefined();
  });

  it("does not convert when the currency entry is missing, and warns", () => {
    const message = assistantMessage({ provider: "eurGateway" });
    const config: CurrencyCostConfig = {
      ...CONFIG,
      providers: { eurGateway: { currency: "EUR" } },
    };
    delete (config.currencies as Record<string, unknown>)["EUR"];
    const warnings: string[] = [];
    expect(
      convertUsageCost(message, config, (text) => warnings.push(text)),
    ).toBeUndefined();
    expect(warnings.join(" ")).toContain("EUR");

    const missingMapping = assistantMessage({
      provider: "bailian",
      model: "m",
    });
    expect(
      convertUsageCost(missingMapping, {
        ...CONFIG,
        providers: { bailian: { currency: "XXX" } },
      }),
    ).toBeUndefined();
  });

  it("uses the configured usdRate directly (no fallback/current split)", () => {
    const message = assistantMessage({ provider: "bailian", model: "m" });
    const config: CurrencyCostConfig = {
      ...CONFIG,
      currencies: { JPY: { usdRate: 0.0067 } },
      providers: { bailian: { currency: "JPY" } },
    };
    const replacement = asAssistant(convertUsageCost(message, config));
    expect(replacement.usage.cost.input).toBeCloseTo(0.0001 * 0.0067, 12);
  });

  it("refuses a non-positive or missing usdRate (conversion stays off)", () => {
    // The normalized shape of an entry without a usable rate carries a NaN
    // usdRate; conversion must stay off.
    const config: CurrencyCostConfig = {
      ...CONFIG,
      currencies: {
        CNY: { usdRate: Number.NaN },
      },
    };
    const warnings: string[] = [];
    expect(
      convertUsageCost(assistantMessage(), config, (text) =>
        warnings.push(text),
      ),
    ).toBeUndefined();
    expect(warnings.join(" ")).toContain("usdRate");
  });

  it("returns undefined for non-assistant messages", () => {
    const userMessage = assistantMessage({
      role: "user",
      content: "hi",
    });
    const toolMessage = assistantMessage({
      role: "toolResult",
      content: [],
    });
    expect(convertUsageCost(userMessage, CONFIG)).toBeUndefined();
    expect(convertUsageCost(toolMessage, CONFIG)).toBeUndefined();
  });

  it("preserves the message and usage shape (original untouched)", () => {
    const message = assistantMessage({
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        cacheWrite1h: 2,
        reasoning: 1,
        totalTokens: 10,
        cost: {
          input: 0.1,
          output: 0.2,
          cacheRead: 0.3,
          cacheWrite: 0.4,
          total: 1,
          customField: "kept",
        },
      },
    });
    const original = asAssistant(message);
    const replacement = asAssistant(convertUsageCost(message, CONFIG));
    // Original message is not mutated.
    expect(original.usage.cost.total).toBe(1);
    expect(original.usage.cost.input).toBe(0.1);
    // Extra usage and cost fields survive on the replacement.
    expect(replacement.usage.cost.customField).toBe("kept");
    expect(replacement.usage.reasoning).toBe(1);
    expect(replacement.usage.cacheWrite1h).toBe(2);
    expect(replacement.usage.totalTokens).toBe(10);
    expect(replacement.content).toBe(original.content);
    expect(replacement.model).toBe(original.model);
    expect(replacement.usage.cost.total).toBeCloseTo(
      (0.1 + 0.2 + 0.3 + 0.4) * 0.145,
      12,
    );
  });

  it("skips conversion when the rate is unusable", () => {
    const config: CurrencyCostConfig = {
      ...CONFIG,
      currencies: { EUR: { usdRate: 0 } },
    };
    const warnings: string[] = [];
    const message = assistantMessage({ provider: "eurGateway" });
    expect(
      convertUsageCost(message, config, (text) => warnings.push(text)),
    ).toBeUndefined();
    expect(warnings.join(" ")).toContain("usdRate");
  });
});
