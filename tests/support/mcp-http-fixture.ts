import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

export interface HttpFixtureHandle {
  readonly url: string;
  close(): Promise<void>;
}

const SESSION_ID = "fixture-session-1";

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

// Test fixture: a tiny in-process HTTP server speaking the single-JSON-
// response subset of MCP's Streamable HTTP transport that src/modules/mcp
// implements — one POST per JSON-RPC message, an Mcp-Session-Id header
// captured from the initialize response.
export async function startHttpFixture(): Promise<HttpFixtureHandle> {
  const server = createServer(async (req, res) => {
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

    const respond = (
      payload: unknown,
      extraHeaders: Record<string, string> = {},
    ) => {
      res.writeHead(200, {
        "content-type": "application/json",
        ...extraHeaders,
      });
      res.end(JSON.stringify(payload));
    };

    if (message.method === "initialize") {
      respond(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            serverInfo: { name: "fixture-http-server", version: "0.0.0" },
          },
        },
        { "mcp-session-id": SESSION_ID },
      );
      return;
    }

    if (message.method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }

    if (message.method === "tools/list") {
      respond({
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
              name: "show_headers",
              description:
                "Report the authorization and session headers this call carried.",
              inputSchema: { type: "object", properties: {} },
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
        respond({
          jsonrpc: "2.0",
          id: message.id,
          result: textResult(String(args.text ?? "")),
        });
        return;
      }
      if (name === "show_headers") {
        respond({
          jsonrpc: "2.0",
          id: message.id,
          result: textResult(
            JSON.stringify({
              authorization: req.headers.authorization ?? "",
              sessionId: req.headers["mcp-session-id"] ?? "",
            }),
          ),
        });
        return;
      }
      respond({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unknown tool: ${String(name)}` },
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture HTTP server failed to bind.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
