import { BaseToolset } from "../../src/toolset.js";
import type { ToolCall, ToolResult, ToolSchema } from "../../src/toolset.js";

export class ThrowingToolset extends BaseToolset {
  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "explode",
        description: "Always throws.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    throw new Error("boom");
  }
}
