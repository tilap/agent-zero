import { describe, expect, it } from "vitest";
import { McpToolset } from "../src/modules/mcp/index.js";
import { SandboxExecError } from "../src/modules/sandbox/errors.js";
import {
  LocalDirRunner,
  McpSandboxRunner,
  RemoteSandboxRunner,
  SandboxToolset,
} from "../src/modules/sandbox/index.js";
import { FakeMcpSession } from "./support/fake-mcp-session.js";
import { startSandboxHttpFixture } from "./support/sandbox-http-fixture.js";

function textResult(text: string, isError = false) {
  return isError
    ? { content: [{ type: "text" as const, text }], isError: true }
    : { content: [{ type: "text" as const, text }] };
}

describe("McpSandboxRunner", () => {
  it("execs through the connected toolset and parses the JSON response", async () => {
    const session = new FakeMcpSession(
      [
        { name: "exec", description: "", inputSchema: {} },
        { name: "read", description: "", inputSchema: {} },
        { name: "write", description: "", inputSchema: {} },
      ],
      {
        exec: () =>
          textResult(
            JSON.stringify({ stdout: "hi\n", stderr: "", exitCode: 0 }),
          ),
      },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.setup();
    const result = await runner.exec("echo hi", { cwd: "sub" });
    expect(result).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
    expect(session.calls[0]).toMatchObject({
      name: "exec",
      args: { command: "echo hi", cwd: "sub" },
    });
  });

  it("rejects with SandboxExecError on a non-JSON exec response", async () => {
    const session = new FakeMcpSession(
      [{ name: "exec", description: "", inputSchema: {} }],
      { exec: () => textResult("not json") },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.setup();
    await expect(runner.exec("echo hi")).rejects.toThrow(SandboxExecError);
  });

  it("rejects with SandboxExecError when the tool result is isError", async () => {
    const session = new FakeMcpSession(
      [{ name: "exec", description: "", inputSchema: {} }],
      { exec: () => textResult("boom", true) },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.setup();
    await expect(runner.exec("echo hi")).rejects.toThrow(SandboxExecError);
  });

  it("round-trips read/write using the plain-text convention", async () => {
    const session = new FakeMcpSession(
      [
        { name: "read", description: "", inputSchema: {} },
        { name: "write", description: "", inputSchema: {} },
      ],
      {
        read: () => textResult("file contents"),
        write: () => textResult("ok"),
      },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.setup();
    await runner.write("notes.txt", "hi");
    expect(await runner.read("notes.txt")).toBe("file contents");
  });

  it("respects custom tool names instead of the defaults", async () => {
    const session = new FakeMcpSession(
      [{ name: "run_shell", description: "", inputSchema: {} }],
      {
        run_shell: () =>
          textResult(JSON.stringify({ stdout: "ok", stderr: "", exitCode: 0 })),
      },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({
      toolset,
      toolNames: { exec: "run_shell" },
    });
    await runner.setup();
    const result = await runner.exec("anything");
    expect(result.stdout).toBe("ok");
  });

  it("forwards SandboxExecOptions.signal to the underlying MCP call", async () => {
    const session = new FakeMcpSession(
      [{ name: "exec", description: "", inputSchema: {} }],
      {
        exec: () =>
          textResult(
            JSON.stringify({ stdout: "hi\n", stderr: "", exitCode: 0 }),
          ),
      },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.setup();
    const controller = new AbortController();

    await runner.exec("echo hi", { signal: controller.signal });

    expect(session.calls[0]?.signal).toBe(controller.signal);
  });

  it("aclose() closes the underlying session", async () => {
    const session = new FakeMcpSession([]);
    const toolset = new McpToolset(session, { name: "sbx" });
    const runner = new McpSandboxRunner({ toolset });
    await runner.aclose();
    expect(session.closed).toBe(true);
  });
});

describe("SandboxToolset does not branch on runner type", () => {
  it("produces the same listTools() and exec() shape for every runner", async () => {
    const local = new LocalDirRunner();
    await local.setup();

    const fixture = await startSandboxHttpFixture({
      execResults: { "echo hi": { stdout: "hi\n", stderr: "", exitCode: 0 } },
    });
    const remote = new RemoteSandboxRunner({ baseUrl: fixture.url });
    await remote.setup();

    const session = new FakeMcpSession(
      [{ name: "exec", description: "", inputSchema: {} }],
      {
        exec: () =>
          textResult(
            JSON.stringify({ stdout: "hi\n", stderr: "", exitCode: 0 }),
          ),
      },
    );
    const toolset = new McpToolset(session, { name: "sbx" });
    const mcp = new McpSandboxRunner({ toolset });
    await mcp.setup();

    try {
      for (const runner of [local, remote, mcp]) {
        const sandboxToolset = new SandboxToolset(runner);
        const tools = await sandboxToolset.listTools();
        expect(tools.map((tool) => tool.name)).toEqual([
          "exec",
          "read",
          "write",
        ]);
        const result = await sandboxToolset.execute(
          { id: "1", name: "exec", arguments: { command: "echo hi" } },
          {},
        );
        expect(result.callId).toBe("1");
        expect(result.isError).toBeFalsy();
        expect(result.content).toContain("hi");
      }
    } finally {
      await local.aclose();
      await remote.aclose();
      await mcp.aclose();
      await fixture.close();
    }
  });
});
