import { afterEach, describe, expect, it } from "vitest";
import { McpConnectionError } from "../src/errors.js";
import { McpToolset } from "../src/mcp.js";
import type { HttpFixtureHandle } from "./support/mcp-http-fixture.js";
import { startHttpFixture } from "./support/mcp-http-fixture.js";

const TOKEN_VAR = "MCP_TEST_TOKEN";

describe("McpToolset.connectHttp", () => {
  let fixture: HttpFixtureHandle | undefined;
  let toolset: McpToolset | undefined;

  afterEach(async () => {
    await toolset?.close();
    await fixture?.close();
    toolset = undefined;
    fixture = undefined;
    delete process.env[TOKEN_VAR];
  });

  it("lists the fixture server's tools, prefixed", async () => {
    fixture = await startHttpFixture();
    toolset = await McpToolset.connectHttp({
      name: "fixture",
      url: fixture.url,
    });

    const tools = await toolset.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "fixture__echo",
      "fixture__show_headers",
    ]);
  });

  it("round-trips a tool call", async () => {
    fixture = await startHttpFixture();
    toolset = await McpToolset.connectHttp({
      name: "fixture",
      url: fixture.url,
    });

    const result = await toolset.execute({
      id: "1",
      name: "fixture__echo",
      arguments: { text: "hello" },
    });

    expect(result.content).toBe("hello");
  });

  it("substitutes ${VAR} in headers and sends the captured session id back", async () => {
    process.env[TOKEN_VAR] = "secret-value";
    fixture = await startHttpFixture();
    toolset = await McpToolset.connectHttp({
      name: "fixture",
      url: fixture.url,
      headers: { authorization: `Bearer \${${TOKEN_VAR}}` },
    });

    const result = await toolset.execute({
      id: "1",
      name: "fixture__show_headers",
      arguments: {},
    });

    const seen = JSON.parse(result.content) as {
      readonly authorization: string;
      readonly sessionId: string;
    };
    expect(seen.authorization).toBe("Bearer secret-value");
    expect(seen.sessionId).toBe("fixture-session-1");
  });

  it("rejects with McpConnectionError for an unreachable url", async () => {
    await expect(
      McpToolset.connectHttp({ name: "fixture", url: "http://127.0.0.1:1/" }),
    ).rejects.toThrow(McpConnectionError);
  });
});
