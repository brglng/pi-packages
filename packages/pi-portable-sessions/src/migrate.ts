import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { PortableSessionsConfig } from "./config";
import { portableSessionDirName, toPosixAbsolute } from "./portable-name";

/**
 * Compute Pi's default session directory name for a working directory,
 * mirroring Pi's own encoding: strip the leading separator, then replace `/`,
 * `\`, and `:` with `-`, wrapped in `--...--`.
 */
export function defaultSessionDirName(cwd: string): string {
  const resolved = resolve(cwd);
  const safe = resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
  return `--${safe}--`;
}

/** Lifecycle state of one migration target directory. */
export type MigrationState =
  | "no-sessions"
  | "already-portable"
  | "migrated"
  | "migrated-now"
  | "would-migrate"
  | "portable-only"
  | "conflict";

/** Outcome of migrating one working directory's session directory. */
export interface MigrationResult {
  /** Working directory the session directory belongs to. */
  cwd: string;
  /** Pi's default session directory (the `--<encoded-cwd>--` path). */
  defaultDir: string;
  /** The portable directory name (e.g. `HOME%2Fmy-project`). */
  portableName: string;
  /** The absolute portable session directory. */
  portableDir: string;
  state: MigrationState;
  /** Files copied into an already-existing portable directory. */
  filesMerged: number;
  /**
   * Same-named `.jsonl` files that already existed in the target directory.
   */
  jsonlConflicts: number;
  /** Conflicts resolved by the `onJsonlConflict` handler (merged in place). */
  jsonlMerged: number;
  /**
   * Conflicts left unresolved (no handler, or the handler returned `false`),
   * whose source file was preserved under a `-conflicted` name to avoid data
   * loss.
   */
  jsonlPreserved: number;
  /** Human-readable detail for the summary report. */
  note?: string;
}

/**
 * Merge handler for two same-named session files. Receives the source file
 * (the directory being migrated) and the target file (the file that already
 * exists in the portable directory). Must return `true` when the conflict was
 * resolved (the target file now contains the merged content), `false` to keep
 * the existing target file untouched.
 */
export type JsonlConflictHandler = (
  sourceFile: string,
  targetFile: string,
) => Promise<boolean>;

export interface MigrateOptions {
  /** Only compute what would change; do not move files or create links. */
  dryRun?: boolean;
  /** Pi's sessions root (the migration source). Required. */
  sessionsRoot?: string;
  /**
   * Root directory holding the portable session directories. Defaults to
   * `<sessionsRoot>/../portable-sessions`.
   */
  portableRoot?: string;
  /**
   * Called for every same-named `.jsonl` file that already exists in the
   * target portable directory, so the caller can merge the contents (e.g. with
   * a model). When omitted, such files are skipped and reported as conflicts.
   */
  onJsonlConflict?: JsonlConflictHandler;
}

function requireSessionsRoot(options: MigrateOptions): string {
  if (options.sessionsRoot === undefined) {
    throw new Error(
      "MigrateOptions.sessionsRoot is required (use Pi's sessions root)",
    );
  }
  return options.sessionsRoot;
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function sameRealPath(a: string, b: string): Promise<boolean> {
  try {
    const aReal = await realpath(a);
    const bReal = await realpath(b);
    return aReal === bReal;
  } catch {
    return false;
  }
}

/** Move a directory, falling back to copy+delete across devices (EXDEV). */
async function moveDir(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await cp(source, target, { recursive: true });
    await rm(source, { recursive: true, force: true });
  }
}

interface MergeOutcome {
  filesMerged: number;
  jsonlConflicts: number;
  jsonlMerged: number;
  jsonlPreserved: number;
}

/** Preserved-conflict filenames should sort after the original. */
function conflictedName(entry: string): string {
  const base = entry.endsWith(".jsonl") ? entry.slice(0, -6) : entry;
  return `${base}-conflicted.jsonl`;
}

/**
 * Merge the contents of `source` into `target`. Files absent from `target` are
 * copied; same-named `.jsonl` files are content conflicts and are handed to
 * `onJsonlConflict` when provided. Conflicts that stay unresolved (no handler,
 * or the handler declined) have their source file preserved under a
 * `-conflicted` name so no session data is lost.
 */
