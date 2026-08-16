import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getGlobalConfigPath, getProjectConfigPath } from "./config-paths";
import type { PortableNameOptions } from "./portable-name";

/**
 * Resolved extension configuration. The migration source root (Pi's session
 * directory) is resolved from Pi itself (see {@link getSessionsRoot}); the
 * portable storage root is configurable via `portableRoot`.
 */
export interface PortableSessionsConfig {
  /** Label replacing the home directory prefix. Default: "HOME". */
  homeLabel: string;
  /** Label replacing the root directory prefix. Default: "ROOT". */
  rootLabel: string;
  /** Map of additional absolute path prefixes to portable labels. */
  extraPrefixes: Record<string, string>;
  /**
   * After Pi starts, notify which session directories can be migrated and the
   * command to run. Default: true.
   */
  notifyOnStart: boolean;
  /**
   * Root directory holding the portable session directories (outside Pi's own
   * sessions root). `undefined` means `<agentDir>/portable-sessions`.
   */
  portableRoot: string | undefined;
}

export const DEFAULT_CONFIG: PortableSessionsConfig = {
  homeLabel: "HOME",
  rootLabel: "ROOT",
  extraPrefixes: {},
  notifyOnStart: true,
  portableRoot: undefined,
};

/** Warnings collected while normalizing/merging raw config values. */
export type ConfigWarnings = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Normalize one raw config object (global or project) onto a base config.
 * Invalid entries are skipped and reported as warnings; the extension keeps
 * working with defaults rather than failing to load.
 */
export function normalizeConfig(
  raw: unknown,
  base: PortableSessionsConfig = DEFAULT_CONFIG,
): { config: PortableSessionsConfig; warnings: ConfigWarnings } {
  const config: PortableSessionsConfig = { ...base };
  const warnings: ConfigWarnings = [];
  if (raw === undefined || raw === null) {
    return { config, warnings };
  }
  if (!isRecord(raw)) {
    warnings.push("config must be a JSON object; ignoring");
    return { config, warnings };
  }
  if (raw.homeLabel !== undefined) {
    if (isNonEmptyString(raw.homeLabel)) {
      config.homeLabel = raw.homeLabel;
    } else {
      warnings.push("homeLabel must be a non-empty string; ignoring");
    }
  }
  if (raw.rootLabel !== undefined) {
    if (isNonEmptyString(raw.rootLabel)) {
      config.rootLabel = raw.rootLabel;
    } else {
      warnings.push("rootLabel must be a non-empty string; ignoring");
    }
  }
  if (raw.extraPrefixes !== undefined) {
    if (isStringRecord(raw.extraPrefixes)) {
      config.extraPrefixes = { ...config.extraPrefixes, ...raw.extraPrefixes };
    } else {
      warnings.push(
        "extraPrefixes must be an object of string values; ignoring",
      );
    }
  }
  if (raw.notifyOnStart !== undefined) {
    if (typeof raw.notifyOnStart === "boolean") {
      config.notifyOnStart = raw.notifyOnStart;
    } else {
      warnings.push("notifyOnStart must be a boolean; ignoring");
    }
  }
  if (raw.portableRoot !== undefined) {
    if (isNonEmptyString(raw.portableRoot)) {
      config.portableRoot = raw.portableRoot;
    } else {
      warnings.push("portableRoot must be a non-empty string; ignoring");
    }
  }
  return { config, warnings };
}

async function readConfigFile(path: string): Promise<unknown> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Load and merge the global config (`<agentDir>/extensions/pi-portable-sessions/config.json`)
 * and the project config (`<cwd>/.pi/extensions/pi-portable-sessions/config.json`).
 * Project values override global values; `extraPrefixes` maps are merged.
 */
export async function loadConfig(
  agentDir: string,
  cwd: string,
): Promise<{ config: PortableSessionsConfig; warnings: ConfigWarnings }> {
  const [globalRaw, projectRaw] = await Promise.all([
    readConfigFile(getGlobalConfigPath(agentDir)),
    readConfigFile(getProjectConfigPath(cwd)),
  ]);
  const global = normalizeConfig(globalRaw);
  const project = normalizeConfig(projectRaw, global.config);
  return {
    config: project.config,
    warnings: [...global.warnings, ...project.warnings],
  };
}

/** Build portable-name options from the resolved config. */
export function toPortableNameOptions(
  config: PortableSessionsConfig,
): PortableNameOptions {
  return {
    homeLabel: config.homeLabel,
    rootLabel: config.rootLabel,
    extraPrefixes: config.extraPrefixes,
  };
}

/**
 * Resolve the portable storage root: expands `~`, rejects non-absolute
 * values. Falls back to `defaultRoot` when the config leaves it unset.
 */
export function resolvePortableRoot(
  config: PortableSessionsConfig,
  defaultRoot: string,
): string {
  if (config.portableRoot === undefined) {
    return defaultRoot;
  }
  const expanded = config.portableRoot.replace(/^~(?=\/|\\|$)/, homedir());
  const resolved = resolve(expanded);
  if (!isAbsolute(resolved)) {
    throw new Error(
      `portableRoot must be an absolute path: ${config.portableRoot}`,
    );
  }
  return resolved;
}

/** Environment variable Pi uses to override the session directory. */
const ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR";

function expandTilde(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

async function readSettingsSessionDir(
  agentDir: string,
  cwd: string,
): Promise<string | undefined> {
  try {
    const text = await readFile(join(agentDir, "settings.json"), "utf8");
    const settings = JSON.parse(text) as { sessionDir?: unknown };
    if (typeof settings.sessionDir === "string" && settings.sessionDir !== "") {
      const expanded = expandTilde(settings.sessionDir);
      return isAbsolute(expanded) ? expanded : join(cwd, expanded);
    }
  } catch {
    // No settings file or unparseable content — fall back to the default.
  }
  return undefined;
}

/**
 * Resolve Pi's session root directory, mirroring Pi's own precedence:
 *
 * 1. `PI_CODING_AGENT_SESSION_DIR` environment variable.
 * 2. `sessionDir` in `<agentDir>/settings.json` (relative values resolve
 *    against `cwd`).
 * 3. The default `<agentDir>/sessions`.
 *
 * The CLI `--session-dir` flag cannot be observed from an extension, so it is
 * not covered; extensions load after Pi has already chosen the directory.
 */
export async function getSessionsRoot(
  agentDir: string,
  cwd: string,
): Promise<string> {
  const envDir = process.env[ENV_SESSION_DIR];
  if (envDir !== undefined && envDir !== "") {
    return resolve(expandTilde(envDir));
  }
  const settingsDir = await readSettingsSessionDir(agentDir, cwd);
  if (settingsDir !== undefined) {
    return settingsDir;
  }
  return join(agentDir, "sessions");
}
