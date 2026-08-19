# 07 — MCP (stdio)

## What this ships

`McpToolset`: an MCP server, wrapped as a toolset. `McpToolset.connectStdio`
spawns a server process and speaks a hand-rolled subset of MCP's JSON-RPC
protocol over its stdin/stdout — no `@modelcontextprotocol/sdk` dependency.
Everything `McpToolset` itself does (prefixing, filtering, mapping results)
is independent of that choice: it only ever talks to an `McpSession`, a
small interface any client implementation can satisfy.

## Public types

```ts
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
}

export interface McpSession {
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface StdioMcpServerOptions {
  readonly name: string; // tool-name prefix
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>; // "${VAR}" substituted from process.env
  readonly only?: readonly string[]; // allowlist of remote (unprefixed) tool names
}

export class McpToolset extends BaseToolset {
  constructor(session: McpSession, options: { readonly name: string; readonly only?: readonly string[] });
  static connectStdio(options: StdioMcpServerOptions): Promise<McpToolset>;
  listTools(): Promise<readonly ToolSchema[]>;
  execute(call: ToolCall): Promise<ToolResult>;
  close(): Promise<void>;
}

export class McpConnectionError extends Error {}
export class McpConfigError extends Error {}
export class McpProtocolError extends Error {}
```

## Behaviour

- `McpToolset` never spawns anything itself — it wraps whatever
  `McpSession` it is given. `connectStdio` is a static factory that
  builds the one session implementation this phase ships and hands it to
  the constructor. Every other behaviour below is exercised through the
  constructor with a fake session in tests; only the stdio session itself
  is tested against a real child process.
- `listTools()` calls `session.listTools()`, drops any tool not in
  `only` when set (matched against the session's own, unprefixed name),
  then renames every survivor `${name}__${toolName}` and maps
  `inputSchema` to `ToolSchema.parameters`.
- `execute(call)` strips the `${name}__` prefix to recover the remote
  name and calls `session.callTool(remoteName, call.arguments)`.
  `content` (one or more `{type:"text", text}` items) is joined with
  `"\n"`; `isError` passes through unchanged. A throw from the session
  is not caught here — `ToolsetRouter` already converts a throwing
  toolset into an `isError` result, so this stays consistent with every
  other toolset since Phase 3.
- `connectStdio`: substitutes `${VAR}` tokens in `options.env` from
  `process.env` first — a missing variable throws `McpConfigError`
  before anything is spawned (a setup mistake). It then spawns
  `command`, performs the MCP `initialize` handshake, and sends
  `notifications/initialized`. A spawn failure, a process that exits
  before answering, or a JSON-RPC error response to `initialize` all
  reject with `McpConnectionError` — connecting is setup, not run-time,
  so it throws rather than becoming an event.
- Wire format: newline-delimited JSON-RPC 2.0 over the child's
  stdin/stdout. Requests are matched to responses by a numeric `id`; a
  JSON-RPC error response rejects that one call with `McpProtocolError`.
  `close()` kills the child process and rejects any calls still pending.

## Non-goals

Shared with Phase 8 (MCP transports), stated once here:

- Resources, prompts, sampling, roots — anything that is not a tool call.
- Reconnection, resumable streams, a connect timeout. A hung server
  blocks forever; `close()` is the caller's escape hatch.
- Full JSON-RPC batching.

This client speaks only enough MCP to list and call tools, validated
against a fixture server written in this repo, not the reference SDK or
a real third-party server. If a real server ever refuses to talk to it,
the escape hatch is an adapter from `@modelcontextprotocol/sdk`'s
`Client` to `McpSession` — `McpToolset` never sees anything but that
interface, so nothing else has to change.
