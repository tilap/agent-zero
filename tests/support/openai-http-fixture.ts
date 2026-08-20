import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
}

export interface JsonFixtureResponse {
  readonly type: "json";
  readonly status?: number;
  readonly body: unknown;
  readonly delayMs?: number;
}

export interface SseFixtureResponse {
  readonly type: "sse";
  readonly events: readonly string[];
  readonly chunkDelayMs?: number;
}

export interface HangFixtureResponse {
  readonly type: "hang";
  readonly delayMs: number;
}

export type FixtureResponse =
  | JsonFixtureResponse
  | SseFixtureResponse
  | HangFixtureResponse;

export interface OpenAiHttpFixtureHandle {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Test fixture: a tiny in-process HTTP server speaking the subset of
// OpenAI's chat completions API OpenAiProvider (Phase 18) implements.
// Responses are a queue: each request consumes the next one.
export async function startOpenAiHttpFixture(
  responses: readonly FixtureResponse[],
): Promise<OpenAiHttpFixtureHandle> {
  let cursor = 0;
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    let body: unknown = raw;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : undefined;
    } catch {
      // keep the raw string if it isn't JSON
    }
    requests.push({
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers: { ...req.headers } as Record<string, string | undefined>,
      body,
    });

    const response = responses[cursor];
    cursor += 1;
    if (response === undefined) {
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(
          JSON.stringify({ error: { message: "no fixture response queued" } }),
        );
      return;
    }

    if (response.type === "hang") {
      await delay(response.delayMs);
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }

    if (response.type === "json") {
      if (response.delayMs !== undefined) {
        await delay(response.delayMs);
      }
      res
        .writeHead(response.status ?? 200, {
          "content-type": "application/json",
        })
        .end(JSON.stringify(response.body));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const event of response.events) {
      if (response.chunkDelayMs !== undefined) {
        await delay(response.chunkDelayMs);
      }
      res.write(`data: ${event}\n\n`);
    }
    res.end();
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
