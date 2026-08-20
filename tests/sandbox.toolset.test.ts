import { describe, expect, it } from "vitest";
import {
  LocalDirRunner,
  SandboxToolset,
} from "../src/modules/sandbox/index.js";
import { ToolsetRouter } from "../src/toolset.js";

describe("SandboxToolset", () => {
  it("reports a clean exec as successful", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const toolset = new SandboxToolset(runner);
    const result = await toolset.execute(
      { id: "1", name: "exec", arguments: { command: "echo hi" } },
      {},
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("hi");
    await runner.aclose();
  });

  it("marks a nonzero exit as isError", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const toolset = new SandboxToolset(runner);
    const result = await toolset.execute(
      { id: "1", name: "exec", arguments: { command: "exit 1" } },
      {},
    );
    expect(result.isError).toBe(true);
    await runner.aclose();
  });

  it("round-trips write then read", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const toolset = new SandboxToolset(runner);
    await toolset.execute(
      {
        id: "1",
        name: "write",
        arguments: { path: "notes.txt", content: "hi" },
      },
      {},
    );
    const result = await toolset.execute(
      { id: "2", name: "read", arguments: { path: "notes.txt" } },
      {},
    );
    expect(result).toMatchObject({ callId: "2", content: "hi" });
    await runner.aclose();
  });

  it("lets a thrown SandboxIoError reach the router as an isError result", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const router = new ToolsetRouter([new SandboxToolset(runner)]);
    const result = await router.execute({
      id: "1",
      name: "read",
      arguments: { path: "nope.txt" },
    });
    expect(result.isError).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    await runner.aclose();
  });
});
