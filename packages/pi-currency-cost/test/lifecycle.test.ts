import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createCurrencyCostExtension } from "#src/index";

// Mirrors the real Bank of China table layout; 中行折算价 is cell 5.
const BOC_HTML = `
<html><body><table>
<tr><td>欧元</td><td>779.11</td><td>779.11</td><td>784.82</td><td>784.82</td><td>783.28</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
<tr><td>美元</td><td>672.61</td><td>672.61</td><td>675.44</td><td>675.44</td><td>678.54</td><td>2026/08/19 19:55:48</td><td>19:55:48</td></tr>
</table></html>`;

/** Mock fetch serving the BOC fixture page. */
function jsonFetch(): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => encoder.encode(BOC_HTML).buffer as ArrayBuffer,
      json: async () => ({ rates: { USD: 100 / 678.54 } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

interface FakePi {
  handlers: Map<string, (event: never, ctx: ExtensionContext) => unknown>;
  commands: Map<
    string,
    {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }
  >;
}

function fakePi(): FakePi {
  return { handlers: new Map(), commands: new Map() };
}

function buildPi(pi: FakePi): ExtensionAPI {
  const api = {
    on: (
      event: string,
      handler: (event: never, ctx: ExtensionContext) => unknown,
    ) => {
      pi.handlers.set(event, handler);
    },
    registerCommand: (
      name: string,
      options: {
        description?: string;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ) => {
      pi.commands.set(name, options);
    },
  };
  return api as unknown as ExtensionAPI;
}

interface FakeCtx extends ExtensionCommandContext {
  notifications: Array<{ message: string; type?: string }>;
}

function fakeCtx(): FakeCtx {
  const notifications: FakeCtx["notifications"] = [];
  const ctx = {
    ui: {
      notify: (message: string, type?: string) =>
        notifications.push({ message, type }),
    },
    cwd: "/tmp",
    signal: undefined,
  } as unknown as ExtensionCommandContext;
  return Object.assign(ctx, { notifications }) as FakeCtx;
}

async function tempProject(
  config: Record<string, unknown>,
): Promise<{ agentDir: string; cwd: string }> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-currency-cost-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-currency-cost-cwd-"));
  await mkdir(join(cwd, ".pi", "extensions", "pi-currency-cost"), {
    recursive: true,
  });
  await writeFile(
    join(cwd, ".pi", "extensions", "pi-currency-cost", "config.json"),
    JSON.stringify(config),
  );
  return { agentDir, cwd };
}

function assistantMessage(): MessageEndEvent["message"] {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "bailian",
    model: "qwen3.7-plus",
    content: [],
    stopReason: "stop",
    timestamp: 1,
    usage: {
      input: 100,
      output: 200,
      cacheRead: 50,
      cacheWrite: 10,
      totalTokens: 360,
      cost: {
        input: 0.0001,
        output: 0.0002,
        cacheRead: 0.00005,
        cacheWrite: 0.00001,
        total: 0.00036,
      },
    },
  } as unknown as MessageEndEvent["message"];
}

function costOf(
  message: MessageEndEvent["message"] | undefined,
): Record<string, unknown> {
  const usage = message as unknown as {
    usage?: { cost?: Record<string, unknown> };
  };
  return usage.usage?.cost ?? {};
}

function asFloat(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

describe("extension lifecycle (no paid model requests)", () => {
  it("registers the message_end hook and converts mapped costs", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.147 } },
      providers: { bailian: { currency: "CNY" } },
    });
    try {
      const pi = fakePi();
      const installed = await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
      });
      expect(installed.runtime).toBeDefined();

      const handler = pi.handlers.get("message_end");
      expect(handler).toBeDefined();
      const ctx = fakeCtx();
      const event = { type: "message_end", message: assistantMessage() };
      const result = (await handler?.(event as never, ctx)) as
        | { message?: MessageEndEvent["message"] }
        | undefined;
      expect(result?.message).toBeDefined();
      const cost = costOf(result?.message);
      expect(asFloat(cost["input"])).toBeCloseTo(0.0001 * 0.147, 12);
      expect(asFloat(cost["total"])).toBeCloseTo(0.00036 * 0.147, 12);
      expect(ctx.notifications.length).toBe(0);
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("leaves unmapped providers untouched through the hook", async () => {
    const { agentDir, cwd } = await tempProject({
      providers: { openrouter: { currency: "USD" } },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
      });
      const handler = pi.handlers.get("message_end");
      const message = assistantMessage();
      const record = message as unknown as Record<string, unknown>;
      record["provider"] = "openrouter";
      record["model"] = "gpt-5";
      const result = (await handler?.(
        { type: "message_end", message } as never,
        fakeCtx(),
      )) as { message?: MessageEndEvent["message"] } | undefined;
      expect(result).toBeUndefined();
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("shows status and help and warns on unknown subcommands", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.147 } },
      providers: { bailian: { currency: "CNY" } },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
      });
      const command = pi.commands.get("currency-cost");
      const ctx = fakeCtx();
      await command?.handler("status", ctx);
      const status = ctx.notifications[0]?.message ?? "";
      expect(status).toContain("CNY");
      expect(status).toContain("Global config");
      expect(status).toContain("bailian");
      await command?.handler("help", ctx);
      expect(ctx.notifications[1]?.message).toContain("Usage: /currency-cost");
      expect(ctx.notifications[1]?.message).toContain("refresh");
      await command?.handler("nonsense", ctx);
      expect(ctx.notifications[2]?.message).toContain("Usage: /currency-cost");
      // The removed manual `rate` command is not recognized either.
      await command?.handler("rate CNY 0.148", ctx);
      expect(ctx.notifications[3]?.message).toContain("Usage: /currency-cost");
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("refreshes rates from a BOC page through the command", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.14 } },
      providers: { bailian: { currency: "CNY" } },
      rateSource: { type: "boc" },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
        fetchImpl: jsonFetch(),
      });
      const command = pi.commands.get("currency-cost");
      const ctx = fakeCtx();
      await command?.handler("refresh", ctx);
      const note = ctx.notifications[0]?.message ?? "";
      expect(note).toContain("CNY");
      expect(note).toContain("updated USD rates");
      const written = JSON.parse(
        await readFile(
          join(cwd, ".pi", "extensions", "pi-currency-cost", "config.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const currencies = written.currencies as Record<string, unknown>;
      const cny = currencies["CNY"] as Record<string, unknown>;
      expect(asFloat(cny["usdRate"])).toBeCloseTo(100 / 678.54, 12);
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("reports a config warning on session_start", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: {} }, // non-USD without usdRate
      providers: { bailian: { currency: "CNY" } },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
      });
      const handler = pi.handlers.get("session_start");
      const ctx = fakeCtx();
      await handler?.(
        { type: "session_start", reason: "startup" } as never,
        ctx,
      );
      const note = ctx.notifications[0]?.message ?? "";
      expect(note).toContain("pi-currency-cost configuration warnings");
      expect(note).toContain("CNY");
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("converts at most once per message object", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.147 } },
      providers: { bailian: { currency: "CNY" } },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        skipStartupFetch: true,
      });
      const handler = pi.handlers.get("message_end");
      const message = assistantMessage();
      const first = (await handler?.(
        { type: "message_end", message } as never,
        fakeCtx(),
      )) as { message?: MessageEndEvent["message"] } | undefined;
      // The same concrete message object must not be converted twice.
      const second = (await handler?.(
        { type: "message_end", message } as never,
        fakeCtx(),
      )) as { message?: MessageEndEvent["message"] } | undefined;
      expect(asFloat(costOf(first?.message)["input"])).toBeCloseTo(
        0.0001 * 0.147,
        12,
      );
      expect(second).toBeUndefined();
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("refreshes configured rates in session_start and persists them", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.147 } },
      providers: { bailian: { currency: "CNY" } },
    });
    try {
      const pi = fakePi();
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        fetchImpl: jsonFetch(),
      });
      // The startup fetch runs inside the awaited session_start handler.
      const sessionStart = pi.handlers.get("session_start");
      const ctx = fakeCtx();
      await sessionStart?.(
        { type: "session_start", reason: "startup" } as never,
        ctx,
      );
      const path = join(
        cwd,
        ".pi",
        "extensions",
        "pi-currency-cost",
        "config.json",
      );
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      const cny = (raw.currencies as Record<string, unknown>)["CNY"] as Record<
        string,
        unknown
      >;
      // The fetched rate replaces usdRate in place; the timestamp is persisted.
      expect(asFloat(cny["usdRate"])).toBeCloseTo(100 / 678.54, 12);
      expect(typeof cny["updatedAt"]).toBe("number");
      // The fetched rate is in the in-memory config before any message:
      // a subsequent message_end converts with 100/678.54, not the fallback.
      const handler = pi.handlers.get("message_end");
      const result = (await handler?.(
        { type: "message_end", message: assistantMessage() } as never,
        fakeCtx(),
      )) as { message?: MessageEndEvent["message"] } | undefined;
      expect(asFloat(costOf(result?.message)["input"])).toBeCloseTo(
        0.0001 * (100 / 678.54),
        12,
      );
      // The in-memory conversion and the on-disk rate match.
      expect(ctx.notifications.length).toBe(0);
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });

  it("reports a startup rate-fetch failure without crashing", async () => {
    const { agentDir, cwd } = await tempProject({
      currencies: { CNY: { usdRate: 0.147 } },
    });
    try {
      const pi = fakePi();
      const failingFetch = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      await createCurrencyCostExtension(buildPi(pi), {
        agentDir,
        cwd,
        fetchImpl: failingFetch,
      });
      // The fetch fails inside the awaited session_start handler; note is
      // flushed before the handler returns (no fire-and-forget gap).
      const sessionStart = pi.handlers.get("session_start");
      const ctx = fakeCtx();
      await sessionStart?.(
        { type: "session_start", reason: "startup" } as never,
        ctx,
      );
      const note = ctx.notifications[0]?.message ?? "";
      expect(note).toContain("updated USD rates");
      expect(note).toContain("Keeping the configured usdRate");
      // No rate was persisted; the configured usdRate stays in effect.
      const raw = JSON.parse(
        await readFile(
          join(cwd, ".pi", "extensions", "pi-currency-cost", "config.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const cny = (raw.currencies as Record<string, unknown>)["CNY"] as Record<
        string,
        unknown
      >;
      expect(cny["usdRate"]).toBe(0.147);
      expect(cny["updatedAt"]).toBeUndefined();
    } finally {
      await Promise.all([
        rm(agentDir, { recursive: true, force: true }),
        rm(cwd, { recursive: true, force: true }),
      ]);
    }
  });
});