async function mergeDir(
  source: string,
  target: string,
  onJsonlConflict: JsonlConflictHandler | undefined,
): Promise<MergeOutcome> {
  const [sourceEntries, targetEntries] = await Promise.all([
    readdir(source),
    readdir(target),
  ]);
  const targetSet = new Set(targetEntries);
  const outcome: MergeOutcome = {
    filesMerged: 0,
    jsonlConflicts: 0,
    jsonlMerged: 0,
    jsonlPreserved: 0,
  };
  for (const entry of sourceEntries) {
    const sourceFile = join(source, entry);
    const targetFile = join(target, entry);
    if (!targetSet.has(entry)) {
      await cp(sourceFile, targetFile, { recursive: true });
      outcome.filesMerged += 1;
      continue;
    }
    if (!entry.endsWith(".jsonl")) {
      continue;
    }
    outcome.jsonlConflicts += 1;
    if (onJsonlConflict !== undefined) {
      const resolved = await onJsonlConflict(sourceFile, targetFile);
      if (resolved) {
        outcome.jsonlMerged += 1;
        continue;
      }
    }
    // Unresolved: keep the source file under a distinct name.
    await cp(sourceFile, join(target, conflictedName(entry)), {
      recursive: true,
    });
    outcome.jsonlPreserved += 1;
  }
  return outcome;
}

/**
 * Migrate one working directory's session directory to its portable name.
 *
 * Pi hard-codes the `--<encoded-cwd>--` directory name, so the physical
 * directory is renamed to the portable name and a symlink is left at Pi's
 * default path pointing at the new location. Pi keeps writing through the
 * symlink, so the current session, `/resume`, and future startups all keep
 * working while the on-disk name becomes portable.
 */
export async function migrateSessionDir(
  cwd: string,
  config: PortableSessionsConfig,
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  const sessionsRoot = requireSessionsRoot(options);
  const portableRoot =
    options.portableRoot ?? join(sessionsRoot, "..", "portable-sessions");
  const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
  const portableName = portableSessionDirName(cwd, config);
  const portableDir = join(portableRoot, portableName);

  const base: Omit<MigrationResult, "state"> = {
    cwd,
    defaultDir,
    portableName,
    portableDir,
    filesMerged: 0,
    jsonlConflicts: 0,
    jsonlMerged: 0,
    jsonlPreserved: 0,
  };

  if (!(await exists(defaultDir))) {
    if (await exists(portableDir)) {
      return { ...base, state: "portable-only" };
    }
    return { ...base, state: "no-sessions" };
  }

  if (await isSymlink(defaultDir)) {
    if (await sameRealPath(defaultDir, portableDir)) {
      return { ...base, state: "migrated" };
    }
    return {
      ...base,
      state: "conflict",
      note: "default path is a symlink to somewhere else; leaving untouched",
    };
  }

  if (toPosixAbsolute(defaultDir) === toPosixAbsolute(portableDir)) {
    return { ...base, state: "already-portable" };
  }

  if (options.dryRun) {
    return { ...base, state: "would-migrate" };
  }

  await mkdir(portableRoot, { recursive: true });
  let filesMerged = 0;
  let jsonlConflicts = 0;
  let jsonlMerged = 0;
  let jsonlPreserved = 0;
  if (await exists(portableDir)) {
    const outcome = await mergeDir(
      defaultDir,
      portableDir,
      options.onJsonlConflict,
    );
    filesMerged = outcome.filesMerged;
    jsonlConflicts = outcome.jsonlConflicts;
    jsonlMerged = outcome.jsonlMerged;
    jsonlPreserved = outcome.jsonlPreserved;
    await rm(defaultDir, { recursive: true, force: true });
  } else {
    await moveDir(defaultDir, portableDir);
  }
  await symlink(portableDir, defaultDir, "dir");
  return {
    ...base,
    state: "migrated-now",
    filesMerged,
    jsonlConflicts,
    jsonlMerged,
    jsonlPreserved,
  };
}

/** Read the `cwd` recorded in a session file's header, if present. */
async function sessionCwdFromHeader(
  sessionFile: string,
): Promise<string | null> {
  try {
    const content = await readFile(sessionFile, "utf8");
    const firstLine = content.split("\n", 1)[0];
    const header = JSON.parse(firstLine) as { cwd?: unknown };
    return typeof header.cwd === "string" ? header.cwd : null;
  } catch {
    return null;
  }
}

/**
 * Migrate every default-named session directory under the sessions root.
 * Each directory is identified by the `cwd` recorded in its session files'
 * headers, since Pi's `--<encoded-cwd>--` encoding is not reversible.
 */
