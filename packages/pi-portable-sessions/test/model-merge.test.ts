import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MergeExecutor, mergeJsonlWithModel } from "#src/model-merge";

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

/** Extract the temp session dir from the PI_CODING_AGENT_SESSION_DIR env arg. */
function envArg(execArgs: string[]): { sessionDir: string; prompt: string } {
  const envEntry = execArgs[0];
  const sessionDir = envEntry.slice("PI_CODING_AGENT_SESSION_DIR=".length);
  return { sessionDir, prompt: execArgs[execArgs.length - 1] };
}

/** Extract a required capture group or throw. */
function requiredMatch(prompt: string, pattern: RegExp): string {
  const match = prompt.match(pattern);
  if (match === null) {
    throw new Error(`expected pattern not found: ${pattern}`);
  }
  return match[1];
}

/** A fake model that concatenates both files into the target. */
function concatMergeExecutor(): {
  executor: MergeExecutor;
  spy: ReturnType<typeof vi.fn>;
  sessionDirsSeen: string[];
} {
  const sessionDirsSeen: string[] = [];
  const spy = vi.fn(async (command: string, args: string[]) => {
    expect(command).toBe("env");
    expect(args).toContain("pi");
    expect(args).toContain("-p");
    expect(args).toContain("--no-session");
    const { sessionDir, prompt } = envArg(args);
    sessionDirsSeen.push(sessionDir);
    expect(prompt).toContain("session merge helper");
    expect(prompt).toContain("source: ");
    expect(prompt).toContain("target: ");

    // Simulate the model: the temp session dir must exist while merging.
    const info = await lstat(sessionDir);
    expect(info.isDirectory()).toBe(true);

    const sourceLine = requiredMatch(prompt, /source: (\S+)/);
    const targetLine = requiredMatch(prompt, /target: (\S+)/);
    const source = await readFile(sourceLine, "utf8");
    const target = await readFile(targetLine, "utf8");
    await writeFile(targetLine, `${target}${source}`);
    return { code: 0 };
  });
  return {
    executor: { exec: spy as unknown as MergeExecutor["exec"] },
    spy,
    sessionDirsSeen,
  };
}

describe("mergeJsonlWithModel", () => {
  it("runs a nested pi -p --no-session with an isolated session dir and cleans up", async () => {
    const root = await makeTempDir();
    const sourceFile = join(root, "source.jsonl");
    const targetFile = join(root, "target.jsonl");
    await writeFile(sourceFile, "source-line\n");
    await writeFile(targetFile, "target-line\n");

    const { executor, spy, sessionDirsSeen } = concatMergeExecutor();
    const ok = await mergeJsonlWithModel(sourceFile, targetFile, executor);

    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    expect(sessionDirsSeen).toHaveLength(1);
    // The isolated temp session dir is deleted after the merge.
    await expect(lstat(sessionDirsSeen[0])).rejects.toMatchObject({
      code: "ENOENT",
    });
    // The fake model merged both files into the target.
    expect(await readFile(targetFile, "utf8")).toBe(
      "target-line\nsource-line\n",
    );
  });

  it("returns false on a non-zero exit code", async () => {
    const root = await makeTempDir();
    const sourceFile = join(root, "source.jsonl");
    const targetFile = join(root, "target.jsonl");
    await writeFile(sourceFile, "a\n");
    await writeFile(targetFile, "b\n");

    const ok = await mergeJsonlWithModel(sourceFile, targetFile, {
      exec: async () => ({ code: 1 }),
    });
    expect(ok).toBe(false);
  });

  it("returns false when the executor throws and still cleans up the temp dir", async () => {
    const root = await makeTempDir();
    const sourceFile = join(root, "source.jsonl");
    const targetFile = join(root, "target.jsonl");
    await writeFile(sourceFile, "a\n");
    await writeFile(targetFile, "b\n");

    const seen: string[] = [];
    const ok = await mergeJsonlWithModel(sourceFile, targetFile, {
      exec: async (_command, args) => {
        const { sessionDir } = envArg(args);
        seen.push(sessionDir);
        throw new Error("nested pi failed");
      },
    });
    expect(ok).toBe(false);
    expect(seen).toHaveLength(1);
    await expect(lstat(seen[0])).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("mergeJsonlWithModel as a conflict handler in a real migration", () => {
  it("merges a same-named jsonl conflict end to end without touching the real sessions root", async () => {
    const root = await makeTempDir();
    const sessionsRoot = join(root, "sessions");
    const cwd = join(root, "project");
    // Reuse the extension's own naming helpers to build the fixture.
    const { defaultSessionDirName } = await import("#src/migrate");
    const { portableSessionDirName } = await import("#src/portable-name");
    const { DEFAULT_CONFIG } = await import("#src/config");
    const { migrateSessionDir } = await import("#src/migrate");

    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableDir = join(
      sessionsRoot,
      portableSessionDirName(cwd, DEFAULT_CONFIG),
    );
    await mkdir(defaultDir, { recursive: true });
    await mkdir(portableDir, { recursive: true });
    await writeFile(join(defaultDir, "same.jsonl"), "source-line\n");
    await writeFile(join(portableDir, "same.jsonl"), "target-line\n");

    const { executor, spy } = concatMergeExecutor();
    const result = await migrateSessionDir(cwd, DEFAULT_CONFIG, {
      sessionsRoot,
      onJsonlConflict: (source, target) =>
        mergeJsonlWithModel(source, target, executor),
    });

    expect(result.state).toBe("migrated-now");
    expect(result.jsonlConflicts).toBe(1);
    expect(result.jsonlMerged).toBe(1);
    expect(result.jsonlPreserved).toBe(0);
    expect(spy).toHaveBeenCalledOnce();
    expect(await readFile(join(portableDir, "same.jsonl"), "utf8")).toBe(
      "target-line\nsource-line\n",
    );
    // The default path is now a symlink to the portable dir.
    const link = await lstat(defaultDir);
    expect(link.isSymbolicLink()).toBe(true);
  });
});
