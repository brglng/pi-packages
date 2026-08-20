import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  type ConfigWarnings,
  type CurrencyCostConfig,
  type CurrencyRateConfig,
  loadConfig,
} from "./config";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  getWritableConfigPath,
} from "./config-paths";
import {
  fetchUsdRates,
  hasValidUsdRate,
  type RateFetchResult,
  rateSourceDescription,
  selectUsdRate,
} from "./rates";
import { updateWritableConfig } from "./store";
import { convertUsageCost } from "./usage-cost";

const COMMAND_NAME = "currency-cost";

/** Outer timeout for the whole start-of-session rate fetch. Per-source
 * request timeouts already bound every request; this caps the complete
 * fetch+persist so startup can never stall the session lifecycle. */
const STARTUP_FETCH_TIMEOUT_MS = 30_000;

function usageText(): string {
  return [
    "Usage: /currency-cost <subcommand>",
    "",
    "  status                    Show config paths, currency rates, and provider mappings",
    "  refresh                   Fetch current USD rates for all configured currencies",
    "  help                      Show this help",
  ].join("\n");
}

interface Note {
  text: string;
  type: "info" | "warning";
}

class CurrencyCostRuntime {
  readonly convertedMessages = new WeakSet<object>();
  private readonly warned = new Set<string>();
  private pendingNotes: Note[] = [];
  /** Config load warnings (not yet reported over a session context). */
  constructor(public config: CurrencyCostConfig) {}

  enqueueNote(text: string, type: Note["type"]): void {
    this.pendingNotes.push({ text, type });
  }

  /** Flush pending startup notes through the first session context. */
  flushNotes(ctx: ExtensionContext): void {
    for (const note of this.pendingNotes) {
      ctx.ui.notify(note.text, note.type);
    }
    this.pendingNotes = [];
  }

  warnOnce(ctx: ExtensionContext, key: string, text: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    ctx.ui.notify(text, "warning");
  }

  /**
   * Fetch a fresh rate for every configured non-USD currency that has a
   * valid `usdRate`, persist each result back to that same field, and update
   * the in-memory config. Per-currency failures keep the configured `usdRate`
   * (selection uses it unchanged) and are reported; a source-level failure is
   * reported as a warning and never crashes startup. `signal` bounds the
   * whole fetch.
   */
  async refreshConfiguredRates(
    agentDir: string,
    cwd: string,
    signal: AbortSignal | undefined,
    fetchImpl: typeof fetch = fetch,
  ): Promise<void> {
    const configured = Object.entries(this.config.currencies)
      .filter(([code, entry]) => code !== "USD" && hasValidUsdRate(entry))
      .map(([code]) => code);
    if (configured.length === 0) return;

    let result: RateFetchResult;
    try {
      result = await fetchUsdRates(
        this.config.rateSource,
        configured,
        signal,
        fetchImpl,
      );
    } catch (error) {
      this.enqueueNote(
        `pi-currency-cost: could not fetch fresh rates (${error instanceof Error ? error.message : String(error)}). Keeping the configured usdRate values.`,
        "warning",
      );
      return;
    }
    const note = await this.persistFetchedRates(agentDir, cwd, result);
    if (result.errors.length > 0) {
      this.enqueueNote(note, "warning");
    }
  }

  /**
   * Start-of-session fetch of missing current rates, awaited inside
   * `session_start` so its notes are flushed in that lifecycle and the
   * persisted rates update the in-memory config before any message_end.
   * Every failure is caught and reported; startup can never crash here.
   */
  async startupFetch(
    agentDir: string,
    cwd: string,
    fetchImpl: typeof fetch,
    timeoutSignal: AbortSignal,
  ): Promise<void> {
    try {
      await this.refreshConfiguredRates(
        agentDir,
        cwd,
        timeoutSignal,
        fetchImpl,
      );
    } catch (error) {
      this.enqueueNote(
        `pi-currency-cost: unexpected startup rate-fetch error (${error instanceof Error ? error.message : String(error)}); keeping the configured usdRate values.`,
        "warning",
      );
    }
  }

