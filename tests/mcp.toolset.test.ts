import { describe, expect, it } from "vitest";
import { McpToolset } from "../src/mcp.js";
import { ToolsetRouter } from "../src/toolset.js";
import { FakeMcpSession } from "./support/fake-mcp-session.js";

describe("McpToolset", () => {
  it("prefixes every listed tool name with the server name", async () => {
    const session = new FakeMcpSession([
      {
        name: "echo",
        description: "Echo text.",
        inputSchema: { type: "object" },
      },
    ]);
    const toolset = new McpToolset(session, { name: "demo" });

    const tools = await toolset.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["demo__echo"]);
  });

  it("keeps only tools allowed by the filter, matched unprefixed", async () => {
    const session = new FakeMcpSession([
      { name: "echo", description: "", inputSchema: { type: "object" } },
      { name: "shout", description: "", inputSchema: { type: "object" } },
    ]);
    const toolset = new McpToolset(session, { name: "demo", only: ["echo"] });

    const tools = await toolset.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["demo__echo"]);
  });

  it("execute strips the prefix and calls the session with the remote name", async () => {
    const session = new FakeMcpSession(
      [{ name: "echo", description: "", inputSchema: { type: "object" } }],
      { echo: { content: [{ type: "text", text: "hi" }] } },
    );
    const toolset = new McpToolset(session, { name: "demo" });

    await toolset.execute({
      id: "1",
      name: "demo__echo",
      arguments: { text: "hi" },
    });

    expect(session.calls).toEqual([{ name: "echo", args: { text: "hi" } }]);
  });

  it("joins multi-part text content into one string", async () => {
    const session = new FakeMcpSession(
      [{ name: "echo", description: "", inputSchema: { type: "object" } }],
      {
        echo: {
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      },
    );
    const toolset = new McpToolset(session, { name: "demo" });

    const result = await toolset.execute({
      id: "1",
      name: "demo__echo",
      arguments: {},
    });

    expect(result.content).toBe("line one\nline two");
  });

  it("passes isError through from the session result", async () => {
    const session = new FakeMcpSession(
      [{ name: "echo", description: "", inputSchema: { type: "object" } }],
      { echo: { content: [{ type: "text", text: "boom" }], isError: true } },
    );
    const toolset = new McpToolset(session, { name: "demo" });

    const result = await toolset.execute({
      id: "1",
      name: "demo__echo",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });

  it("a rejecting session becomes an error result through the router", async () => {
    const session = new FakeMcpSession(
      [{ name: "echo", description: "", inputSchema: { type: "object" } }],
      {
        echo: () => {
          throw new Error("network down");
        },
      },
    );
    const router = new ToolsetRouter([
      new McpToolset(session, { name: "demo" }),
    ]);

    const result = await router.execute({
      id: "1",
      name: "demo__echo",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });
});
