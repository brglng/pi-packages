import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type BailianPlan = "token-plan" | "coding-plan" | "custom";

export interface BailianConfig {
  /** Workspace ID used in the dedicated Bailian endpoint host. */
  workspaceId: string;
  /** Plan label used for display and endpoint defaults. */
  plan: BailianPlan;
  /** Optional custom API base URL, including /compatible-mode/v1. */
  baseUrl: string | undefined;
  /** Whether to query the Bailian model catalog at startup and on refresh. */
  discoverModels: boolean;
  /** Whether to use the Responses API for models listed as supporting it. */
  preferResponses: boolean;
}

export const DEFAULT_CONFIG: BailianConfig = {
  workspaceId: "token-plan",
  plan: "token-plan",
  baseUrl: undefined,
  discoverModels: true,
  preferResponses: true,
};

export type ConfigWarnings = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readPlan(value: unknown): BailianPlan | undefined {
  if (value === "token-plan" || value === "coding-plan" || value === "custom") {
    return value;
  }
  return undefined;
}

function applyStringField(
  raw: Record<string, unknown>,
  key: "workspaceId" | "baseUrl",
  config: BailianConfig,
  warnings: ConfigWarnings,
): void {
  const value = raw[key];
  if (value === undefined) return;
  if (key === "baseUrl" && value === null) {
    config.baseUrl = undefined;
    return;
  }
  if (!nonEmptyString(value)) {
    warnings.push(
      `${key} must be a non-empty string${key === "baseUrl" ? " or null" : ""}; ignoring`,
    );
    return;
  }
  if (key === "workspaceId") config.workspaceId = value.trim();
  else config.baseUrl = value.trim().replace(/\/$/, "");
}

function applyBooleanField(
  raw: Record<string, unknown>,
  key: "discoverModels" | "preferResponses",
  config: BailianConfig,
  warnings: ConfigWarnings,
): void {
  const value = raw[key];
  if (value === undefined) return;
  if (typeof value === "boolean") {
    config[key] = value;
    return;
  }
  warnings.push(`${key} must be a boolean; ignoring`);
}

export function normalizeConfig(
  raw: unknown,
  base: BailianConfig = DEFAULT_CONFIG,
): { config: BailianConfig; warnings: ConfigWarnings } {
  const config = { ...base };
  const warnings: ConfigWarnings = [];
  if (raw === undefined || raw === null) return { config, warnings };
  if (!isRecord(raw)) {
    warnings.push("config must be a JSON object; ignoring");
    return { config, warnings };
  }

  applyStringField(raw, "workspaceId", config, warnings);
  if (raw.plan !== undefined) {
    const plan = readPlan(raw.plan);
    if (plan) config.plan = plan;
    else {
      warnings.push(
        'plan must be "token-plan", "coding-plan", or "custom"; ignoring',
      );
    }
  }
  applyStringField(raw, "baseUrl", config, warnings);
  applyBooleanField(raw, "discoverModels", config, warnings);
  applyBooleanField(raw, "preferResponses", config, warnings);
  return { config, warnings };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function globalConfigPath(agentDir: string): string {
  return join(agentDir, "extensions", "pi-bailian", "config.json");
}

function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", "pi-bailian", "config.json");
}

export async function loadConfig(
  agentDir: string,
  cwd: string,
): Promise<{ config: BailianConfig; warnings: ConfigWarnings }> {
  const [globalRaw, projectRaw] = await Promise.all([
    readJson(globalConfigPath(agentDir)),
    readJson(projectConfigPath(cwd)),
  ]);
  const global = normalizeConfig(globalRaw);
  const project = normalizeConfig(projectRaw, global.config);
  return {
    config: project.config,
    warnings: [...global.warnings, ...project.warnings],
  };
}

export function defaultBaseUrl(config: BailianConfig): string {
  if (config.baseUrl) return config.baseUrl;
  if (config.plan === "coding-plan")
    return "https://coding.dashscope.aliyuncs.com/v1";
  return `https://${encodeURIComponent(config.workspaceId)}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`;
}

export function dataApiBaseUrl(): string {
  return "https://bailian.cn-beijing.aliyuncs.com";
}
