# 08 — MCP transports (SSE, HTTP)

## What this ships

`McpToolset.connectSse` and `McpToolset.connectHttp`, next to Phase 7's
`connectStdio`. Same toolset, same prefixing, same `only` filter, same
`${VAR}` substitution (now over `headers` instead of `env`) — only the
wire connection changes. Both are hand-rolled, like stdio, and stay
entirely behind `McpSession`.

## Public types

```ts
export interface SseMcpServerOptions {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>; // "${VAR}" substituted
  readonly only?: readonly string[];
}

export interface HttpMcpServerOptions {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly only?: readonly string[];
}

export class McpToolset extends BaseToolset {
  // … Phase 7 members …
  static connectSse(options: SseMcpServerOptions): Promise<McpToolset>;
  static connectHttp(options: HttpMcpServerOptions): Promise<McpToolset>;
}
```

## Behaviour

- **HTTP** is one `POST url` per JSON-RPC message, body and response both
  plain JSON — no persistent connection, no pending-request bookkeeping.
  If the `initialize` response carries an `Mcp-Session-Id` header, it is
  captured and sent back as a request header on every later call; that is
  the one piece of session state this client keeps.
- **SSE** opens `GET url` with `Accept: text/event-stream`. The first
  `endpoint` event's `data` is the URL later JSON-RPC requests are
  `POST`ed to (resolved against the stream URL if relative). Responses
  arrive asynchronously as `message` events on the same stream and are
  matched to pending requests by `id` — the same bookkeeping stdio uses,
  now shared between the two instead of duplicated, since SSE is the
  second caller that needs it (P8: build the shared piece when a second
  caller shows up, not before).
- Both factories substitute `${VAR}` in `headers` from `process.env`
  before connecting — a missing variable throws `McpConfigError`, same as
  `env` in Phase 7, before any network call is made.
- `close()` on the SSE session aborts the open stream and rejects any
  requests still pending; on the HTTP session it just drops the captured
  session id — there is no connection to release.
- Connect failures (network error, non-2xx on `initialize`, a stream that
  never emits `endpoint`) reject with `McpConnectionError`, same as
  stdio.

## Non-goals

Same list as Phase 7's framing doc, plus: the "response as its own SSE
stream" case of Streamable HTTP is not handled — this client only reads
a single JSON response body per HTTP request. A server that requires
that mode needs the SDK-based `McpSession` adapter mentioned in Phase 7.
