import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSessionsRoot, loadConfig, toPortableNameOptions } from "./config";
import {
  defaultSessionDirName,
  findPendingMigrations,
  type JsonlConflictHandler,
  type MigrationResult,
  type MigrationState,
  migrateAllSessionDirs,
  migrateNamedSessionDirs,
  migrateSessionDir,
} from "./migrate";
import { mergeJsonlWithModel } from "./model-merge";
import { portableSessionDirName } from "./portable-name";

function stateLabel(state: MigrationState): string {
  switch (state) {
    case "migrated":
      return "already migrated";
    case "migrated-now":
      return "migrated";
    case "would-migrate":
      return "would migrate (dry run)";
    case "already-portable":
      return "already portable";
    case "no-sessions":
      return "no sessions";
    case "portable-only":
      return "portable dir exists; default path missing";
    case "conflict":
      return "conflict";
  }
}

function summarize(results: MigrationResult[], dryRun: boolean): string {
  const lines = results.map((result) => {
    const name = result.portableName || "<n/a>";
    const note = result.note ? ` — ${result.note}` : "";
    let conflicts = "";
    if (result.jsonlConflicts > 0) {
      conflicts = `, ${result.jsonlMerged}/${result.jsonlConflicts} jsonl conflicts merged`;
      if (result.jsonlPreserved > 0) {
        conflicts += `, ${result.jsonlPreserved} preserved as *-conflicted.jsonl`;
      }
    }
    return `  ${stateLabel(result.state)}: ${name}${conflicts}${note}`;
  });
  const verb = dryRun ? "Would migrate" : "Migrated";
  return `${verb} ${results.length} session director${results.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`;
}

interface MigrateFlags {
  all: boolean;
  dryRun: boolean;
  yes: boolean;
}

function parseMigrateFlags(args: string[]): MigrateFlags {
  return {
    all: args.includes("--all"),
    dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes"),
  };
}

const USAGE = [
  "Usage: /portable-sessions <subcommand>",
  "",
  "  status        Show the portable name and directories for the current project",
  "  migrate       Migrate session directories to portable names",
  "                [--all] [--dry-run] [--yes] [<name>...]",
  "",
  "    <name>...    One or more session directory names to migrate",
  "                (default `--<encoded-cwd>--` names or portable names)",
  "                or absolute working directory paths.",
].join("\n");

