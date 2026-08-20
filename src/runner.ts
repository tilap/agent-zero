import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalPolicy,
} from "./approval.js";
import type { ContextCompactor } from "./context.js";
import { NoActiveRunError, UnknownApprovalRequestError } from "./errors.js";
import type { Hooks } from "./hooks.js";
import { AgentLoop } from "./loop.js";
import type { RunRequest } from "./loop.js";
import type { LlmProvider } from "./provider.js";
import type { SteeringSource } from "./steering.js";
import type { BaseToolset } from "./toolset.js";
import type { Event, ToolCall } from "./types.js";

export interface WorkspaceOptions {
  readonly path?: string;
}

class SteeringQueue implements SteeringSource {
  private pending: string[] = [];

  enqueue(text: string): void {
    this.pending.push(text);
  }

  drain(): readonly string[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }
}

class ApprovalRegistry implements ApprovalGate {
  private readonly policy: ApprovalPolicy | undefined;
  private readonly pending = new Map<
    string,
    (decision: ApprovalDecision) => void
  >();

  constructor(policy: ApprovalPolicy | undefined) {
    this.policy = policy;
  }

  requiresApproval(call: ToolCall): boolean {
    return this.policy?.requiresApproval(call) ?? false;
  }

  async requestApproval(
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(call.id, resolve);
      if (signal !== undefined) {
        signal.addEventListener(
          "abort",
          () => {
            if (this.pending.delete(call.id)) {
              resolve("denied");
            }
          },
          { once: true },
        );
      }
    });
  }

  decide(callId: string, decision: ApprovalDecision): void {
    const resolve = this.pending.get(callId);
    if (resolve === undefined) {
      throw new UnknownApprovalRequestError(
        `No pending approval request with id "${callId}".`,
      );
    }
    this.pending.delete(callId);
    resolve(decision);
  }
}

export interface RunnerOptions {
  readonly provider: LlmProvider;
  readonly toolsets?: readonly BaseToolset[];
  readonly maxRounds?: number;
  readonly workspace?: WorkspaceOptions;
  readonly hooks?: Hooks;
  readonly contextCompactor?: ContextCompactor;
  readonly approvalPolicy?: ApprovalPolicy;
}

export interface RunnerRunOptions {
  readonly signal?: AbortSignal;
}

async function prepareWorkspace(
  options: WorkspaceOptions | undefined,
): Promise<{ readonly path: string; readonly ephemeral: boolean }> {
  if (options?.path !== undefined) {
    await mkdir(options.path, { recursive: true });
    return { path: options.path, ephemeral: false };
  }
  const path = await mkdtemp(join(tmpdir(), "agent-zero-"));
  return { path, ephemeral: true };
}

export class Runner {
  private readonly provider: LlmProvider;
  private readonly toolsets: readonly BaseToolset[];
  private readonly defaultMaxRounds: number | undefined;
  private readonly workspaceOptions: WorkspaceOptions | undefined;
  private readonly hooks: Hooks | undefined;
  private readonly contextCompactor: ContextCompactor | undefined;
  private readonly approvalPolicy: ApprovalPolicy | undefined;
  private steeringQueue: SteeringQueue | undefined;
  private approvalRegistry: ApprovalRegistry | undefined;

  constructor(options: RunnerOptions) {
    this.provider = options.provider;
    this.toolsets = options.toolsets ?? [];
    this.defaultMaxRounds = options.maxRounds;
    this.workspaceOptions = options.workspace;
    this.hooks = options.hooks;
    this.contextCompactor = options.contextCompactor;
    this.approvalPolicy = options.approvalPolicy;
  }

  sendSteering(text: string): void {
    if (this.steeringQueue === undefined) {
      throw new NoActiveRunError("Cannot send steering: no run is active.");
    }
    this.steeringQueue.enqueue(text);
  }

  approve(callId: string): void {
    this.requireApprovalRegistry().decide(callId, "approved");
  }

  deny(callId: string): void {
    this.requireApprovalRegistry().decide(callId, "denied");
  }

  private requireApprovalRegistry(): ApprovalRegistry {
    if (this.approvalRegistry === undefined) {
      throw new NoActiveRunError("Cannot decide approval: no run is active.");
    }
    return this.approvalRegistry;
  }

  async *run(
    request: RunRequest,
    options?: RunnerRunOptions,
  ): AsyncGenerator<Event, void, void> {
    const workspace = await prepareWorkspace(this.workspaceOptions);
    const steeringQueue = new SteeringQueue();
    const approvalRegistry = new ApprovalRegistry(this.approvalPolicy);
    this.steeringQueue = steeringQueue;
    this.approvalRegistry = approvalRegistry;
    const loop = new AgentLoop({
      provider: this.provider,
      toolsets: this.toolsets,
      ...(this.hooks === undefined ? {} : { hooks: this.hooks }),
      ...(this.contextCompactor === undefined
        ? {}
        : { contextCompactor: this.contextCompactor }),
      steering: steeringQueue,
      approval: approvalRegistry,
    });
    const fullRequest: RunRequest =
      request.maxRounds !== undefined || this.defaultMaxRounds === undefined
        ? request
        : { ...request, maxRounds: this.defaultMaxRounds };

    try {
      yield* loop.run(fullRequest, {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        workspace: workspace.path,
      });
    } finally {
      this.steeringQueue = undefined;
      this.approvalRegistry = undefined;
      if (workspace.ephemeral) {
        await rm(workspace.path, { recursive: true, force: true });
      }
    }
  }
}
