import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  normalizeConfig,
  normalizeCurrencyCode,
} from "#src/config";

function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-currency-cost-config-"));
}

describe("config normalization", () => {
  it("uses defaults for an empty config", () => {
    const { config, warnings } = normalizeConfig({});
    expect(config.currencies).toEqual({});
    expect(config.providers).toEqual({});
    expect(config.rateSource).toEqual({ type: "frankfurter" });
    expect(warnings).toEqual([]);
  });

  it("normalizes currency codes to uppercase 3-letter codes", () => {
    const { config, warnings } = normalizeConfig({
      currencies: {
        cny: { usdRate: 0.147 },
        UsD: { usdRate: 1 },
      },
    });
    expect(config.currencies["CNY"]?.usdRate).toBe(0.147);
    expect(config.currencies["USD"]?.usdRate).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("rejects non-3-letter currency keys with a warning", () => {
    const { config, warnings } = normalizeConfig({
      currencies: { notacode: { usdRate: 0.147 } },
    });
    expect(config.currencies["NOTACODE"]).toBeUndefined();
    expect(warnings.join(" ")).toContain("notacode");
  });

  it("warns when a non-USD currency has no positive usdRate", () => {
    const { config, warnings } = normalizeConfig({
      currencies: {
        JPY: { usdRate: -1 },
        EUR: { usdRate: 0 },
      },
    });
    expect(config.currencies["JPY"]?.usdRate).toBe(NaN);
    expect(warnings.join(" ")).toContain("JPY");
    expect(warnings.join(" ")).toContain("usdRate");
    expect(warnings.join(" ")).toContain("EUR");
  });

  it("ignores unknown rate fields (only usdRate is honored)", () => {
    const { config, warnings } = normalizeConfig({
      currencies: {
        CNY: { fallbackRate: 0.147 },
        EUR: { currentRate: 1.083 },
      },
    });
    // Unknown fields are not honored: without a real usdRate the entry keeps
    // its NaN usdRate and warns that a positive usdRate is required.
    expect(config.currencies["CNY"]?.usdRate).toBe(NaN);
    expect(config.currencies["EUR"]?.usdRate).toBe(NaN);
    expect(warnings.join(" ")).toContain("usdRate");
  });

  it("does not require a fallback for USD", () => {
    const { warnings } = normalizeConfig({
      currencies: { USD: {} },
    });
    expect(warnings.join(" ")).not.toContain("USD");
  });

  it("normalizes provider currencies and model overrides", () => {
    const { config, warnings } = normalizeConfig({
      providers: {
        bailian: {
          currency: "cny",
          models: { "qwen3.8-max": { currency: "usd" } },
        },
        openrouter: { currency: "USD" },
      },
    });
    expect(config.providers["bailian"]?.currency).toBe("CNY");
    expect(config.providers["bailian"]?.models?.["qwen3.8-max"]?.currency).toBe(
      "USD",
    );
    expect(config.providers["openrouter"]?.currency).toBe("USD");
    expect(warnings).toEqual([]);
  });

  it("warns and skips providers without a currency or models map", () => {
    const { config, warnings } = normalizeConfig({
      providers: { empty: {} },
    });
    expect(config.providers["empty"]).toBeUndefined();
    expect(warnings.join(" ")).toContain("empty");
  });

  it("rejects unsafe provider and model keys without polluting maps", () => {
    // Simulate JSON input so `__proto__` is a real own key (an object
    // literal would silently set the prototype instead).
    const raw = JSON.parse(
      '{"providers": {"__proto__": {"currency": "CNY"}, "constructor": {"currency": "EUR"}, "safe": {"currency": "CNY", "models": {"prototype": {"currency": "USD"}, "gpt-5": {"currency": "EUR"}}}}}',
    ) as unknown;
    const { config, warnings } = normalizeConfig(raw);
    const providers = config.providers;
    // Rejected keys never become own provider/model entries. (Reading
    // `providers["constructor"]` would still hit the inherited Object
    // constructor on a plain object — that is why selection uses
    // own-property checks and why these keys are rejected here.)
    expect(Object.hasOwn(providers, "__proto__")).toBe(false);
    expect(Object.hasOwn(providers, "constructor")).toBe(false);
    expect(providers["safe"]?.models?.["prototype"]).toBeUndefined();
    expect(providers["safe"]?.models?.["gpt-5"]?.currency).toBe("EUR");
    // The normalized maps are ordinary objects with an intact prototype
    // (no `__proto__` assignment, so nothing was polluted).
    expect(Object.getPrototypeOf(providers)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(providers["safe"]?.models)).toBe(
      Object.prototype,
    );
    expect(providers["safe"]?.currency).toBe("CNY");
    expect(warnings.join(" ")).toContain("__proto__");
    expect(warnings.join(" ")).toContain("constructor");
    expect(warnings.join(" ")).toContain("prototype");
  });

  it("normalizes the built-in rate source choices", () => {
    expect(normalizeConfig({ rateSource: "boc" }).config.rateSource).toEqual({
      type: "boc",
    });
    expect(
      normalizeConfig({ rateSource: "frankfurter" }).config.rateSource,
    ).toEqual({ type: "frankfurter" });
    expect(
      normalizeConfig({ rateSource: { type: "frankfurter", timeoutMs: 5000 } })
        .config.rateSource,
    ).toEqual({ type: "frankfurter", timeoutMs: 5000 });
  });

  it("rejects removed custom JSON sources", () => {
    const { config, warnings } = normalizeConfig({
      rateSource: { type: "json", urlTemplate: "https://example.test" },
    });
    expect(config.rateSource).toEqual({ type: "frankfurter" });
    expect(warnings.join(" ")).toContain("no longer supported");
  });
});

describe("config precedence (global vs project)", () => {
  it("merges project over global with per-field currency merge", async () => {
    const agentDir = await dir();
    const cwd = await dir();
    try {
      await mkdir(join(agentDir, "extensions", "pi-currency-cost"), {
        recursive: true,
      });
      await writeFile(
        join(agentDir, "extensions", "pi-currency-cost", "config.json"),
        JSON.stringify({
          currencies: { CNY: { usdRate: 0.147 } },
          providers: { bailian: { currency: "CNY" } },
        }),
      );
      await mkdir(join(cwd, ".pi", "extensions", "pi-currency-cost"), {
        recursive: true,
      });
      await writeFile(
        join(cwd, ".pi", "extensions", "pi-currency-cost", "config.json"),
        JSON.stringify({
          currencies: { CNY: { usdRate: 0.145, updatedAt: 1 } },
          rateSource: { type: "boc" },
        }),
      );
      const { config } = await loadConfig(agentDir, cwd);
      expect(config.currencies["CNY"]).toEqual({
        usdRate: 0.145,
        updatedAt: 1,
      });
      expect(config.providers["bailian"]?.currency).toBe("CNY");
      expect(config.rateSource).toEqual({ type: "boc" });
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("keeps global config when no project config exists", async () => {
    const agentDir = await dir();
    const cwd = await dir();
    try {
      await mkdir(join(agentDir, "extensions", "pi-currency-cost"), {
        recursive: true,
      });
      await writeFile(
        join(agentDir, "extensions", "pi-currency-cost", "config.json"),
        JSON.stringify({ currencies: { CNY: { usdRate: 0.147 } } }),
      );
      const { config } = await loadConfig(agentDir, cwd);
      expect(config.currencies["CNY"]?.usdRate).toBe(0.147);
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });
});

describe("normalizeCurrencyCode", () => {
  it("accepts 3-letter codes and rejects everything else", () => {
    expect(normalizeCurrencyCode("cny")).toBe("CNY");
    expect(normalizeCurrencyCode(" USD ")).toBe("USD");
    expect(normalizeCurrencyCode("US")).toBeUndefined();
    expect(normalizeCurrencyCode("USDD")).toBeUndefined();
    expect(normalizeCurrencyCode(42)).toBeUndefined();
    expect(normalizeCurrencyCode(undefined)).toBeUndefined();
  });
});
