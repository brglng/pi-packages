import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  getSessionsRoot,
  loadConfig,
  normalizeConfig,
  type PortableSessionsConfig,
  toPortableNameOptions,
} from "#src/config";
import { getGlobalConfigPath, getProjectConfigPath } from "#src/config-paths";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-portable-sessions-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});

describe("normalizeConfig", () => {
  it("returns defaults for empty input", () => {
    const { config, warnings } = normalizeConfig(undefined);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
  });

  it("accepts all fields", () => {
    const { config, warnings } = normalizeConfig({
      homeLabel: "USER",
      rootLabel: "FS",
      extraPrefixes: { "/data": "DATA" },
      notifyOnStart: false,
    });
    expect(config).toEqual({
      homeLabel: "USER",
      rootLabel: "FS",
      extraPrefixes: { "/data": "DATA" },
      notifyOnStart: false,
    });
    expect(warnings).toEqual([]);
  });

  it("warns and keeps defaults for invalid values", () => {
    const { config, warnings } = normalizeConfig({
      homeLabel: "",
      rootLabel: 42,
      extraPrefixes: ["/data"],
      notifyOnStart: "yes",
    });
    expect(config.homeLabel).toBe("HOME");
    expect(config.rootLabel).toBe("ROOT");
    expect(config.extraPrefixes).toEqual({});
    expect(config.notifyOnStart).toBe(true);
    expect(warnings).toHaveLength(4);
  });

  it("merges extraPrefixes onto the base config", () => {
    const base: PortableSessionsConfig = {
      ...DEFAULT_CONFIG,
      extraPrefixes: { "/a": "A" },
    };
    const { config } = normalizeConfig({ extraPrefixes: { "/b": "B" } }, base);
    expect(config.extraPrefixes).toEqual({ "/a": "A", "/b": "B" });
  });

  it("warns for non-object input", () => {
    const { warnings } = normalizeConfig("nope");
    expect(warnings).toHaveLength(1);
  });
});

describe("loadConfig", () => {
  it("merges global and project configs with project winning", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();

    await mkdir(join(agentDir, "extensions", "pi-portable-sessions"), {
      recursive: true,
    });
    await writeFile(
      getGlobalConfigPath(agentDir),
      JSON.stringify({
        homeLabel: "GLOBAL_HOME",
        extraPrefixes: { "/global": "G" },
      }),
    );
    await mkdir(join(cwd, ".pi", "extensions", "pi-portable-sessions"), {
      recursive: true,
    });
    await writeFile(
      getProjectConfigPath(cwd),
      JSON.stringify({
        extraPrefixes: { "/project": "P" },
      }),
    );

    const { config, warnings } = await loadConfig(agentDir, cwd);
    expect(config.homeLabel).toBe("GLOBAL_HOME");
    expect(config.rootLabel).toBe("ROOT");
    expect(config.extraPrefixes).toEqual({
      "/global": "G",
      "/project": "P",
    });
    expect(warnings).toEqual([]);
  });

  it("returns defaults when no config files exist", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    const { config, warnings } = await loadConfig(agentDir, cwd);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toEqual([]);
  });

  it("collects warnings from both files", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();

    await mkdir(join(agentDir, "extensions", "pi-portable-sessions"), {
      recursive: true,
    });
    await writeFile(
      getGlobalConfigPath(agentDir),
      JSON.stringify({ homeLabel: 1 }),
    );
    await mkdir(join(cwd, ".pi", "extensions", "pi-portable-sessions"), {
      recursive: true,
    });
    await writeFile(
      getProjectConfigPath(cwd),
      JSON.stringify({ rootLabel: 2 }),
    );

    const { config, warnings } = await loadConfig(agentDir, cwd);
    expect(config.homeLabel).toBe("HOME");
    expect(config.rootLabel).toBe("ROOT");
    expect(warnings).toHaveLength(2);
  });
});

describe("getSessionsRoot", () => {
  it("defaults to <agentDir>/sessions", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    const root = await getSessionsRoot(agentDir, cwd);
    expect(root).toBe(join(agentDir, "sessions"));
  });

  it("prefers the PI_CODING_AGENT_SESSION_DIR environment variable", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    const envDir = join(agentDir, "env-sessions");
    const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = envDir;
    try {
      const root = await getSessionsRoot(agentDir, cwd);
      expect(root).toBe(envDir);
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_SESSION_DIR;
      } else {
        process.env.PI_CODING_AGENT_SESSION_DIR = previous;
      }
    }
  });

  it("reads sessionDir from settings.json", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ sessionDir: "custom/sessions" }),
    );
    const root = await getSessionsRoot(agentDir, cwd);
    expect(root).toBe(join(cwd, "custom", "sessions"));
  });

  it("prefers the environment variable over settings.json", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ sessionDir: "custom/sessions" }),
    );
    const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = join(agentDir, "env-sessions");
    try {
      const root = await getSessionsRoot(agentDir, cwd);
      expect(root).toBe(join(agentDir, "env-sessions"));
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_SESSION_DIR;
      } else {
        process.env.PI_CODING_AGENT_SESSION_DIR = previous;
      }
    }
  });

  it("ignores an empty sessionDir in settings.json", async () => {
    const agentDir = await makeTempDir();
    const cwd = await makeTempDir();
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ sessionDir: "" }),
    );
    const root = await getSessionsRoot(agentDir, cwd);
    expect(root).toBe(join(agentDir, "sessions"));
  });
});

describe("toPortableNameOptions", () => {
  it("maps the config fields onto portable-name options", () => {
    const config: PortableSessionsConfig = {
      homeLabel: "USER",
      rootLabel: "FS",
      extraPrefixes: { "/data": "DATA" },
      notifyOnStart: false,
    };
    expect(toPortableNameOptions(config)).toEqual({
      homeLabel: "USER",
      rootLabel: "FS",
      extraPrefixes: { "/data": "DATA" },
    });
  });
});
