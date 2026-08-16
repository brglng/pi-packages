import { join } from "node:path";

// Extension ID, used to namespace the extension's config directory under
// `<agentDir>/extensions/`.
export const EXTENSION_ID = "pi-portable-sessions";

/** Global config directory: `<agentDir>/extensions/pi-portable-sessions/`. */
export function getGlobalConfigDir(agentDir: string): string {
  return join(agentDir, "extensions", EXTENSION_ID);
}

/** Global config file: `<agentDir>/extensions/pi-portable-sessions/config.json`. */
export function getGlobalConfigPath(agentDir: string): string {
  return join(getGlobalConfigDir(agentDir), "config.json");
}

/** Project config file: `<cwd>/.pi/extensions/pi-portable-sessions/config.json`. */
export function getProjectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
}
