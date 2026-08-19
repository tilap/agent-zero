// Test fixture: a tiny hand-written MCP server, speaking the same
// newline-delimited JSON-RPC subset the stdio client in src/modules/mcp
// expects. It exists to give the client something real to talk to
// without depending on a third-party MCP implementation.
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, terminal: false });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

rl.on("line", (line) => {
  if (line.trim() === "") {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "fixture-stdio-server", version: "0.0.0" },
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo the given text back.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          {
            name: "show_env",
            description: "Return the TOKEN environment variable this process saw.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params ?? {};
    if (name === "echo") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: textResult(String(args?.text ?? "")),
      });
      return;
    }
    if (name === "show_env") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: textResult(process.env.TOKEN ?? ""),
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
  }
});
