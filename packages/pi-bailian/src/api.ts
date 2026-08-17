import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { BailianConfig } from "./config.ts";
import { dataApiBaseUrl, defaultBaseUrl } from "./config.ts";

export interface BailianModelRecord {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  api: "openai-responses" | "openai-completions";
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
}

export interface ModelListEntry {
  model?: string;
  name?: string;
  description?: string;
  features?: string[];
  capabilities?: string[];
  inference_metadata?: {
    request_modality?: string[];
  };
  model_info?: {
    context_window?: number | null;
    max_input_tokens?: number | null;
    max_output_tokens?: number | null;
    max_reasoning_tokens?: number | null;
  };
  prices?: Array<{
    prices?: Array<{
      type?: string;
      price?: string | number;
      price_unit?: string;
    }>;
  }>;
}

interface ModelListResponse {
  output?: {
    models?: ModelListEntry[];
  };
  data?: Array<{ id?: string; owned_by?: string }>;
  code?: string | null;
  message?: string | null;
}

interface KnownModelHint {
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
}

const KNOWN_MODEL_HINTS: Record<string, KnownModelHint> = {
  "glm-5.2": { reasoning: true, contextWindow: 1048576, maxTokens: 131072 },
  "deepseek-v4-flash-0731": {
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 384192,
  },
  "deepseek-v4-pro-0813": {
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 384192,
  },
  "qwen3.8-max": {
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 983616,
    maxTokens: 131072,
  },
};

function assertResponse(response: Response, body: unknown): void {
  if (response.ok) return;
  const record = isRecord(body) ? body : undefined;
  const nested = record && isRecord(record.error) ? record.error : undefined;
  const message =
    (nested?.message as string | undefined) ??
    (record?.message as string | undefined) ??
    response.statusText;
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonRequest(
  _config: BailianConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not set");
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      body = text;
    }
    assertResponse(response, body);
    if (isRecord(body) && body.success === false) {
      throw new Error(
        String(body.message ?? body.code ?? "Bailian request failed"),
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function parsePrice(entry: ModelListEntry, type: string): number {
  const price = entry.prices
    ?.flatMap((range) => range.prices ?? [])
    .find((item) => item.type === type)?.price;
  const value = typeof price === "string" ? Number(price) : price;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function modelHint(id: string): KnownModelHint {
  return KNOWN_MODEL_HINTS[id] ?? {};
}

function modelInput(entry: ModelListEntry, id: string): ("text" | "image")[] {
  const hinted = modelHint(id).input;
  if (hinted) return hinted;
  const modalities = entry.inference_metadata?.request_modality ?? ["Text"];
  return modalities.some((value) => value.toLowerCase() === "image")
    ? ["text", "image"]
    : ["text"];
}

function modelLimits(
  entry: ModelListEntry,
  id: string,
): {
  contextWindow: number;
  maxTokens: number;
} {
  const hint = modelHint(id);
  const contextWindow =
    entry.model_info?.context_window ??
    entry.model_info?.max_input_tokens ??
    hint.contextWindow ??
    128000;
  const maxTokens =
    entry.model_info?.max_output_tokens ?? hint.maxTokens ?? 16384;
  return {
    contextWindow:
      typeof contextWindow === "number" && contextWindow > 0
        ? contextWindow
        : 128000,
    maxTokens:
      typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 16384,
  };
}

function modelReasoning(entry: ModelListEntry, id: string): boolean {
  return (
    modelHint(id).reasoning === true ||
    entry.capabilities?.includes("Reasoning") === true ||
    /deepseek|reason|glm-5|kimi-k2/i.test(id)
  );
}

function modelThinking(
  reasoning: boolean,
): Record<string, string | null> | undefined {
  return reasoning
    ? {
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: null,
        max: "max",
      }
    : undefined;
}

const RESPONSES_MODEL_PATTERN = /^qwen\d+(?:\.\d+)?-.+/i;

export function mapModel(
  entry: ModelListEntry,
  config: BailianConfig,
): BailianModelRecord | undefined {
  const id = entry.model?.trim();
  if (!id) return undefined;
  const reasoning = modelReasoning(entry, id);
  const input = modelInput(entry, id);
  const { contextWindow, maxTokens } = modelLimits(entry, id);
  let api: "openai-responses" | "openai-completions" = "openai-completions";
  if (config.preferResponses && RESPONSES_MODEL_PATTERN.test(id)) {
    api = "openai-responses";
  }
  const thinkingLevelMap = modelThinking(reasoning);
  let compat: Record<string, unknown> | undefined;
  if (api === "openai-completions") {
    compat = { supportsDeveloperRole: false };
    if (id.toLowerCase().includes("deepseek")) {
      compat.thinkingFormat = "deepseek";
    }
  }
  return {
    id,
    name: entry.name ?? id,
    reasoning,
    input,
    contextWindow,
    maxTokens,
    api,
    cost: {
      input: parsePrice(entry, "input_token"),
      output: parsePrice(entry, "output_token"),
      cacheRead: parsePrice(entry, "cache_read"),
      cacheWrite: parsePrice(entry, "cache_write"),
    },
    thinkingLevelMap,
    compat,
  };
}

export interface UploadLease {
  id?: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  type?: string;
}

interface UploadLeaseResponse {
  Data?: {
    FileUploadLeaseId?: string;
    Param?: {
      Url?: string;
      Method?: string;
      Headers?: unknown;
    };
    Type?: string;
  };
  data?: {
    fileUploadLeaseId?: string;
    param?: {
      url?: string;
      method?: string;
      headers?: unknown;
    };
    type?: string;
  };
}

function parseLeaseHeaders(value: unknown): Record<string, string> {
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, String(item)]),
    );
  }
  if (typeof value !== "string") return {};
  const headers: Record<string, string> = {};
  for (const line of value.split(/[,\n]/)) {
    const match = line.match(/"?([^":]+)"?\s*:\s*"?([^"]*)"?/);
    if (match) headers[match[1].trim()] = match[2].trim();
  }
  return headers;
}

