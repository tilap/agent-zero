import { existsSync } from "node:fs";
import { BaseToolset } from "../../src/toolset.js";
import type { ToolContext, ToolSchema } from "../../src/toolset.js";
import type { ToolCall, ToolResult } from "../../src/types.js";

export class WorkspaceProbeToolset extends BaseToolset {
  readonly observedWorkspaces: string[] = [];
  readonly observedExistence: boolean[] = [];
  private readonly abortAfterCall: AbortController | undefined;

  constructor(abortAfterCall?: AbortController) {
    super();
    this.abortAfterCall = abortAfterCall;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "probe",
        description: "Records the workspace path it receives.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    if (context.workspace === undefined) {
      throw new Error("Expected a workspace path in the tool context.");
    }
    this.observedWorkspaces.push(context.workspace);
    this.observedExistence.push(existsSync(context.workspace));
    this.abortAfterCall?.abort();
    return { callId: call.id, content: "ok" };
  }
}
