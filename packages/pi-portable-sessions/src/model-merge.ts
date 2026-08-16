import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Minimal command-execution surface needed by the model merge. In production
 * this is `pi.exec`; tests inject a fake to avoid launching nested Pi
 * processes.
 */
export interface MergeExecutor {
  exec(
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<{ code: number }>;
}

/**
 * Merge two same-named Pi session JSONL files with a model.
 *
 * Runs a nested `pi -p` (print mode, `--no-session`) process whose prompt asks
 * the default model to merge both files into the target. The nested process
 * gets `PI_CODING_AGENT_SESSION_DIR` pointing at a temporary directory, so the
 * merge session never lands in the sessions root (it is never migrated); the
 * temporary directory is removed afterwards, deleting the temporary session
 * with it.
 *
 * Returns `true` when the nested process exited successfully.
 */
export async function mergeJsonlWithModel(
  sourceFile: string,
  targetFile: string,
  executor: MergeExecutor,
): Promise<boolean> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-portable-sessions-merge-"));
  try {
    const prompt = [
      "You are a session merge helper for the Pi coding agent.",
      "Merge the two Pi session JSONL files below:",
      `- source: ${sourceFile}`,
      `- target: ${targetFile}`,
      "They are the same session (same header session id) that evolved independently, possibly on different machines. Keep every entry, resolve id conflicts, and write the merged JSONL to the target file (overwrite it). Only write the file; do not explain.",
    ].join("\n");
    const result = await executor.exec(
      "env",
      [
        `PI_CODING_AGENT_SESSION_DIR=${tempDir}`,
        "pi",
        "-p",
        "--no-session",
        prompt,
      ],
      { timeout: 180_000 },
    );
    return result.code === 0;
  } catch {
    return false;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
