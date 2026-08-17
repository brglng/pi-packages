import { randomUUID } from "node:crypto";
import type { BoundaryRequest } from "../src/broker/types.ts";
import type { BoundaryApprovalBrokerService } from "../src/broker/service.ts";
import { sandboxTrapToBoundaryRequest } from "../src/integrations/sandbox.ts";
import type {
  SandboxBoundaryTrap,
  SandboxFilesystemTrap,
  SandboxNetworkTrap,
} from "../src/integrations/sandbox.ts";

export type TrapApprovalContext = {
  broker?: BoundaryApprovalBrokerService;
  command: string;
  cwd: string;
  sessionId: string;
  scopeKey: string;
  agentName?: string;
};

export type TrapApprovalResult = {
  action: "allow" | "deny";
  source: "hard-deny" | "reviewer" | "unavailable" | "invalid-grant";
  reason?: string;
};

export async function approveSandboxTrap(
  trap: SandboxBoundaryTrap,
  context: TrapApprovalContext,
): Promise<TrapApprovalResult> {
  const request = sandboxTrapToBoundaryRequest(trap, {
    command: context.command,
    cwd: context.cwd,
    agentName: context.agentName,
  });
  if (!context.broker) {
    return {
      action: "deny",
      source: "unavailable",
      reason: "Broker unavailable",
    };
  }
  if (trap.kind === "network") {
    return {
      action: "deny",
      source: "hard-deny",
      reason: "Direct network access is disabled",
    };
  }
  if (trap.kind === "filesystem" && trap.reason === "deny_match") {
    return {
      action: "deny",
      source: "hard-deny",
      reason: "The path matches an explicit sandbox deny rule",
    };
  }
  const decision = await context.broker.review(request, {
    sessionId: context.sessionId,
    scopeKey: context.scopeKey,
    issueGrant: true,
  });
  if (decision.kind !== "allow" || !decision.grant) {
    return {
      action: "deny",
      source: "reviewer",
      reason: decision.review.rationale,
    };
  }
  if (
    !context.broker.consumeGrant(
      request,
      context.sessionId,
      decision.grant.token,
    )
  ) {
    return {
      action: "deny",
      source: "invalid-grant",
      reason: "The exact one-shot grant is invalid",
    };
  }
  return { action: "allow", source: "reviewer" };
}

export function makeFilesystemTrap(path: string): SandboxFilesystemTrap {
  return {
    kind: "filesystem",
    operation: "write",
    path,
    requested_path: path,
    reason: "allow_miss",
    query_id: randomUUID(),
  };
}

export function makeNetworkTrap(target: string): SandboxNetworkTrap {
  return {
    kind: "network",
    operation: "connect",
    target,
    query_id: randomUUID(),
  };
}

export function requestFromTrap(
  trap: SandboxBoundaryTrap,
  context: Pick<TrapApprovalContext, "command" | "cwd" | "agentName">,
): BoundaryRequest {
  return sandboxTrapToBoundaryRequest(trap, context);
}
