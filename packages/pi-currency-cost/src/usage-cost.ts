import type { MessageEndEvent } from "@earendil-works/pi-coding-agent";
import type { CurrencyCostConfig, ProviderCurrencyConfig } from "./config";
import { USD_CODE } from "./config";
import { hasValidUsdRate, selectUsdRate } from "./rates";

const COST_COMPONENTS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type ConversionWarn = (message: string) => void;

/**
 * Resolve the source currency for a provider/model pair: the per-model
 * override wins over the provider-level currency; providers that are not
 * mapped at all yield undefined (never converted). Only own keys are read,
 * so inherited prototype entries can never act as providers or models.
 */
export function selectCurrency(
  providers: Record<string, ProviderCurrencyConfig>,
  provider: string,
  model: string,
): string | undefined {
  if (!Object.hasOwn(providers, provider)) return undefined;
  const providerConfig = providers[provider];
  if (!providerConfig) return undefined;
  if (providerConfig.models) {
    if (Object.hasOwn(providerConfig.models, model)) {
      const modelOverride = providerConfig.models[model];
      if (modelOverride?.currency) {
        return modelOverride.currency;
      }
    }
  }
  return providerConfig.currency;
}

/**
 * Convert an assistant message's `usage.cost` fields from the configured
 * source currency to USD. Returns a replacement message (same role, same
 * shape) when a conversion applies, or undefined when the message is not
 * covered by the config (unmapped/untouched providers, USD, missing rates).
 *
 * Only the five `usage.cost` fields are touched; the rest of the message and
 * usage objects are preserved by reference. `total` is recomputed as the sum
 * of the converted components, which is how Pi itself derives `cost.total`.
 */
export function convertUsageCost(
  message: MessageEndEvent["message"],
  config: CurrencyCostConfig,
  warn: ConversionWarn | undefined = undefined,
): MessageEndEvent["message"] | undefined {
  if (message?.role !== "assistant") return undefined;
  const cost = message.usage?.cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
    return undefined;
  }
  const provider = String(message.provider ?? "");
  const model = message.responseModel ?? message.model;
  const currency = selectCurrency(config.providers, provider, model);
  if (!currency || currency === USD_CODE) return undefined;

  if (!Object.hasOwn(config.currencies, currency)) {
    warn?.(
      `pi-currency-cost: no currency rate entry for ${currency} (provider "${provider}"${model ? `, model "${model}"` : ""}); usage left in ${currency}`,
    );
    return undefined;
  }
  const entry = config.currencies[currency];
  // The single configured `usdRate` must be a positive finite number.
  // Without one conversion stays off so the rate is always traceable to
  // user configuration.
  if (!hasValidUsdRate(entry)) {
    warn?.(
      `pi-currency-cost: no positive usdRate for ${currency} (provider "${provider}"${model ? `, model "${model}"` : ""}); set one in config; usage left in ${currency}`,
    );
    return undefined;
  }
  const rate = selectUsdRate(entry);
  if (!rate) {
    warn?.(
      `pi-currency-cost: no usable USD rate for ${currency} (provider "${provider}"${model ? `, model "${model}"` : ""}); set one in config; usage left in ${currency}`,
    );
    return undefined;
  }

  const nextCost = { ...cost };
  let allComponents = true;
  for (const key of COST_COMPONENTS) {
    const value = cost[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      nextCost[key] = value * rate;
    } else {
      allComponents = false;
    }
  }
  if (allComponents) {
    nextCost.total =
      nextCost.input +
      nextCost.output +
      nextCost.cacheRead +
      nextCost.cacheWrite;
  } else if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
    nextCost.total = cost.total * rate;
  }

  return {
    ...message,
    usage: {
      ...message.usage,
      cost: nextCost,
    },
  };
}