  /** Refresh every configured non-USD currency and persist fresh rates. */
  async refreshRates(
    agentDir: string,
    cwd: string,
    ctx: ExtensionCommandContext,
    fetchImpl: typeof fetch = fetch,
  ): Promise<void> {
    const codes = Object.keys(this.config.currencies).filter(
      (code) => code !== "USD",
    );
    if (codes.length === 0) {
      ctx.ui.notify(
        "pi-currency-cost: no non-USD currencies configured; nothing to refresh.",
        "info",
      );
      return;
    }
    let result: RateFetchResult;
    try {
      result = await fetchUsdRates(
        this.config.rateSource,
        codes,
        ctx.signal,
        fetchImpl,
      );
    } catch (error) {
      ctx.ui.notify(
        `pi-currency-cost: refresh failed (${error instanceof Error ? error.message : String(error)}). Configured usdRate values are unchanged.`,
        "error",
      );
      return;
    }
    const note = await this.persistFetchedRates(agentDir, cwd, result);
    ctx.ui.notify(note, result.errors.length > 0 ? "warning" : "info");
  }

  private async persistFetchedRates(
    agentDir: string,
    cwd: string,
    result: RateFetchResult,
  ): Promise<string> {
    const writable = await getWritableConfigPath(agentDir, cwd);
    const updatedAt = Date.now();
    for (const [code, rate] of result.rates) {
      try {
        await updateWritableConfig(writable, code, {
          usdRate: rate,
          updatedAt,
        });
        this.config.currencies[code] = {
          ...this.config.currencies[code],
          usdRate: rate,
          updatedAt,
        };
      } catch (error) {
        result.errors.push({
          currency: code,
          message: `could not persist rate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    const lines = [
      `pi-currency-cost: updated USD rates (source: ${rateSourceDescription(this.config.rateSource)})`,
    ];
    for (const [code, rate] of result.rates) {
      lines.push(`  ${code}: 1 ${code} = ${rate.toFixed(6)} USD`);
    }
    if (result.errors.length > 0) {
      lines.push("");
      lines.push(
        `Keeping the configured usdRate for: ${result.errors.map((error) => error.currency).join(", ")}`,
      );
    }
    return lines.join("\n");
  }

  /**
   * `/currency-cost status`: show config paths, the rate source, the single
   * configured `usdRate` per currency, and provider mappings.
   */
  async statusCommand(
    args: string[],
    agentDir: string,
    cwd: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    if (args.length > 1 && args[1] !== "help") {
      ctx.ui.notify(usageText(), "info");
      return;
    }
    const lines = [
      `pi-currency-cost status`,
      ``,
      `Global config : ${getGlobalConfigPath(agentDir)}`,
      `Project config: ${getProjectConfigPath(cwd)}`,
      `Writable path : ${await getWritableConfigPath(agentDir, cwd)}`,
      `Rate source   : ${rateSourceDescription(this.config.rateSource)}`,
      ``,
    ];
    const currencies = Object.keys(this.config.currencies);
    if (currencies.length === 0) {
      lines.push("Currencies: none configured");
    } else {
      lines.push("Currencies:");
      for (const code of currencies.sort()) {
        const entry = this.config.currencies[code];
        if (code === "USD") {
          lines.push(`  ${code}: USD is always 1 (no conversion)`);
          continue;
        }
        const rate = selectUsdRate(entry);
        lines.push(
          `  ${code}: ${rate === undefined ? "no rate" : `${rate} USD per unit`}${entry.updatedAt ? `, updated ${new Date(entry.updatedAt).toISOString()}` : ""}`,
        );
      }
    }
    const providerIds = Object.keys(this.config.providers);
    if (providerIds.length === 0) {
      lines.push("Providers: none mapped (no conversions will happen)");
    } else {
      lines.push("Providers:");
      for (const id of providerIds.sort()) {
        const provider = this.config.providers[id];
        const currency = provider.currency ?? "(none)";
        const modelOverrides = Object.entries(provider.models ?? {})
          .filter(([, override]) => override.currency)
          .map(([model, override]) => `${model} → ${override.currency}`);
        lines.push(
          `  ${id}: ${currency}${modelOverrides.length > 0 ? ` (${modelOverrides.join(", ")})` : ""}`,
        );
      }
    }
    ctx.ui.notify(lines.join("\n"), "info");
  }
}

function describeConfigWarnings(warnings: ConfigWarnings): Note[] {
  if (warnings.length === 0) return [];
  return [
    {
      text: `pi-currency-cost configuration warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`,
      type: "warning",
    },
  ];
}

/**
 * Build the extension runtime. Async: the merged global + project config
 * is loaded before any handler is registered so message_end and the
 * /currency-cost command always observe the effective config — startup never
 * races with config loading.
 */
export async function createCurrencyCostExtension(
  pi: ExtensionAPI,
  options: {
    agentDir?: string;
    cwd?: string;
    /** Skip the start-of-session rate fetch (used by tests). */
    skipStartupFetch?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ runtime: CurrencyCostRuntime; reload: () => Promise<void> }> {
  const agentDir = options.agentDir ?? getAgentDir();
  const cwd = options.cwd ?? process.cwd();
  const fetchImpl = options.fetchImpl ?? fetch;

  // Load config before registering any hooks/commands so startup never
  // races config loading against message_end handling.
  const loaded = await loadConfig(agentDir, cwd);
  const state = { config: loaded.config, warnings: loaded.warnings };
  const runtime = new CurrencyCostRuntime(loaded.config);

  let startupFetchDone = false;
  pi.on("session_start", async (_event, ctx) => {
    for (const note of describeConfigWarnings(state.warnings)) {
      runtime.enqueueNote(note.text, note.type);
    }
    runtime.flushNotes(ctx);
    if (!options.skipStartupFetch && !startupFetchDone) {
      startupFetchDone = true;
      // Awaited inside session_start (pi awaits session_start handlers), so
      // every warning is guaranteed to be flushed before the session banner
      // finishes and the persisted rates update the in-memory config before
      // any message_end. AbortSignal.timeout bounds the whole fetch and its
      // timer auto-cleans (it never keeps the process alive).
      await runtime.startupFetch(
        agentDir,
        cwd,
        fetchImpl,
        AbortSignal.timeout(STARTUP_FETCH_TIMEOUT_MS),
      );
      runtime.flushNotes(ctx);
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return undefined;
    if (runtime.convertedMessages.has(event.message)) return undefined;
    const replacement = convertUsageCost(
      event.message,
      runtime.config,
      (text) => runtime.warnOnce(ctx, text, text),
    );
    if (!replacement) return undefined;
    runtime.convertedMessages.add(event.message);
    // Mark the replacement too so a re-emitted event for the same logical
    // message cannot be converted twice within this runtime instance.
    runtime.convertedMessages.add(replacement);
    return { message: replacement };
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Convert configured provider/model usage costs to USD. Subcommands: status, refresh, help.",
    getArgumentCompletions: (prefix) =>
      ["status", "refresh", "help"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      const run = async (): Promise<void> => {
        if (!subcommand || subcommand === "help") {
          ctx.ui.notify(usageText(), "info");
          return;
        }
        if (subcommand === "status") {
          await runtime.statusCommand(rest, agentDir, cwd, ctx);
          return;
        }
        if (subcommand === "refresh") {
          await runtime.refreshRates(agentDir, cwd, ctx, fetchImpl);
          return;
        }
        ctx.ui.notify(usageText(), "warning");
      };
      await run();
    },
  });

  return {
    runtime,
    reload: async () => {
      const reloaded = await loadConfig(agentDir, cwd);
      state.config = reloaded.config;
      state.warnings = reloaded.warnings;
      runtime.config = reloaded.config;
    },
  };
}

/**
 * @brglng/pi-currency-cost extension factory.
 * Loads global + project config, converts mapped provider/model usage costs
 * to USD on every finalized assistant message, and registers the
 * /currency-cost command.
 */
export default async function piCurrencyCostExtension(
  pi: ExtensionAPI,
): Promise<void> {
  await createCurrencyCostExtension(pi);
}

export {
  type BocRateSourceConfig,
  type ConfigWarnings,
  type CurrencyCostConfig,
  type CurrencyRateConfig,
  DEFAULT_CONFIG,
  DEFAULT_TIMEOUT_MS,
  loadConfig,
  normalizeConfig,
  normalizeCurrencyCode,
  type ProviderCurrencyConfig,
  type ProviderModelCurrency,
  type RateSourceConfig,
  USD_CODE,
} from "./config";
export {
  EXTENSION_ID,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getProjectConfigPath,
  getWritableConfigPath,
} from "./config-paths";
export {
  BOC_CURRENCY_NAMES,
  BOC_PAGE_URL,
  bocUsdPerUnit,
  fetchUsdRates,
  hasValidUsdRate,
  parseBocTable,
  type RateFetchError,
  type RateFetchResult,
  rateSourceDescription,
  readDotPath,
  selectUsdRate,
} from "./rates";
export {
  type CurrencyUpdate,
  readRawConfig,
  updateWritableConfig,
  writeConfigAtomic,
} from "./store";
export {
  type ConversionWarn,
  convertUsageCost,
  selectCurrency,
} from "./usage-cost";
