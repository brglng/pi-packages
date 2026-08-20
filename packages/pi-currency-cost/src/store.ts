import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a raw config JSON file. Returns undefined when the file does not
 * exist; throws when it exists but is not valid JSON (so callers never
 * silently clobber a corrupt user config).
 */
export async function readRawConfig(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(text) as unknown;
  return isRecord(parsed) ? parsed : undefined;
}

/**
 * Write a config JSON file atomically: write to a sibling temp file, then
 * rename over the target. A failed write leaves the previous file intact and
 * cleans up the temp file.
 */
export async function writeConfigAtomic(
  path: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

// Serialize config writes so concurrent refreshes cannot interleave and
// corrupt the file (last writer wins, but every write is complete).
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

export interface CurrencyUpdate {
  /** USD per one unit of the currency; replaces the stored `usdRate`. */
  usdRate: number;
  updatedAt: number;
}

/**
 * Merge a currency update into the config file at `path`, preserving all
 * unknown root fields, other currency entries, and unknown fields inside the
 * updated currency entry. Returns the updated root object.
 */
export async function updateWritableConfig(
  path: string,
  currency: string,
  update: CurrencyUpdate,
): Promise<Record<string, unknown>> {
  return enqueueWrite(async () => {
    const existing = (await readRawConfig(path)) ?? {};
    const currencies = isRecord(existing.currencies) ? existing.currencies : {};
    const entry = isRecord(currencies[currency]) ? currencies[currency] : {};
    const nextRoot: Record<string, unknown> = {
      ...existing,
      currencies: {
        ...currencies,
        [currency]: { ...entry, ...update },
      },
    };
    await writeConfigAtomic(path, nextRoot);
    return nextRoot;
  });
}
