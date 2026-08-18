import { BaseToolset } from "../../src/toolset.js";
import type { ToolContext, ToolSchema } from "../../src/toolset.js";
import type { ToolCall, ToolResult } from "../../src/types.js";

export class RecordingToolset extends BaseToolset {
  readonly calls: ToolCall[] = [];
  readonly contexts: ToolContext[] = [];
  private readonly abortAfterCall: AbortController | undefined;

  constructor(abortAfterCall?: AbortController) {
    super();
    this.abortAfterCall = abortAfterCall;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "noop",
        description: "Records the call and context it receives.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    this.calls.push(call);
    this.contexts.push(context);
    this.abortAfterCall?.abort();
    return { callId: call.id, content: "ok" };
  }
}
