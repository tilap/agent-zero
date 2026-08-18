import { BaseToolset } from "../../src/toolset.js";
import type { ToolSchema } from "../../src/toolset.js";
import type { ToolCall, ToolResult } from "../../src/types.js";

const schemas: readonly ToolSchema[] = [
  {
    name: "add",
    description: "Add two numbers.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "divide",
    description: "Divide the first number by the second.",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
];

export class CalculatorToolset extends BaseToolset {
  async listTools(): Promise<readonly ToolSchema[]> {
    return schemas;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const a = Number(call.arguments.a);
    const b = Number(call.arguments.b);

    if (call.name === "add") {
      return { callId: call.id, content: String(a + b) };
    }

    if (call.name === "divide") {
      if (b === 0) {
        return {
          callId: call.id,
          content: "Cannot divide by zero.",
          isError: true,
        };
      }
      return { callId: call.id, content: String(a / b) };
    }

    return {
      callId: call.id,
      content: `Unknown tool: ${call.name}. Available: add, divide`,
      isError: true,
    };
  }
}
