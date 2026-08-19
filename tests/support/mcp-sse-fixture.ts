import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface SseFixtureHandle {
  readonly url: string;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

// Test fixture: a tiny in-process SSE server speaking the legacy
// HTTP+SSE subset of MCP that src/modules/mcp implements — a GET stream
// announcing a POST endpoint via an "endpoint" event, JSON-RPC
// responses delivered asynchronously as "message" events.
export async function startSseFixture(): Promise<SseFixtureHandle> {
  let streamRes: ServerResponse | undefined;

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/sse") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      streamRes = res;
      res.write("event: endpoint\ndata: /messages\n\n");
      req.on("close", () => {
        streamRes = undefined;
      });
      return;
    }

    if (req.method === "POST" && req.url === "/messages") {
      const body = await readBody(req);
      let message: {
        readonly id?: number;
        readonly method?: string;
        readonly params?: Record<string, unknown>;
      };
      try {
        message = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(202).end();

      const sendMessage = (payload: unknown) => {
        streamRes?.write(
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      };

      if (message.method === "initialize") {
        sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "fixture-sse-server", version: "0.0.0" },
          },
        });
        return;
      }

      if (message.method === "notifications/initialized") {
        return;
      }

      if (message.method === "tools/list") {
        sendMessage({
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
            ],
          },
        });
        return;
      }

      if (message.method === "tools/call") {
        const params = message.params ?? {};
        const name = params.name;
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (name === "echo") {
          sendMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: textResult(String(args.text ?? "")),
          });
          return;
        }
        sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unknown tool: ${String(name)}` },
        });
      }
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture SSE server failed to bind.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/sse`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        streamRes?.end();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
