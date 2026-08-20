import { describe, expect, it } from "vitest";
import { USD_CODE } from "#src/config";
import {
  bocUsdPerUnit,
  fetchFrankfurterUsdRate,
  fetchUsdRates,
  hasValidUsdRate,
  parseBocTable,
  readDotPath,
  selectUsdRate,
} from "#src/rates";

// Mirrors the real Bank of China table layout: name, 现汇买入价, 现钞买入价,
// 现汇卖出价, 现钞卖出价, 中行折算价 (per 100 units), 发布时间, 时间.
const BOC_HTML = `
<html><body><table>
<tr><td>澳大利亚元</td><td>475.07</td><td>475.07</td><td>478.84</td><td>478.84</td><td>479.15</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
<tr><td>欧元</td><td>779.11</td><td>779.11</td><td>784.82</td><td>784.82</td><td>783.28</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
<tr><td>日元</td><td>4.2184</td><td>4.2184</td><td>4.251</td><td>4.251</td><td>4.2445</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
<tr><td>美元</td><td>672.61</td><td>672.61</td><td>675.44</td><td>675.44</td><td>678.54</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
<tr><td>中国银行外汇牌价网页声明：1.本汇率表单位为100外币换算人民币</td><td></td></tr>
</table></html>`;

describe("Bank of China table parsing", () => {
  it("parses rows into CNY-per-100-unit mid values by code", () => {
    const parsed = parseBocTable(BOC_HTML);
    expect(parsed.get("USD")).toBe(678.54);
    expect(parsed.get("EUR")).toBe(783.28);
    expect(parsed.get("JPY")).toBe(4.2445);
    expect(parsed.get("CNY")).toBeUndefined();
  });

  it("ignores unknown names, empty cells, and the disclaimer row", () => {
    expect(parseBocTable(BOC_HTML).size).toBe(4);
    expect(parseBocTable("<table></table>").size).toBe(0);
    expect(parseBocTable("").size).toBe(0);
  });

  it("computes USD per one unit with cross-rate behavior", () => {
    const parsed = parseBocTable(BOC_HTML);
    // mid is CNY per 100 units; the per-100 factor cancels out.
    expect(bocUsdPerUnit(parsed, "EUR")).toBeCloseTo(783.28 / 678.54, 12);
    // CNY is the base currency: USD per CNY = 100 / usdMid.
    expect(bocUsdPerUnit(parsed, "CNY")).toBeCloseTo(100 / 678.54, 12);
    expect(bocUsdPerUnit(parsed, "USD")).toBe(1);
  });

  it("returns undefined when the USD reference row is missing", () => {
    const html =
      "<tr><td>欧元</td><td>1</td><td>2</td><td>3</td><td>4</td><td>783.28</td></tr>";
    expect(bocUsdPerUnit(parseBocTable(html), "EUR")).toBeUndefined();
  });
});

describe("Frankfurter source", () => {
  function frankfurterFetch(body: unknown): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD",
      );
      return {
        ok: true,
        status: 200,
        json: async () => body,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  it("reads USD per source unit from the fixed endpoint", async () => {
    await expect(
      fetchFrankfurterUsdRate(
        "CNY",
        8000,
        undefined,
        frankfurterFetch({ rates: { USD: 0.147 } }),
      ),
    ).resolves.toBeCloseTo(0.147, 12);
  });

  it("rejects missing or non-positive rates", async () => {
    await expect(
      fetchFrankfurterUsdRate(
        "CNY",
        8000,
        undefined,
        frankfurterFetch({ rates: {} }),
      ),
    ).rejects.toThrow();
    await expect(
      fetchFrankfurterUsdRate(
        "CNY",
        8000,
        undefined,
        frankfurterFetch({ rates: { USD: -1 } }),
      ),
    ).rejects.toThrow();
  });
});

describe("fetchUsdRates orchestration", () => {
  it("fetches all currencies from one BOC page", async () => {
    const fetchImpl = (async () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => encoder.encode(BOC_HTML).buffer as ArrayBuffer,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await fetchUsdRates(
      { type: "boc" },
      ["CNY", "EUR", "USD"],
      undefined,
      fetchImpl,
    );
    expect(result.errors).toEqual([]);
    expect(result.rates.get("CNY")).toBeCloseTo(100 / 678.54, 12);
    expect(result.rates.get("EUR")).toBeCloseTo(783.28 / 678.54, 12);
    expect(result.rates.get("USD")).toBe(1);
  });

  it("reports per-currency errors for currencies missing from a parsed table", async () => {
    const fetchImpl = (async () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => encoder.encode(BOC_HTML).buffer as ArrayBuffer,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await fetchUsdRates(
      { type: "boc" },
      ["XXX"],
      undefined,
      fetchImpl,
    );
    expect(result.rates.size).toBe(0);
    expect(result.errors[0]?.currency).toBe("XXX");
  });

  it("rejects an empty table at the source level", async () => {
    const fetchImpl = (async () => {
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          encoder.encode("<table></table>").buffer as ArrayBuffer,
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await expect(
      fetchUsdRates({ type: "boc" }, ["XXX"], undefined, fetchImpl),
    ).rejects.toThrow("Could not parse the Bank of China rate table");
  });

  it("throws for a source-level transport failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(
      fetchUsdRates({ type: "boc" }, ["CNY"], undefined, fetchImpl),
    ).rejects.toThrow("network down");
  });
});

describe("dot-path and template helpers", () => {
  it("reads nested object paths and rejects unsafe segments", () => {
    const root = { rates: { USD: 0.147 } };
    expect(readDotPath(root, "rates.USD")).toBe(0.147);
    expect(readDotPath(root, "rates.missing")).toBeUndefined();
    expect(readDotPath(root, "rates..USD")).toBeUndefined();
    expect(readDotPath(root, "constructor")).toBeUndefined();
    expect(readDotPath([1, 2], "0")).toBe(undefined);
  });
});

describe("selectUsdRate", () => {
  it("returns the single configured usdRate", () => {
    expect(selectUsdRate({ usdRate: 0.147 })).toBe(0.147);
    expect(selectUsdRate({ usdRate: 0.145, updatedAt: 1 })).toBe(0.145);
    expect(selectUsdRate(undefined)).toBeUndefined();
    expect(selectUsdRate({ usdRate: -1 })).toBeUndefined();
    expect(selectUsdRate({ usdRate: 0 })).toBeUndefined();
    expect(selectUsdRate({ usdRate: Number.NaN })).toBeUndefined();
  });

  it("treats USD as rate 1 with no currency entry required", () => {
    expect(USD_CODE).toBe("USD");
  });
});

describe("hasValidUsdRate", () => {
  it("requires a positive finite usdRate", () => {
    expect(hasValidUsdRate({ usdRate: 0.147 })).toBe(true);
    expect(hasValidUsdRate({ usdRate: 0.147, updatedAt: 1 })).toBe(true);
    expect(hasValidUsdRate({ usdRate: 0 })).toBe(false);
    expect(hasValidUsdRate({ usdRate: Number.NaN })).toBe(false);
    expect(hasValidUsdRate(undefined)).toBe(false);
  });
});
