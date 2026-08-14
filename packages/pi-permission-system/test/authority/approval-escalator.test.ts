import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ParentAuthorizer } from "#src/authority/approval-escalator";
import {
  type ForwardedPermissionRequest,
  PERMISSION_FORWARDING_SERVING_GRACE_MS,
} from "#src/authority/permission-forwarding";
import { ServingSessionRegistry } from "#src/authority/serving-registry";
import {
  createForwardingTempDir,
  makeForwarderContext,
  makeParentAuthorizerDeps,
  makeSubagentRegistry,
} from "#test/helpers/forwarding-fixtures";

// ── Local poll helper ────────────────────────────────────────────────────
//
// The reverse direction of `ForwardingTempDir.writeRequest`: waits for the
// request file ParentAuthorizer.authorize writes, so the test can respond
// as the parent session would. Real timers/filesystem, matching how
// composition-root.test.ts's forwarding round trip already behaves.

async function waitForRequestFile(
  requestsDir: string,
): Promise<ForwardedPermissionRequest> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    let files: string[] = [];
    try {
      files = readdirSync(requestsDir).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    const requestFile = files[0];
    if (requestFile) {
      return JSON.parse(
        readFileSync(join(requestsDir, requestFile), "utf-8"),
      ) as ForwardedPermissionRequest;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a request file in ${requestsDir}`);
}

// ── ParentAuthorizer ──────────────────────────────────────────────────────

describe("ParentAuthorizer", () => {
  test("writes a forwarded request carrying the display fields and resolves with the parent's response", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow git push?",
        toolName: "bash",
        command: "git push",
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.targetSessionId).toBe("parent-session");
      expect(request.requesterSessionId).toBe("child-session");
      expect(request.source).toBe("tool_call");
      expect(request.surface).toBe("bash");
      expect(request.value).toBe("git push");

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      // toMatchObject: the response also carries a live respondedAt timestamp
      // and the responderSessionId/denialReason passthrough fields.
      await expect(decisionPromise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("persists the details' sessionApproval suggestion onto the forwarded request", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow git push?",
        toolName: "bash",
        command: "git push",
        sessionApproval: { surface: "bash", patterns: ["git *"] },
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.sessionApproval).toEqual({
        surface: "bash",
        patterns: ["git *"],
      });

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("stamps the child-fixed access intent with requester identity onto the forwarded request", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({
          hasUI: false,
          sessionId: "child-session",
          cwd: "/worktree/issue-42",
        }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow this path access?",
        toolName: "read",
        path: "src/foo.ts",
        accessIntent: {
          surface: "path",
          matchValues: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
          boundaryValue: "/worktree/issue-42/src/foo.ts",
        },
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      // The display fields still ride the same request alongside the structured
      // intent (the #292/#557 non-degraded-broadcast contract must not regress).
      expect(request.source).toBe("tool_call");
      expect(request.surface).toBe("read");
      expect(request.value).toBe("src/foo.ts");
      // requesterCwd comes from ctx.cwd; principal mirrors the request's own
      // computed identity fields (sessionId, requesterAgentName).
      expect(request.accessIntent).toEqual({
        surface: "path",
        matchValues: ["/worktree/issue-42/src/foo.ts", "src/foo.ts"],
        boundaryValue: "/worktree/issue-42/src/foo.ts",
        requesterCwd: "/worktree/issue-42",
        principal: {
          sessionId: request.requesterSessionId,
          agentName: request.requesterAgentName,
        },
      });

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("omits accessIntent from the request when the details carry none", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow read?",
        toolName: "read",
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.accessIntent).toBeUndefined();

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("omits sessionApproval from the request when the details carry none", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow read?",
        toolName: "read",
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      expect(request.sessionApproval).toBeUndefined();

      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );
      await decisionPromise;
    } finally {
      temp.cleanup();
    }
  });

  test("returns denied when the response marks the request denied", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const registry = makeSubagentRegistry("child-session", {
        parentSessionId: "parent-session",
      });
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry,
        }),
      );

      const decisionPromise = authorizer.authorize({
        requestId: "unused-by-parent-authorizer",
        source: "tool_call",
        agentName: "Explore",
        message: "Allow read?",
        toolName: "read",
      });

      const request = await waitForRequestFile(temp.location.requestsDir);
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: false,
          state: "denied",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      // toMatchObject: see the approved-path test for why this isn't toEqual.
      await expect(decisionPromise).resolves.toMatchObject({
        approved: false,
        state: "denied",
      });
    } finally {
      temp.cleanup();
    }
  });
});

// ── Abandonment ─────────────────────────────────────────────────────
//
// Every path where ParentAuthorizer gives up without a human having ruled must
// be distinguishable from a user denial — `confirmationUnavailable` selects the
// "no authority could answer" block message, and `denialReason` says which
// path (#719).

const forwardedAsk = {
  requestId: "unused-by-parent-authorizer",
  source: "tool_call",
  agentName: "Explore",
  message: "Allow pwd?",
  toolName: "bash",
} as const;

describe("ParentAuthorizer abandonment", () => {
  test("reports an unresolvable target as unavailable, not user-denied", async () => {
    const authorizer = new ParentAuthorizer(
      makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
      makeParentAuthorizerDeps({
        registry: makeSubagentRegistry("child-session"),
      }),
    );

    await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
      approved: false,
      state: "denied",
      confirmationUnavailable: true,
      denialReason:
        "Could not resolve a parent session to forward this permission request to",
    });
  });

  test("reports unusable forwarding directories as unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-forwarding-blocked-"));
    try {
      // A file where the forwarding root must be a directory: every mkdir
      // beneath it fails with ENOTDIR.
      const forwardingDir = join(root, "forwarding");
      writeFileSync(forwardingDir, "not a directory", "utf-8");

      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason:
          "Permission forwarding directories could not be prepared for session 'parent-session'",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports an unwritable request as unavailable", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      // Deny writes into requests/ so writeJsonFileAtomic's temp write fails.
      chmodSync(temp.location.requestsDir, 0o500);

      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "The forwarded permission request could not be written",
      });
      // The directories it created for an exchange that never happened are
      // cleaned up, so the chmod'd directory is already gone.
      expect(existsSync(temp.location.requestsDir)).toBe(false);
    } finally {
      if (existsSync(temp.location.requestsDir)) {
        chmodSync(temp.location.requestsDir, 0o700);
      }
      temp.cleanup();
    }
  });

  test("reports an unreadable response as unavailable, not as the parent's denial", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
        }),
      );

      const decisionPromise = authorizer.authorize({ ...forwardedAsk });
      const request = await waitForRequestFile(temp.location.requestsDir);
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        "{ not json",
        "utf-8",
      );

      await expect(decisionPromise).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason:
          "The parent session's permission response could not be read",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("reports an unanswered request as timed out, not user-denied", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          getTimeoutMs: () => 400,
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: "Session 'parent-session' did not answer within 0.4s",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("abandons quickly when an in-process target is not serving", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          // Nobody has marked themselves as serving.
          serving: new ServingSessionRegistry(),
          getTimeoutMs: () => 60_000,
        }),
      );

      const started = Date.now();
      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason:
          "Session 'parent-session' is not serving forwarded permission requests",
      });
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally {
      temp.cleanup();
    }
  });

  test("keeps waiting while the in-process target is serving", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const serving = new ServingSessionRegistry();
      serving.markServing("parent-session");
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          serving,
          getTimeoutMs: () => 60_000,
        }),
      );

      const decisionPromise = authorizer.authorize({ ...forwardedAsk });
      const request = await waitForRequestFile(temp.location.requestsDir);
      // Well past the unserved grace window: a serving target must not be
      // abandoned no matter how long the human deliberates.
      await new Promise((resolve) =>
        setTimeout(resolve, PERMISSION_FORWARDING_SERVING_GRACE_MS + 250),
      );
      writeFileSync(
        join(temp.location.responsesDir, `${request.id}.json`),
        JSON.stringify({
          approved: true,
          state: "approved",
          responderSessionId: "parent-session",
        }),
        "utf-8",
      );

      await expect(decisionPromise).resolves.toMatchObject({
        approved: true,
        state: "approved",
      });
    } finally {
      temp.cleanup();
    }
  });

  test("never fast-fails a target resolved from the environment", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      vi.stubEnv("PI_SUBAGENT_PARENT_SESSION", "parent-session");
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          // No registry entry, so the target resolves from the environment:
          // the parent is in another process and shares no serving registry.
          registry: makeSubagentRegistry("child-session"),
          serving: new ServingSessionRegistry(),
          getTimeoutMs: () => PERMISSION_FORWARDING_SERVING_GRACE_MS + 400,
        }),
      );

      await expect(authorizer.authorize({ ...forwardedAsk })).resolves.toEqual({
        approved: false,
        state: "denied",
        confirmationUnavailable: true,
        denialReason: expect.stringContaining("did not answer within"),
      });
    } finally {
      vi.unstubAllEnvs();
      temp.cleanup();
    }
  });

  test("deletes the request it abandoned so the parent cannot answer it later", async () => {
    const temp = createForwardingTempDir("parent-session");
    try {
      const authorizer = new ParentAuthorizer(
        makeForwarderContext({ hasUI: false, sessionId: "child-session" }),
        makeParentAuthorizerDeps({
          forwardingDir: temp.forwardingDir,
          registry: makeSubagentRegistry("child-session", {
            parentSessionId: "parent-session",
          }),
          getTimeoutMs: () => 400,
        }),
      );

      await authorizer.authorize({ ...forwardedAsk });

      expect(existsSync(temp.location.requestsDir)).toBe(false);
    } finally {
      temp.cleanup();
    }
  });
});
