import type { CurrencyRateConfig, RateSourceConfig } from "./config";
import { DEFAULT_TIMEOUT_MS, USD_CODE } from "./config";

/** Bank of China official spot-rate page (中行外汇牌价). */
export const BOC_PAGE_URL = "https://www.boc.cn/sourcedb/whpj/";

/** Frankfurter currency converter base endpoint (fixed, built in). */
export const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v1/latest";

/**
 * Chinese currency names as published in the 货币名称 column of the Bank of
 * China rate table. The table publishes 中行折算价 per 100 units of the
 * foreign currency; CNY itself is the base currency and has no row.
 */
export const BOC_CURRENCY_NAMES: Record<string, string> = {
  AED: "阿联酋迪拉姆",
  AUD: "澳大利亚元",
  BND: "文莱元",
  BRL: "巴西雷亚尔",
  CAD: "加拿大元",
  CHF: "瑞士法郎",
  CZK: "捷克克朗",
  DKK: "丹麦克朗",
  EUR: "欧元",
  GBP: "英镑",
  HKD: "港币",
  HUF: "匈牙利福林",
  IDR: "印尼卢比",
  ILS: "以色列谢克尔",
  INR: "印度卢比",
  JPY: "日元",
  KHR: "柬埔寨瑞尔",
  KRW: "韩国元",
  KWD: "科威特第纳尔",
  MNT: "蒙古图格里克",
  MOP: "澳门元",
  MXN: "墨西哥比索",
  MYR: "林吉特",
  NOK: "挪威克朗",
  NPR: "尼泊尔卢比",
  NZD: "新西兰元",
  PHP: "菲律宾比索",
  PKR: "巴基斯坦卢比",
  QAR: "卡塔尔里亚尔",
  RSD: "塞尔维亚第纳尔",
  RUB: "卢布",
  SAR: "沙特里亚尔",
  SEK: "瑞典克朗",
  SGD: "新加坡元",
  THB: "泰国铢",
  TRY: "土耳其里拉",
  TWD: "新台币",
  USD: "美元",
  VND: "越南盾",
  ZAR: "南非兰特",
};

/** Column index of 中行折算价 (BOC calculation price) in each table row. */
const BOC_MID_COLUMN = 5;

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(BOC_CURRENCY_NAMES).map(([code, name]) => [name, code]),
);

const DOT_PATH_SEGMENT_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

/**
 * Parse the Bank of China HTML table into `Map<code, 中行折算价>` where the
 * value is CNY per 100 units of the currency. Rows whose name is not in the
 * known name map are ignored (including the disclaimer footer row).
 */
export function parseBocTable(html: string): Map<string, number> {
  const result = new Map<string, number>();
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  for (const rowMatch of html.matchAll(rowPattern)) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/g;
    for (const cellMatch of rowHtml.matchAll(cellPattern)) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }
    if (cells.length <= BOC_MID_COLUMN) continue;
    const code = NAME_TO_CODE.get(cells[0]);
    if (!code) continue;
    const mid = Number(cells[BOC_MID_COLUMN]);
    if (Number.isFinite(mid) && mid > 0) {
      result.set(code, mid);
    }
  }
  return result;
}

/**
 * USD per one unit of `currency` derived from a parsed BOC table
 * (cross-rate via the USD row, CNY handled as the base currency).
 */
export function bocUsdPerUnit(
  parsed: Map<string, number>,
  currency: string,
): number | undefined {
  if (currency === USD_CODE) return 1;
  const usdMid = parsed.get(USD_CODE);
  if (usdMid === undefined || usdMid <= 0) return undefined;
  if (currency === "CNY") return 100 / usdMid;
  const mid = parsed.get(currency);
  if (mid === undefined || mid <= 0) return undefined;
  // Both values are CNY per 100 units, so the per-100 factor cancels out.
  return mid / usdMid;
}

/**
 * Fetch and decode the BOC page. The page is UTF-8 today but was historically
 * GB2312/GBK; when the UTF-8 parse yields no rows the bytes are re-decoded
 * as gb18030 and re-parsed.
 */
