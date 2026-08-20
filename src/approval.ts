import type { ToolCall } from "./types.js";

export type ApprovalDecision = "approved" | "denied";

export interface ApprovalPolicy {
  /** True if this call must pause for a decision before it runs. */
  requiresApproval(call: ToolCall): boolean;
}

export interface ApprovalGate extends ApprovalPolicy {
  requestApproval(
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision>;
}
