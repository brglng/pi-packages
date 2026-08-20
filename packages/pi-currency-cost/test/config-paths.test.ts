import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  getWritableConfigPath,
} from "#src/config-paths";

async function tempDirs(): Promise<{ agentDir: string; cwd: string }> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-currency-cost-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-currency-cost-cwd-"));
  return { agentDir, cwd };
}

describe("getWritableConfigPath", () => {
  it("returns the project config path when a project config exists", async () => {
    const { agentDir, cwd } = await tempDirs();
    try {
      const project = getProjectConfigPath(cwd);
      await mkdir(join(project, ".."), { recursive: true });
      await writeFile(project, "{}");
      expect(await getWritableConfigPath(agentDir, cwd)).toBe(project);
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("redirects to the global path when the project config is absent", async () => {
    const { agentDir, cwd } = await tempDirs();
    try {
      expect(await getWritableConfigPath(agentDir, cwd)).toBe(
        getGlobalConfigPath(agentDir),
      );
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "throws when the project config cannot be accessed for non-ENOENT reasons",
    async () => {
      const { agentDir, cwd } = await tempDirs();
      const project = getProjectConfigPath(cwd);
      await mkdir(join(project, ".."), { recursive: true });
      await writeFile(project, "{}");
      // Block the parent directory: access() now fails with EACCES, not
      // ENOENT, and must not silently redirect to the global scope.
      await chmod(join(cwd, ".pi"), 0o000);
      try {
        await expect(getWritableConfigPath(agentDir, cwd)).rejects.toThrow();
      } finally {
        await chmod(join(cwd, ".pi"), 0o755);
        await Promise.all([
          rm(agentDir, { recursive: true, force: true }),
          rm(cwd, { recursive: true, force: true }),
        ]);
      }
    },
  );
});
