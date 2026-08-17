import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  applyFileUploadLease,
  type BailianModelRecord,
  listModels,
  type UploadLease,
  uploadFile,
} from "./api";
import {
  type BailianConfig,
  type ConfigWarnings,
  defaultBaseUrl,
  loadConfig,
} from "./config";

export const PROVIDER_ID = "bailian";
export const API_KEY_ENV = "DASHSCOPE_API_KEY";

const FALLBACK_MODELS: BailianModelRecord[] = [
  "qwen3.8-max",
  "glm-5.2",
  "deepseek-v4-flash-0731",
  "deepseek-v4-pro-0813",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen-plus",
].map((id) => ({
  id,
  name: id,
  reasoning: /deepseek|glm-5|qwen3\.(?:7|8)-max/i.test(id),
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 16384,
  api: /^(qwen|qwen3)/i.test(id) ? "openai-responses" : "openai-completions",
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false },
}));

function modelConfig(model: BailianModelRecord) {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: model.thinkingLevelMap }
      : {}),
    ...(model.compat ? { compat: model.compat } : {}),
  };
}

function formatConfigWarnings(warnings: ConfigWarnings): string {
  return warnings.length > 0
    ? `\nConfiguration warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
}

function usage(): string {
  return [
    "Usage: /bailian <subcommand>",
    "",
    "  status                         Show provider configuration",
    "  refresh                        Refresh the model catalog",
    "  upload <path> [category]      Upload a file and obtain a temporary URL",
  ].join("\n");
}

async function showStatus(
  ctx: ExtensionCommandContext,
  config: BailianConfig,
  modelCount: number,
): Promise<void> {
  const keyConfigured =
    typeof process.env[API_KEY_ENV] === "string" &&
    process.env[API_KEY_ENV] !== "";
  ctx.ui.notify(
    [
      `Provider: ${PROVIDER_ID} (Aliyun Bailian)`,
      `Plan: ${config.plan}`,
      `Workspace ID: ${config.workspaceId}`,
      `Base URL: ${defaultBaseUrl(config)}`,
      `API key: ${keyConfigured ? `${API_KEY_ENV} is set` : `${API_KEY_ENV} is not set`}`,
      `Models: ${modelCount}`,
      "Usage accounting: Pi reports provider-reported tokens; Bailian credit balance is not exposed by the documented model APIs.",
    ].join("\n"),
    keyConfigured ? "info" : "warning",
  );
}

async function runCommand(
  args: string[],
  ctx: ExtensionCommandContext,
  config: BailianConfig,
  register: (models: BailianModelRecord[]) => void,
  currentModels: () => BailianModelRecord[],
): Promise<void> {
  const [subcommand] = args;
  if (!subcommand || subcommand === "help") {
    ctx.ui.notify(usage(), "info");
    return;
  }
  if (subcommand === "status") {
    await showStatus(ctx, config, currentModels().length);
    return;
  }
  if (subcommand === "refresh") {
    try {
      const models = await listModels(config, ctx.signal);
      if (models.length === 0) throw new Error("Bailian returned no models");
      register(models);
      ctx.ui.notify(`Loaded ${models.length} Bailian models.`, "info");
    } catch (error) {
      ctx.ui.notify(
        `Could not refresh Bailian models: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
    return;
  }
  if (subcommand === "upload") {
    const [path, categoryId = "default"] = args.slice(1);
    if (!path) {
      ctx.ui.notify("Usage: /bailian upload <path> [category]", "warning");
      return;
    }
    try {
      const lease: UploadLease = await applyFileUploadLease(
        config,
        path,
        categoryId,
        ctx.signal,
      );
      await uploadFile(lease, path, ctx.signal);
      ctx.ui.notify(
        `Uploaded ${path}. Temporary upload URL: ${lease.url}`,
        "info",
      );
    } catch (error) {
      ctx.ui.notify(
        `Could not upload file to Bailian: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
    return;
  }
  ctx.ui.notify(usage(), "warning");
}

export default async function piBailianExtension(
  pi: ExtensionAPI,
): Promise<void> {
  const { config, warnings } = await loadConfig(getAgentDir(), process.cwd());
  let models = FALLBACK_MODELS;

  const register = (nextModels: BailianModelRecord[]): void => {
    models = nextModels;
    pi.registerProvider(PROVIDER_ID, {
      name: "Aliyun Bailian",
      baseUrl: defaultBaseUrl(config),
      api: "openai-completions",
      apiKey: `$${API_KEY_ENV}`,
      models: nextModels.map(modelConfig),
    });
  };

  const offline =
    process.env.PI_OFFLINE === "1" || process.env.PI_OFFLINE === "true";
  if (config.discoverModels && !offline) {
    try {
      const discovered = await listModels(config);
      if (discovered.length > 0) models = discovered;
    } catch {
      // The fallback catalog keeps Pi usable when the catalog endpoint is unavailable.
    }
  }
  register(models);

  pi.registerCommand("bailian", {
    description: "Manage the Aliyun Bailian provider and model catalog.",
    getArgumentCompletions: (prefix: string) =>
      ["status", "refresh", "upload"].flatMap((value) =>
        value.startsWith(prefix) ? [{ value, label: value }] : [],
      ),
    handler: async (args: string, ctx: ExtensionCommandContext) =>
      runCommand(
        args.trim().split(/\s+/).filter(Boolean),
        ctx,
        config,
        register,
        () => models,
      ),
  });

  if (warnings.length > 0) {
    pi.on(
      "session_start",
      async (
        _event: unknown,
        ctx: {
          ui: {
            notify: (
              message: string,
              type?: "info" | "warning" | "error",
            ) => void;
          };
        },
      ) => {
        ctx.ui.notify(formatConfigWarnings(warnings), "warning");
      },
    );
  }
}

export { listModels, mapModel } from "./api";
export { defaultBaseUrl, normalizeConfig } from "./config";