export async function migrateAllSessionDirs(
  config: PortableSessionsConfig,
  options: MigrateOptions = {},
): Promise<MigrationResult[]> {
  const sessionsRoot = requireSessionsRoot(options);
  let entries: string[];
  try {
    entries = await readdir(sessionsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const results: MigrationResult[] = [];
  for (const entry of entries) {
    if (!entry.startsWith("--") || !entry.endsWith("--")) {
      continue;
    }
    const dir = join(sessionsRoot, entry);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (!stats.isDirectory() && !stats.isSymbolicLink()) {
      continue;
    }

    let cwd: string | null = null;
    let sessionFiles: string[] = [];
    try {
      const names = await readdir(dir);
      sessionFiles = names.filter((name) => name.endsWith(".jsonl"));
    } catch {
      sessionFiles = [];
    }
    for (const file of sessionFiles) {
      cwd = await sessionCwdFromHeader(join(dir, file));
      if (cwd !== null) {
        break;
      }
    }
    if (cwd === null) {
      results.push({
        cwd: `<unknown (${entry})>`,
        defaultDir: dir,
        portableName: "",
        portableDir: "",
        state: "no-sessions",
        filesMerged: 0,
        jsonlConflicts: 0,
        jsonlMerged: 0,
        jsonlPreserved: 0,
        note: "no session file with a cwd header found; skipping",
      });
      continue;
    }
    results.push(
      await migrateSessionDir(cwd, config, {
        ...options,
        sessionsRoot,
      }),
    );
  }
  return results;
}

/** One session directory that is a candidate for migration. */
export interface PendingMigration {
  /** Working directory recorded in the session files' headers. */
  cwd: string;
  /** Pi's default `--<encoded-cwd>--` directory name. */
  defaultDirName: string;
  /** The portable directory name it would be migrated to. */
  portableName: string;
}

/**
 * Scan the sessions root for default-named session directories that have not
 * been migrated yet (real directories, not symlinks) and whose portable name
 * differs from the default name. Used to notify the user at startup.
 */
export async function findPendingMigrations(
  config: PortableSessionsConfig,
  options: MigrateOptions = {},
): Promise<PendingMigration[]> {
  const sessionsRoot = requireSessionsRoot(options);
  let entries: string[];
  try {
    entries = await readdir(sessionsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const pending: PendingMigration[] = [];
  for (const entry of entries) {
    if (!entry.startsWith("--") || !entry.endsWith("--")) {
      continue;
    }
    const dir = join(sessionsRoot, entry);
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      continue;
    }

    let cwd: string | null = null;
    let sessionFiles: string[] = [];
    try {
      const names = await readdir(dir);
      sessionFiles = names.filter((name) => name.endsWith(".jsonl"));
    } catch {
      sessionFiles = [];
    }
    for (const file of sessionFiles) {
      cwd = await sessionCwdFromHeader(join(dir, file));
      if (cwd !== null) {
        break;
      }
    }
    if (cwd === null) {
      continue;
    }
    const portableName = portableSessionDirName(cwd, config);
    if (portableName === entry) {
      continue;
    }
    pending.push({ cwd, defaultDirName: entry, portableName });
  }
  return pending;
}

/** Read the `cwd` recorded in a session file's header, if present. */
async function sessionCwdFromEntry(
  sessionsRoot: string,
  entryName: string,
): Promise<string | null> {
  let sessionFiles: string[] = [];
  try {
    const names = await readdir(join(sessionsRoot, entryName));
    sessionFiles = names.filter((name) => name.endsWith(".jsonl"));
  } catch {
    return null;
  }
  for (const file of sessionFiles) {
    const cwd = await sessionCwdFromHeader(join(sessionsRoot, entryName, file));
    if (cwd !== null) {
      return cwd;
    }
  }
  return null;
}

/**
 * Migrate the session directories named by `targets`. Each target is either an
 * absolute working directory or a directory name under the sessions root
 * (Pi's default `--<encoded-cwd>--` name or a portable name). Directories whose
 * cwd cannot be determined are reported and skipped.
 */
export async function migrateNamedSessionDirs(
  targets: string[],
  config: PortableSessionsConfig,
  options: MigrateOptions = {},
): Promise<MigrationResult[]> {
  const sessionsRoot = requireSessionsRoot(options);
  const results: MigrationResult[] = [];
  for (const target of targets) {
    const cwd = isAbsolute(target)
      ? target
      : await sessionCwdFromEntry(sessionsRoot, target);
    if (cwd === null) {
      results.push({
        cwd: `<unknown (${target})>`,
        defaultDir: join(sessionsRoot, target),
        portableName: "",
        portableDir: "",
        state: "no-sessions",
        filesMerged: 0,
        jsonlConflicts: 0,
        jsonlMerged: 0,
        jsonlPreserved: 0,
        note: "no session file with a cwd header found; skipping",
      });
      continue;
    }
    results.push(
      await migrateSessionDir(cwd, config, {
        ...options,
        sessionsRoot,
      }),
    );
  }
  return results;
}
