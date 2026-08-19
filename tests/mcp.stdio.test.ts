import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpConfigError, McpConnectionError } from "../src/errors.js";
import { McpToolset } from "../src/mcp.js";

const FIXTURE = join(import.meta.dirname, "fixtures/mcp/stdio-server.mjs");
const TOKEN_VAR = "MCP_TEST_TOKEN";

describe("McpToolset.connectStdio", () => {
  let toolset: McpToolset | undefined;

  afterEach(async () => {
    await toolset?.close();
    toolset = undefined;
    delete process.env[TOKEN_VAR];
  });

  it("lists the fixture server's tools, prefixed", async () => {
    toolset = await McpToolset.connectStdio({
      name: "fixture",
      command: process.execPath,
      args: [FIXTURE],
    });

    const tools = await toolset.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "fixture__echo",
      "fixture__show_env",
    ]);
  });

  it("round-trips a tool call", async () => {
    toolset = await McpToolset.connectStdio({
      name: "fixture",
      command: process.execPath,
      args: [FIXTURE],
    });

    const result = await toolset.execute({
      id: "1",
      name: "fixture__echo",
      arguments: { text: "hello" },
    });

    expect(result.content).toBe("hello");
  });

  it("rejects with McpConnectionError for a nonexistent command", async () => {
    await expect(
      McpToolset.connectStdio({
        name: "fixture",
        command: "definitely-not-a-real-binary",
      }),
    ).rejects.toThrow(McpConnectionError);
  });

  it("substitutes ${VAR} in env before spawning", async () => {
    process.env[TOKEN_VAR] = "secret-value";
    toolset = await McpToolset.connectStdio({
      name: "fixture",
      command: process.execPath,
      args: [FIXTURE],
      env: { TOKEN: `\${${TOKEN_VAR}}` },
    });

    const result = await toolset.execute({
      id: "1",
      name: "fixture__show_env",
      arguments: {},
    });

    expect(result.content).toBe("secret-value");
  });

  it("throws McpConfigError for a missing env var, without spawning", async () => {
    await expect(
      McpToolset.connectStdio({
        name: "fixture",
        command: process.execPath,
        args: [FIXTURE],
        env: { TOKEN: "${MCP_DEFINITELY_UNSET_VAR}" },
      }),
    ).rejects.toThrow(McpConfigError);
  });

  it("close() ends the process; a later call rejects", async () => {
    const closed = await McpToolset.connectStdio({
      name: "fixture",
      command: process.execPath,
      args: [FIXTURE],
    });

    await closed.close();

    await expect(
      closed.execute({
        id: "1",
        name: "fixture__echo",
        arguments: { text: "hi" },
      }),
    ).rejects.toThrow();
  });
});