export async function applyFileUploadLease(
  config: BailianConfig,
  filePath: string,
  categoryId = "default",
  signal?: AbortSignal,
): Promise<UploadLease> {
  const fileStat = await stat(filePath);
  const data = await readFile(filePath);
  const hash = createHash("md5").update(data).digest("hex");
  const response = (await jsonRequest(
    config,
    `${dataApiBaseUrl()}/${encodeURIComponent(config.workspaceId)}/datacenter/category/${encodeURIComponent(categoryId)}`,
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        FileName: filePath.split(/[\\/]/).pop(),
        Md5: hash,
        SizeInBytes: String(fileStat.size),
        CategoryType: "SESSION_FILE",
      }),
    },
  )) as UploadLeaseResponse;
  if (response.Data?.Param?.Url) {
    return {
      id: response.Data.FileUploadLeaseId,
      url: response.Data.Param.Url,
      method: response.Data.Param.Method ?? "PUT",
      headers: parseLeaseHeaders(response.Data.Param.Headers),
      type: response.Data.Type,
    };
  }
  if (response.data?.param?.url) {
    return {
      id: response.data.fileUploadLeaseId,
      url: response.data.param.url,
      method: response.data.param.method ?? "PUT",
      headers: parseLeaseHeaders(response.data.param.headers),
      type: response.data.type,
    };
  }
  throw new Error("Bailian did not return an upload URL");
}

export async function uploadFile(
  lease: UploadLease,
  filePath: string,
  signal?: AbortSignal,
): Promise<void> {
  let uploadUrl: URL;
  try {
    uploadUrl = new URL(lease.url);
  } catch {
    throw new Error("Bailian returned an invalid upload URL");
  }
  if (uploadUrl.protocol !== "https:") {
    throw new Error("Bailian returned a non-HTTPS upload URL");
  }
  const data = await readFile(filePath);
  const response = await fetch(uploadUrl, {
    method: lease.method,
    headers: lease.headers,
    body: data,
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `File upload failed: ${response.status} ${response.statusText}`,
    );
  }
}

export async function listModels(
  config: BailianConfig,
  signal?: AbortSignal,
): Promise<BailianModelRecord[]> {
  const base = defaultBaseUrl(config);
  const response = (await jsonRequest(config, `${base}/models`, {
    signal,
  })) as ModelListResponse;
  if (response.output?.models) {
    return response.output.models
      .map((entry) => mapModel(entry, config))
      .filter((model): model is BailianModelRecord => model !== undefined);
  }
  return (response.data ?? [])
    .map((entry) => {
      if (!entry.id) return undefined;
      return mapModel({ model: entry.id, name: entry.id }, config);
    })
    .filter((model): model is BailianModelRecord => model !== undefined);
}
