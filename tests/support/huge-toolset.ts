import { MAX_TOOL_RESULT_CHARS } from "../../src/context.js";
import { BaseToolset } from "../../src/toolset.js";
import type { ToolContext, ToolSchema } from "../../src/toolset.js";
import type { ToolCall, ToolResult } from "../../src/types.js";

export class HugeToolset extends BaseToolset {
  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "huge",
        description: "Returns an oversized result.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(call: ToolCall, _context: ToolContext): Promise<ToolResult> {
    return {
      callId: call.id,
      content: "x".repeat(MAX_TOOL_RESULT_CHARS + 500),
    };
  }
}
