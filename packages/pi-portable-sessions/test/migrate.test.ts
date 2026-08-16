import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type PortableSessionsConfig } from "#src/config";
import {
  defaultSessionDirName,
  findPendingMigrations,
  migrateAllSessionDirs,
  migrateNamedSessionDirs,
  migrateSessionDir,
} from "#src/migrate";
import { portableSessionDirName } from "#src/portable-name";

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

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

const config: PortableSessionsConfig = { ...DEFAULT_CONFIG };

describe("defaultSessionDirName", () => {
  it("matches Pi's encoding: strip leading separator, replace /\\: with -", () => {
    expect(defaultSessionDirName("/Users/zpan/my-project")).toBe(
      "--Users-zpan-my-project--",
    );
  });
});

describe("migrateSessionDir", () => {
  it("renames the default directory to the portable name and leaves a symlink", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, "20240101_abc.jsonl"), "line\n");

    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("migrated-now");
    expect(result.portableName).toBe(portableSessionDirName(cwd, config));

    const sessionFile = join(result.portableDir, "20240101_abc.jsonl");
    expect(await readFile(sessionFile, "utf8")).toBe("line\n");

    const link = await lstat(result.defaultDir);
    expect(link.isSymbolicLink()).toBe(true);
  });

  it("is idempotent: reports migrated on a second run", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, "20240101_abc.jsonl"), "line\n");

    await migrateSessionDir(cwd, config, { sessionsRoot });
    const again = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(again.state).toBe("migrated");
  });

  it("merges into an existing portable directory without overwriting", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableDir = join(sessionsRoot, portableSessionDirName(cwd, config));
    await mkdir(defaultDir, { recursive: true });
    await mkdir(portableDir, { recursive: true });
    await writeFile(join(defaultDir, "keep.jsonl"), "old\n");
    await writeFile(join(defaultDir, "new.jsonl"), "new\n");
    await writeFile(join(portableDir, "keep.jsonl"), "keep\n");

    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("migrated-now");
    expect(result.filesMerged).toBe(1);
    expect(await readFile(join(portableDir, "keep.jsonl"), "utf8")).toBe(
      "keep\n",
    );
    expect(await readFile(join(portableDir, "new.jsonl"), "utf8")).toBe(
      "new\n",
    );
  });

  it("reports same-named jsonl conflicts when no conflict handler is given", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableDir = join(sessionsRoot, portableSessionDirName(cwd, config));
    await mkdir(defaultDir, { recursive: true });
    await mkdir(portableDir, { recursive: true });
    await writeFile(join(defaultDir, "same.jsonl"), "source\n");
    await writeFile(join(portableDir, "same.jsonl"), "target\n");

    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("migrated-now");
    expect(result.jsonlConflicts).toBe(1);
    expect(result.jsonlMerged).toBe(0);
    expect(result.jsonlPreserved).toBe(1);
    // Without a handler the existing target file is kept untouched, and the
    // source file is preserved under a -conflicted name (no data loss).
    expect(await readFile(join(portableDir, "same.jsonl"), "utf8")).toBe(
      "target\n",
    );
    expect(
      await readFile(join(portableDir, "same-conflicted.jsonl"), "utf8"),
    ).toBe("source\n");
  });

  it("merges same-named jsonl files through the conflict handler", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableDir = join(sessionsRoot, portableSessionDirName(cwd, config));
    await mkdir(defaultDir, { recursive: true });
    await mkdir(portableDir, { recursive: true });
    await writeFile(join(defaultDir, "same.jsonl"), "source\n");
    await writeFile(join(portableDir, "same.jsonl"), "target\n");

    const result = await migrateSessionDir(cwd, config, {
      sessionsRoot,
      onJsonlConflict: async (sourceFile, targetFile) => {
        const source = await readFile(sourceFile, "utf8");
        await writeFile(targetFile, `merged(${source.trim()})\n`);
        return true;
      },
    });
    expect(result.jsonlConflicts).toBe(1);
    expect(result.jsonlMerged).toBe(1);
    expect(result.jsonlPreserved).toBe(0);
    expect(await readFile(join(portableDir, "same.jsonl"), "utf8")).toBe(
      "merged(source)\n",
    );
  });

  it("counts conflicts the handler declines as unmerged", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableDir = join(sessionsRoot, portableSessionDirName(cwd, config));
    await mkdir(defaultDir, { recursive: true });
    await mkdir(portableDir, { recursive: true });
    await writeFile(join(defaultDir, "same.jsonl"), "source\n");
    await writeFile(join(portableDir, "same.jsonl"), "target\n");

    const result = await migrateSessionDir(cwd, config, {
      sessionsRoot,
      onJsonlConflict: async () => false,
    });
    expect(result.jsonlConflicts).toBe(1);
    expect(result.jsonlMerged).toBe(0);
    expect(result.jsonlPreserved).toBe(1);
    expect(await readFile(join(portableDir, "same.jsonl"), "utf8")).toBe(
      "target\n",
    );
    expect(
      await readFile(join(portableDir, "same-conflicted.jsonl"), "utf8"),
    ).toBe("source\n");
  });

  it("dry run leaves the default directory untouched", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, "20240101_abc.jsonl"), "line\n");

    const result = await migrateSessionDir(cwd, config, {
      sessionsRoot,
      dryRun: true,
    });
    expect(result.state).toBe("would-migrate");
    const info = await lstat(defaultDir);
    expect(info.isDirectory()).toBe(true);
    expect(info.isSymbolicLink()).toBe(false);
  });

  it("reports no-sessions when the default directory does not exist", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("no-sessions");
  });

  it("reports portable-only when only the portable directory exists", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const portableDir = join(sessionsRoot, portableSessionDirName(cwd, config));
    await mkdir(portableDir, { recursive: true });

    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("portable-only");
  });

  it("reports conflict when the default path is a symlink elsewhere", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    await mkdir(sessionsRoot, { recursive: true });
    await symlink(elsewhere, defaultDir, "dir");

    const result = await migrateSessionDir(cwd, config, { sessionsRoot });
    expect(result.state).toBe("conflict");
  });

  it("requires sessionsRoot", async () => {
    await expect(migrateSessionDir("/some/cwd", config)).rejects.toThrow(
      /sessionsRoot/,
    );
  });
});

