import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRawConfig,
  updateWritableConfig,
  writeConfigAtomic,
} from "#src/store";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-currency-cost-store-"));
}

describe("config store", () => {
  it("writes config files atomically (no temp files left behind)", async () => {
    const dir = await tempDir();
    try {
      const path = join(dir, "config.json");
      await writeConfigAtomic(path, { a: 1 });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1 });
      const leftovers = (await readdir(dir)).filter((name) =>
        name.includes(".tmp"),
      );
      expect(leftovers).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates missing parent directories", async () => {
    const dir = await tempDir();
    try {
      const path = join(dir, "nested", "deep", "config.json");
      await writeConfigAtomic(path, { a: 1 });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ a: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("merges a currency update while preserving unknown fields", async () => {
    const dir = await tempDir();
    try {
      const path = join(dir, "config.json");
      await writeConfigAtomic(path, {
        customTopLevel: "kept",
        currencies: {
          CNY: { usdRate: 0.147, note: "user note" },
          EUR: { usdRate: 1.15 },
        },
      });
      const updated = await updateWritableConfig(path, "CNY", {
        usdRate: 0.145,
        updatedAt: 123,
      });
      const currencies = updated.currencies as Record<string, unknown>;
      expect(updated.customTopLevel).toBe("kept");
      expect(currencies["EUR"]).toEqual({ usdRate: 1.15 });
      expect(currencies["CNY"]).toEqual({
        note: "user note",
        usdRate: 0.145,
        updatedAt: 123,
      });
      // The on-disk file matches the returned object.
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(updated);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces usdRate with a fetched/updated value", async () => {
    const dir = await tempDir();
    try {
      const path = join(dir, "config.json");
      await updateWritableConfig(path, "CNY", {
        usdRate: 0.148,
        updatedAt: 456,
      });
      const raw = await readRawConfig(path);
      expect(raw?.currencies).toEqual({
        CNY: { usdRate: 0.148, updatedAt: 456 },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent writes without losing updates", async () => {
    const dir = await tempDir();
    try {
      const path = join(dir, "config.json");
      await Promise.all([
        updateWritableConfig(path, "CNY", {
          usdRate: 0.145,
          updatedAt: 1,
        }),
        updateWritableConfig(path, "EUR", {
          usdRate: 1.1,
          updatedAt: 2,
        }),
        updateWritableConfig(path, "JPY", {
          usdRate: 0.0067,
          updatedAt: 3,
        }),
      ]);
      const raw = await readRawConfig(path);
      const currencies = raw?.currencies as Record<string, unknown> | undefined;
      expect(currencies?.["CNY"]).toEqual({
        usdRate: 0.145,
        updatedAt: 1,
      });
      expect(currencies?.["EUR"]).toEqual({
        usdRate: 1.1,
        updatedAt: 2,
      });
      expect(currencies?.["JPY"]).toEqual({
        usdRate: 0.0067,
        updatedAt: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports missing files as undefined and corrupt JSON as an error", async () => {
    const dir = await tempDir();
    try {
      expect(await readRawConfig(join(dir, "missing.json"))).toBeUndefined();
      const path = join(dir, "bad.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, "{ not json");
      await expect(readRawConfig(path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
