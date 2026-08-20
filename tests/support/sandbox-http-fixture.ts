import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export type FixtureExecResult =
  | {
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode: number;
    }
  | { readonly timedOut: true };

export interface SandboxHttpFixtureOptions {
  readonly execResults?: Readonly<Record<string, FixtureExecResult>>;
}

export interface SandboxHttpFixtureHandle {
  readonly url: string;
  readonly requests: RecordedRequest[];
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

// Test fixture: a tiny in-process HTTP server speaking the minimal
// contract RemoteSandboxRunner (docs/architecture/16-sandbox-remote.md)
// implements — this repo's own shape, not a real vendor's API.
export async function startSandboxHttpFixture(
  options: SandboxHttpFixtureOptions = {},
): Promise<SandboxHttpFixtureHandle> {
  const execResults = options.execResults ?? {};
  const files = new Map<string, string>();
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const body = await readBody(req);
    requests.push({
      method,
      path: url.pathname + url.search,
      headers: { ...req.headers } as Record<string, string | undefined>,
      body,
    });

    const respond = (status: number, payload?: unknown) => {
      if (payload === undefined) {
        res.writeHead(status).end();
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (method === "POST" && url.pathname === "/sessions") {
      respond(200, { sessionId: SESSION_ID });
      return;
    }

    const execMatch = url.pathname.match(/^\/sessions\/([^/]+)\/exec$/);
    if (method === "POST" && execMatch) {
      const parsed = JSON.parse(body) as { readonly command: string };
      const result = execResults[parsed.command];
      if (result === undefined) {
        respond(200, { stdout: "", stderr: "", exitCode: 0 });
        return;
      }
      respond(200, result);
      return;
    }

    const filesMatch = url.pathname.match(/^\/sessions\/([^/]+)\/files$/);
    if (method === "GET" && filesMatch) {
      const path = url.searchParams.get("path") ?? "";
      const content = files.get(path);
      if (content === undefined) {
        respond(404);
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(content);
      return;
    }
    if (method === "PUT" && filesMatch) {
      const path = url.searchParams.get("path") ?? "";
      files.set(path, body);
      respond(200, {});
      return;
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (method === "DELETE" && sessionMatch) {
      respond(200, {});
      return;
    }

    respond(404);
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
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