describe("migrateAllSessionDirs", () => {
  function sessionFile(dir: string, cwd: string, name: string): string {
    return join(dir, defaultSessionDirName(cwd), `${name}.jsonl`);
  }

  async function writeSession(dir: string, cwd: string, name: string) {
    const target = sessionFile(dir, cwd, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify({ type: "session", version: 3, cwd })}\nentry\n`,
    );
  }

  it("migrates every default-named directory under the sessions root", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwdA = join(root, "project-a");
    const cwdB = join(root, "project-b");
    await writeSession(sessionsRoot, cwdA, "20240101_aaa");
    await writeSession(sessionsRoot, cwdB, "20240102_bbb");

    const results = await migrateAllSessionDirs(config, { sessionsRoot });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.state === "migrated-now")).toBe(true);

    for (const cwd of [cwdA, cwdB]) {
      const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
      const portableDir = join(
        sessionsRoot,
        portableSessionDirName(cwd, config),
      );
      const info = await lstat(defaultDir);
      expect(info.isSymbolicLink()).toBe(true);
      expect(await exists(portableDir)).toBe(true);
    }
  });

  it("is idempotent across runs", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    await writeSession(sessionsRoot, cwd, "20240101_aaa");

    await migrateAllSessionDirs(config, { sessionsRoot });
    const again = await migrateAllSessionDirs(config, { sessionsRoot });
    expect(again.every((r) => r.state === "migrated")).toBe(true);
  });

  it("returns an empty list when the sessions root is missing", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "missing");
    const results = await migrateAllSessionDirs(config, { sessionsRoot });
    expect(results).toEqual([]);
  });
});

describe("findPendingMigrations", () => {
  async function writeSession(dir: string, cwd: string, name: string) {
    const target = join(dir, defaultSessionDirName(cwd), `${name}.jsonl`);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify({ type: "session", version: 3, cwd })}\nentry\n`,
    );
  }

  it("lists default-named directories that are not migrated yet", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwdA = join(root, "project-a");
    const cwdB = join(root, "project-b");
    await writeSession(sessionsRoot, cwdA, "20240101_aaa");
    await writeSession(sessionsRoot, cwdB, "20240102_bbb");

    const pending = await findPendingMigrations(config, { sessionsRoot });
    expect(pending).toHaveLength(2);
    expect(pending[0].cwd).toBe(cwdA);
    expect(pending[0].defaultDirName).toBe(defaultSessionDirName(cwdA));
    expect(pending[0].portableName).toBe(portableSessionDirName(cwdA, config));
  });

  it("excludes directories that are already symlinks (migrated)", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    await writeSession(sessionsRoot, cwd, "20240101_aaa");
    await migrateSessionDir(cwd, config, { sessionsRoot });

    const pending = await findPendingMigrations(config, { sessionsRoot });
    expect(pending).toEqual([]);
  });

  it("excludes directories whose portable name already matches", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    // A default-named directory whose portable name equals its own name would
    // already be portable; build one via extraPrefixes mapping the whole dir.
    const cwd = join(root, "project");
    const portableName = portableSessionDirName(cwd, config);
    const dir = join(sessionsRoot, portableName);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "20240101_aaa.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, cwd })}\nentry\n`,
    );

    const pending = await findPendingMigrations(config, { sessionsRoot });
    expect(pending).toEqual([]);
  });

  it("returns an empty list when the sessions root is missing", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "missing");
    const pending = await findPendingMigrations(config, { sessionsRoot });
    expect(pending).toEqual([]);
  });
});

describe("migrateNamedSessionDirs", () => {
  async function writeSession(dir: string, cwd: string, name: string) {
    const target = join(dir, defaultSessionDirName(cwd), `${name}.jsonl`);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify({ type: "session", version: 3, cwd })}\nentry\n`,
    );
  }

  it("migrates the named default-named directories", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwdA = join(root, "project-a");
    const cwdB = join(root, "project-b");
    const cwdC = join(root, "project-c");
    await writeSession(sessionsRoot, cwdA, "20240101_aaa");
    await writeSession(sessionsRoot, cwdB, "20240102_bbb");
    await writeSession(sessionsRoot, cwdC, "20240103_ccc");

    const results = await migrateNamedSessionDirs(
      [defaultSessionDirName(cwdA), defaultSessionDirName(cwdB)],
      config,
      { sessionsRoot },
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.state === "migrated-now")).toBe(true);
    // Only the named projects migrated; project-c is untouched.
    expect(await exists(join(sessionsRoot, defaultSessionDirName(cwdC)))).toBe(
      true,
    );
    // A symlink is left at the migrated default paths.
    const link = await lstat(join(sessionsRoot, defaultSessionDirName(cwdA)));
    expect(link.isSymbolicLink()).toBe(true);
  });

  it("accepts absolute working directory paths", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    await writeSession(sessionsRoot, cwd, "20240101_aaa");

    const results = await migrateNamedSessionDirs([cwd], config, {
      sessionsRoot,
    });
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("migrated-now");
  });

  it("reports and skips unknown directory names", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const results = await migrateNamedSessionDirs(
      ["--does-not-exist--"],
      config,
      { sessionsRoot },
    );
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("no-sessions");
  });
});
