import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type SupportedApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "anthropic-message"
  | "mistral-conversations"
  | "google-generative-ai"
  | "google-vertex"
  | "azure-openai-responses"
  | (string & {});

export interface ModelOverride {
  name?: string;
  api?: SupportedApi;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: ("text" | "image")[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  samplingParams?: Record<string, unknown>;
  compat?: Record<string, unknown>;
}

export interface CustomProviderConfig extends ModelOverride {
  id: string;
  apiKey?: string;
  discoverModels: boolean;
  modelsPath: string;
  models: Record<string, ModelOverride>;
}

export interface CustomProvidersConfig {
  providers: CustomProviderConfig[];
}

export type ConfigWarnings = string[];

export const DEFAULT_CONFIG: CustomProvidersConfig = { providers: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : [],
    ),
  );
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function modelOverride(value: unknown): ModelOverride {
  if (!isRecord(value)) return {};
  const result: ModelOverride = {};
  if (nonEmptyString(value.name)) result.name = value.name.trim();
  if (nonEmptyString(value.api)) result.api = normalizeApi(value.api);
  if (nonEmptyString(value.baseUrl))
    result.baseUrl = value.baseUrl.trim().replace(/\/$/, "");
  if (typeof value.reasoning === "boolean") result.reasoning = value.reasoning;
  if (Array.isArray(value.input)) {
    const input = value.input.filter(
      (item): item is "text" | "image" => item === "text" || item === "image",
    );
    if (input.length > 0) result.input = input;
  }
  const contextWindow = positiveNumber(value.contextWindow);
  if (contextWindow) result.contextWindow = contextWindow;
  const maxTokens = positiveNumber(value.maxTokens);
  if (maxTokens) result.maxTokens = maxTokens;
  if (isRecord(value.cost)) {
    const input = nonNegativeNumber(value.cost.input);
    const output = nonNegativeNumber(value.cost.output);
    const cacheRead = nonNegativeNumber(value.cost.cacheRead);
    const cacheWrite = nonNegativeNumber(value.cost.cacheWrite);
    result.cost = {
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    };
    if (Array.isArray(value.cost.tiers)) {
      const tiers = value.cost.tiers.flatMap((tier) => {
        if (!isRecord(tier)) return [];
        const inputTokensAbove = positiveNumber(tier.inputTokensAbove);
        const tierInput = nonNegativeNumber(tier.input);
        const tierOutput = nonNegativeNumber(tier.output);
        const tierCacheRead = nonNegativeNumber(tier.cacheRead);
        const tierCacheWrite = nonNegativeNumber(tier.cacheWrite);
        return inputTokensAbove !== undefined &&
          tierInput !== undefined &&
          tierOutput !== undefined &&
          tierCacheRead !== undefined &&
          tierCacheWrite !== undefined
          ? [
              {
                inputTokensAbove,
                input: tierInput,
                output: tierOutput,
                cacheRead: tierCacheRead,
                cacheWrite: tierCacheWrite,
              },
            ]
          : [];
      });
      if (tiers.length > 0) result.cost.tiers = tiers;
    }
  }
  if (isRecord(value.samplingParams))
    result.samplingParams = value.samplingParams;
  const headers = stringMap(value.headers);
  if (headers) result.headers = headers;
  if (isRecord(value.compat)) result.compat = value.compat;
  if (isRecord(value.thinkingLevelMap)) {
    result.thinkingLevelMap = Object.fromEntries(
      Object.entries(value.thinkingLevelMap).filter(
        ([, item]) => typeof item === "string" || item === null,
      ),
    ) as Record<string, string | null>;
  }
  return result;
}

export function mergeModelConfig(
  provider: CustomProviderConfig,
  model: ModelOverride,
): ModelOverride {
  const {
    id: _id,
    apiKey: _apiKey,
    discoverModels: _discoverModels,
    modelsPath: _modelsPath,
    models: _models,
    ...providerDefaults
  } = provider;
  return {
    ...providerDefaults,
    ...model,
    ...(provider.cost || model.cost
      ? { cost: { ...provider.cost, ...model.cost } }
      : {}),
    ...(provider.headers || model.headers
      ? { headers: { ...provider.headers, ...model.headers } }
      : {}),
    ...(provider.samplingParams || model.samplingParams
      ? {
          samplingParams: {
            ...provider.samplingParams,
            ...model.samplingParams,
          },
        }
      : {}),
    ...(provider.compat || model.compat
      ? { compat: { ...provider.compat, ...model.compat } }
      : {}),
    ...(provider.thinkingLevelMap || model.thinkingLevelMap
      ? {
          thinkingLevelMap: {
            ...provider.thinkingLevelMap,
            ...model.thinkingLevelMap,
          },
        }
      : {}),
  };
}