export async function fetchBocTable(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const response = await fetchWithTimeout(
    BOC_PAGE_URL,
    timeoutMs,
    signal,
    fetchImpl,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  let parsed = parseBocTable(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (parsed.size === 0) {
    parsed = parseBocTable(new TextDecoder("gb18030").decode(bytes));
  }
  if (parsed.size === 0) {
    throw new Error("Could not parse the Bank of China rate table");
  }
  return parsed;
}

/**
 * Conservative dot-path read: segments are plain object keys (no array
 * indices, no wildcards, no prototype/inherited keys). Returns undefined
 * for missing or unsafe paths.
 */
export function readDotPath(root: unknown, dotPath: string): unknown {
  let current: unknown = root;
  for (const segment of dotPath.split(".")) {
    if (!DOT_PATH_SEGMENT_RE.test(segment)) return undefined;
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    // Own properties only: prototype keys such as `constructor`, `__proto__`
    // or `toString` must never resolve to inherited values.
    if (!Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url, {
    signal: combined,
    headers: { accept: "text/html,application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response;
}

/**
 * Fetch USD per one unit of `currency` from the fixed Frankfurter endpoint
 * `?base=<currency>&symbols=USD`. The response's `rates.USD` is USD per one
 * source unit, which is exactly the conversion the extension applies.
 */
export async function fetchFrankfurterUsdRate(
  currency: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const url = `${FRANKFURTER_BASE_URL}?base=${encodeURIComponent(currency)}&symbols=USD`;
  const response = await fetchWithTimeout(url, timeoutMs, signal, fetchImpl);
  const json: unknown = await response.json();
  const raw = readDotPath(json, "rates.USD");
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `No positive USD rate found at "rates.USD" in the response from ${url}`,
    );
  }
  return value;
}

export interface RateFetchError {
  currency: string;
  message: string;
}

export interface RateFetchResult {
  /** currency -> USD per one unit, for every currency that could be resolved. */
  rates: Map<string, number>;
  errors: RateFetchError[];
}

/**
 * Fetch current USD rates for all requested currencies. Frankfurter is queried
 * once per currency; BOC uses one table request for all currencies.
 * Transport-level failures of the whole source throw; per-currency failures
 * are reported in `errors` so the caller can keep the configured `usdRate`
 * and warn.
 */
export async function fetchUsdRates(
  rateSource: RateSourceConfig,
  currencies: string[],
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<RateFetchResult> {
  const codes = [...new Set(currencies.map((code) => code.toUpperCase()))];
  const errors: RateFetchError[] = [];
  if (rateSource.type === "frankfurter") {
    const settled = await Promise.allSettled(
      codes.map((code) =>
        fetchFrankfurterUsdRate(
          code,
          rateSource.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          signal,
          fetchImpl,
        ),
      ),
    );
    const rates = new Map<string, number>();
    settled.forEach((outcome, index) => {
      const code = codes[index];
      if (outcome.status === "fulfilled") {
        rates.set(code, outcome.value);
      } else {
        errors.push({
          currency: code,
          message:
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
        });
      }
    });
    return { rates, errors };
  }
  const parsed = await fetchBocTable(
    rateSource.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal,
    fetchImpl,
  );
  const rates = new Map<string, number>();
  for (const code of codes) {
    const rate = bocUsdPerUnit(parsed, code);
    if (rate === undefined) {
      errors.push({
        currency: code,
        message: `No 中行折算价 row found for ${code} in the Bank of China table`,
      });
    } else {
      rates.set(code, rate);
    }
  }
  return { rates, errors };
}

/**
 * True when a currency entry has a usable positive configured rate.
 * Conversion never happens without one. There is no fallback/current split:
 * the single `usdRate` is both what the user sets and what a fetch replaces.
 */
export function hasValidUsdRate(
  entry: CurrencyRateConfig | undefined,
): boolean {
  return (
    entry !== undefined &&
    typeof entry.usdRate === "number" &&
    Number.isFinite(entry.usdRate) &&
    entry.usdRate > 0
  );
}

/** Pick the configured rate to convert with (the single `usdRate`). */
export function selectUsdRate(
  entry: CurrencyRateConfig | undefined,
): number | undefined {
  if (
    entry &&
    typeof entry.usdRate === "number" &&
    Number.isFinite(entry.usdRate) &&
    entry.usdRate > 0
  ) {
    return entry.usdRate;
  }
  return undefined;
}

/** Human-readable description of the configured rate source. */
export function rateSourceDescription(rateSource: RateSourceConfig): string {
  if (rateSource.type === "boc") {
    return `Bank of China spot-rate table (${BOC_PAGE_URL})`;
  }
  return `Frankfurter currency converter (${FRANKFURTER_BASE_URL}?base=<CURRENCY>&symbols=USD)`;
}
