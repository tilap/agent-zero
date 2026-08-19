import { afterEach, describe, expect, it } from "vitest";
import { McpConnectionError } from "../src/errors.js";
import { McpToolset } from "../src/mcp.js";
import type { SseFixtureHandle } from "./support/mcp-sse-fixture.js";
import { startSseFixture } from "./support/mcp-sse-fixture.js";

describe("McpToolset.connectSse", () => {
  let fixture: SseFixtureHandle | undefined;
  let toolset: McpToolset | undefined;

  afterEach(async () => {
    await toolset?.close();
    await fixture?.close();
    toolset = undefined;
    fixture = undefined;
  });

  it("lists the fixture server's tools, prefixed", async () => {
    fixture = await startSseFixture();
    toolset = await McpToolset.connectSse({
      name: "fixture",
      url: fixture.url,
    });

    const tools = await toolset.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["fixture__echo"]);
  });

  it("round-trips a tool call", async () => {
    fixture = await startSseFixture();
    toolset = await McpToolset.connectSse({
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

  it("rejects with McpConnectionError for an unreachable url", async () => {
    await expect(
      McpToolset.connectSse({ name: "fixture", url: "http://127.0.0.1:1/sse" }),
    ).rejects.toThrow(McpConnectionError);
  });

  it("close() ends the stream; a later call rejects", async () => {
    fixture = await startSseFixture();
    const closed = await McpToolset.connectSse({
      name: "fixture",
      url: fixture.url,
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
