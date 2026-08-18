import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentLoop } from "./loop.js";
import type { RunRequest } from "./loop.js";
import type { LlmProvider } from "./provider.js";
import type { BaseToolset } from "./toolset.js";
import type { Event } from "./types.js";

export interface WorkspaceOptions {
  readonly path?: string;
}

export interface RunnerOptions {
  readonly provider: LlmProvider;
  readonly toolsets?: readonly BaseToolset[];
  readonly maxRounds?: number;
  readonly workspace?: WorkspaceOptions;
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

  constructor(options: RunnerOptions) {
    this.provider = options.provider;
    this.toolsets = options.toolsets ?? [];
    this.defaultMaxRounds = options.maxRounds;
    this.workspaceOptions = options.workspace;
  }

  async *run(
    request: RunRequest,
    options?: RunnerRunOptions,
  ): AsyncGenerator<Event, void, void> {
    const workspace = await prepareWorkspace(this.workspaceOptions);
    const loop = new AgentLoop({
      provider: this.provider,
      toolsets: this.toolsets,
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
      if (workspace.ephemeral) {
        await rm(workspace.path, { recursive: true, force: true });
      }
    }
  }
}