export function normalizeApi(value: string): SupportedApi {
  return value === "anthropic-message" ? "anthropic-messages" : value;
}

function normalizeProvider(
  value: unknown,
  providerId: string,
  warnings: ConfigWarnings,
): CustomProviderConfig | undefined {
  if (!isRecord(value)) {
    warnings.push(`provider ${providerId} must be a JSON object; ignoring`);
    return undefined;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(providerId)) {
    warnings.push(
      `provider filename ${providerId}.json must contain only letters, numbers, dots, underscores, and hyphens; ignoring`,
    );
    return undefined;
  }
  if (!nonEmptyString(value.baseUrl)) {
    warnings.push(
      `provider ${providerId} must have a non-empty baseUrl; ignoring`,
    );
    return undefined;
  }
  const apiKey = nonEmptyString(value.apiKey) ? value.apiKey.trim() : undefined;
  const models: Record<string, ModelOverride> = {};
  if (isRecord(value.models)) {
    for (const [id, override] of Object.entries(value.models))
      models[id] = modelOverride(override);
  }
  return {
    ...modelOverride(value),
    id: providerId,
    ...(apiKey ? { apiKey } : {}),
    baseUrl: value.baseUrl.trim().replace(/\/$/, ""),
    discoverModels: value.discoverModels !== false,
    modelsPath: nonEmptyString(value.modelsPath)
      ? value.modelsPath.trim()
      : "/models",
    models,
  };
}

export function normalizeConfig(
  raw: unknown,
  providerId = "provider",
): { config: CustomProvidersConfig; warnings: ConfigWarnings } {
  const warnings: ConfigWarnings = [];
  if (raw === undefined || raw === null)
    return { config: DEFAULT_CONFIG, warnings };
  const provider = normalizeProvider(raw, providerId, warnings);
  return {
    config: provider ? { providers: [provider] } : DEFAULT_CONFIG,
    warnings,
  };
}

async function readProviderDirectory(
  path: string,
): Promise<Array<{ id: string; value: unknown }>> {
  let names: string[];
  try {
    names = await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: Array<{ id: string; value: unknown }> = [];
  for (const name of names.filter((name) => name.endsWith(".json")).sort()) {
    const id = name.slice(0, -5);
    try {
      entries.push({
        id,
        value: JSON.parse(await readFile(join(path, name), "utf8")) as unknown,
      });
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "invalid JSON"
          : error instanceof Error
            ? error.message
            : String(error);
      entries.push({ id, value: { __configError: message } });
    }
  }
  return entries;
}

function configPath(root: string): string {
  return join(root, "extensions", "pi-custom-providers");
}

function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", "pi-custom-providers");
}

async function loadProviderDirectory(
  path: string,
): Promise<{ config: CustomProvidersConfig; warnings: ConfigWarnings }> {
  const warnings: ConfigWarnings = [];
  const providers = (await readProviderDirectory(path))
    .map(({ id, value }) => {
      if (isRecord(value) && typeof value.__configError === "string") {
        warnings.push(`provider ${id}: ${value.__configError}`);
        return undefined;
      }
      return normalizeProvider(value, id, warnings);
    })
    .filter(
      (provider): provider is CustomProviderConfig => provider !== undefined,
    );
  return { config: { providers }, warnings };
}

export async function loadConfig(
  agentDir: string,
  cwd: string,
): Promise<{ config: CustomProvidersConfig; warnings: ConfigWarnings }> {
  const [global, project] = await Promise.all([
    loadProviderDirectory(configPath(agentDir)),
    loadProviderDirectory(projectConfigPath(cwd)),
  ]);
  const providers = new Map(
    global.config.providers.map((provider) => [provider.id, provider]),
  );
  for (const provider of project.config.providers)
    providers.set(provider.id, provider);
  return {
    config: { providers: [...providers.values()] },
    warnings: [...global.warnings, ...project.warnings],
  };
}
