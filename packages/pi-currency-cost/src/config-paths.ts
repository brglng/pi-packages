import { access } from "node:fs/promises";
import { join } from "node:path";

// Extension ID, used to namespace the extension's config directory under
// `<agentDir>/extensions/`.
export const EXTENSION_ID = "pi-currency-cost";

/** Global config directory: `<agentDir>/extensions/pi-currency-cost/`. */
export function getGlobalConfigDir(agentDir: string): string {
  return join(agentDir, "extensions", EXTENSION_ID);
}

/** Global config file: `<agentDir>/extensions/pi-currency-cost/config.json`. */
export function getGlobalConfigPath(agentDir: string): string {
  return join(getGlobalConfigDir(agentDir), "config.json");
}

/** Project config file: `<cwd>/.pi/extensions/pi-currency-cost/config.json`. */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
}

/**
 * The config file the extension writes to. The project config is the writable
 * effective config when a project config file exists; otherwise the global
 * config path is used. Only an absent project config (ENOENT) redirects to
 * the global scope: permission or other access failures throw so writes can
 * never silently land in another scope.
 */
export async function getWritableConfigPath(
  agentDir: string,
  cwd: string,
): Promise<string> {
  const project = getProjectConfigPath(cwd);
  try {
    await access(project);
    return project;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return getGlobalConfigPath(agentDir);
    }
    throw error;
  }
}
