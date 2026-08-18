import { describe, expect, it } from "vitest";
import { DuplicateToolNameError } from "../src/errors.js";
import { ToolsetRouter } from "../src/toolset.js";
import { CalculatorToolset } from "./support/calculator.js";
import { ThrowingToolset } from "./support/throwing-toolset.js";

describe("ToolsetRouter", () => {
  it("merges schemas from several toolsets", async () => {
    const router = new ToolsetRouter([
      new CalculatorToolset(),
      new ThrowingToolset(),
    ]);
    const tools = await router.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add",
      "divide",
      "explode",
    ]);
  });

  it("rejects a duplicate tool name across toolsets", async () => {
    const router = new ToolsetRouter([
      new CalculatorToolset(),
      new CalculatorToolset(),
    ]);
    await expect(router.listTools()).rejects.toThrow(DuplicateToolNameError);
  });

  it("reports an unknown tool as an error result naming the available tools", async () => {
    const router = new ToolsetRouter([new CalculatorToolset()]);
    const result = await router.execute({
      id: "1",
      name: "multiply",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("multiply");
    expect(result.content).toContain("add");
  });

  it("converts a throwing toolset into an error result", async () => {
    const router = new ToolsetRouter([new ThrowingToolset()]);
    const result = await router.execute({
      id: "1",
      name: "explode",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("routes execute to the toolset that declared the name", async () => {
    const router = new ToolsetRouter([new CalculatorToolset()]);
    const result = await router.execute({
      id: "1",
      name: "add",
      arguments: { a: 2, b: 3 },
    });
    expect(result).toEqual({ callId: "1", content: "5" });
  });
});