export default function piPortableSessionsExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();

  // While a migration is running, cancel session lifecycle operations and
  // swallow user input so no session file can be written into a directory that
  // is about to be renamed or merged.
  let migrating = false;

  const cancelWhileMigrating = async (): Promise<
    { cancel: true } | undefined
  > => (migrating ? { cancel: true } : undefined);

  pi.on("session_before_switch", cancelWhileMigrating);
  pi.on("session_before_fork", cancelWhileMigrating);
  pi.on("session_before_tree", cancelWhileMigrating);
  pi.on("session_before_compact", cancelWhileMigrating);

  pi.on("input", async (_event, ctx) => {
    if (!migrating) {
      return undefined;
    }
    ctx.ui.notify(
      "pi-portable-sessions: migration in progress — input ignored, please retry",
      "warning",
    );
    return { action: "handled" as const };
  });

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadConfig(agentDir, ctx.cwd);
    if (!config.notifyOnStart) {
      return;
    }
    const sessionsRoot = await getSessionsRoot(agentDir, ctx.cwd);
    const pending = await findPendingMigrations(config, { sessionsRoot });
    if (pending.length === 0) {
      return;
    }
    const lines = [
      `pi-portable-sessions: ${pending.length} session director${pending.length === 1 ? "y" : "ies"} can be migrated:`,
      ...pending.slice(0, 10).map((item) => {
        return `  ${item.defaultDirName}  →  ${item.portableName}`;
      }),
    ];
    if (pending.length > 10) {
      lines.push(`  … and ${pending.length - 10} more`);
    }
    lines.push("");
    const hasCurrent = pending.some((item) => item.cwd === ctx.cwd);
    lines.push(
      hasCurrent
        ? "Run /portable-sessions migrate to migrate the current project."
        : "Run /portable-sessions migrate --all to migrate all of them.",
    );
    ctx.ui.notify(lines.join("\n"), "info");
  });

  pi.registerCommand("portable-sessions", {
    description:
      "Manage portable session directories. Subcommands: status, migrate.",
    getArgumentCompletions: (prefix) => {
      const candidates = [
        "status",
        "migrate",
        "migrate --all",
        "migrate --dry-run",
        "migrate --yes",
        "migrate --",
      ];
      return candidates
        .filter((candidate) => candidate.startsWith(prefix))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const [subcommand, ...rest] = args.trim().split(/\s+/);
      if (subcommand === "status" || subcommand === "") {
        await showStatusInfo(ctx);
        return;
      }
      if (subcommand === "migrate") {
        await runMigrate(rest, ctx);
        return;
      }
      ctx.ui.notify(USAGE, "info");
    },
  });

  async function showStatusInfo(ctx: ExtensionCommandContext): Promise<void> {
    const cwd = ctx.cwd;
    const { config, warnings } = await loadConfig(agentDir, cwd);
    const options = toPortableNameOptions(config);
    const sessionsRoot = await getSessionsRoot(agentDir, cwd);
    const defaultDir = join(sessionsRoot, defaultSessionDirName(cwd));
    const portableName = portableSessionDirName(cwd, options);
    const portableDir = join(sessionsRoot, portableName);

    let defaultState = "does not exist";
    try {
      const info = await stat(defaultDir);
      defaultState = info.isSymbolicLink()
        ? "symlink"
        : info.isDirectory()
          ? "directory"
          : "other";
    } catch {
      // Keep "does not exist".
    }

    let portableState = "does not exist";
    try {
      const info = await stat(portableDir);
      portableState = info.isDirectory() ? "directory" : "other";
    } catch {
      // Keep "does not exist".
    }

    const lines = [
      `Working directory : ${cwd}`,
      `Portable name     : ${portableName}`,
      `Default directory : ${defaultDir} (${defaultState})`,
      `Portable directory: ${portableDir} (${portableState})`,
      "",
      "Tip: run /portable-sessions migrate to rename the session directory",
      "to the portable name and leave a symlink at Pi's default path.",
    ];
    for (const warning of warnings) {
      lines.push(`\nWarning: ${warning}`);
    }
    ctx.ui.notify(lines.join("\n"), "info");
  }

  async function runMigrate(
    args: string[],
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const flags = parseMigrateFlags(args);
    const { config, warnings } = await loadConfig(agentDir, ctx.cwd);
    const sessionsRoot = await getSessionsRoot(agentDir, ctx.cwd);
    // Positional arguments name specific session directories to migrate:
    // either absolute working directories or directory names under the
    // sessions root (default `--<encoded-cwd>--` or portable names).
    const targets = args.filter((arg) => !arg.startsWith("--"));
    const runTargets = async (opts: {
      dryRun?: boolean;
      onJsonlConflict?: JsonlConflictHandler;
    }): Promise<MigrationResult[]> => {
      if (flags.all) {
        return migrateAllSessionDirs(config, {
          ...opts,
          sessionsRoot,
        });
      }
      if (targets.length > 0) {
        return migrateNamedSessionDirs(targets, config, {
          ...opts,
          sessionsRoot,
        });
      }
      return [
        await migrateSessionDir(ctx.cwd, config, {
          ...opts,
          sessionsRoot,
        }),
      ];
    };
    // Plan first (dry run): decide what would change before asking.
    const plan = await runTargets({ dryRun: true });

    const pending = plan.filter((result) => result.state === "would-migrate");
    if (pending.length === 0) {
      ctx.ui.notify(`${summarize(plan, true)}\nNothing to migrate.`, "info");
      return;
    }

    if (flags.dryRun) {
      ctx.ui.notify(summarize(plan, true), "info");
      return;
    }

    if (ctx.hasUI && !flags.yes) {
      const lines = pending.map((result) => {
        const from = basename(result.defaultDir);
        const to = result.portableName;
        return `  ${from}  →  ${to}`;
      });
      const ok = await ctx.ui.confirm(
        `Migrate ${pending.length} session director${pending.length === 1 ? "y" : "ies"}?`,
        lines.join("\n"),
      );
      if (!ok) {
        ctx.ui.notify("Migration cancelled.", "info");
        return;
      }
    } else if (!ctx.hasUI && !flags.yes) {
      ctx.ui.notify(
        "Confirmation requires TUI mode; pass --yes to run without confirmation.",
        "warning",
      );
      return;
    }

    migrating = true;
    const onJsonlConflict: JsonlConflictHandler = (source, target) =>
      mergeJsonlWithModel(source, target, {
        exec: (command, args, options) => pi.exec(command, args, options),
      });
    let results: MigrationResult[];
    try {
      results = await runTargets({ onJsonlConflict });
    } finally {
      migrating = false;
    }

    const lines = [summarize(results, false)];
    for (const warning of warnings) {
      lines.push(`Warning: ${warning}`);
    }
    ctx.ui.notify(lines.join("\n"), "info");
  }
}

export {
  type ConfigWarnings,
  DEFAULT_CONFIG,
  getSessionsRoot,
  loadConfig,
  normalizeConfig,
  type PortableSessionsConfig,
  toPortableNameOptions,
} from "./config";
export {
  EXTENSION_ID,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getProjectConfigPath,
} from "./config-paths";
export {
  defaultSessionDirName,
  findPendingMigrations,
  type JsonlConflictHandler,
  type MigrateOptions,
  type MigrationResult,
  type MigrationState,
  migrateAllSessionDirs,
  migrateNamedSessionDirs,
  migrateSessionDir,
  type PendingMigration,
} from "./migrate";
export {
  type DecodedPortableName,
  decodePortableSessionDirName,
  type PortableNameOptions,
  portableSessionDirName,
  portableSessionDirNameToAbsolute,
  toPosixAbsolute,
} from "./portable-name";
