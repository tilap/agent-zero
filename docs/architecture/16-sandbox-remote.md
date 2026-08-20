# 16 — Sandbox (remote runners)

## What this ships

Two more `SandboxRunner` implementations (Phase 15's protocol) in the
same `src/modules/sandbox/index.ts`: `RemoteSandboxRunner`, over a
small HTTP contract this repo defines itself, and `McpSandboxRunner`,
which adapts an already-connected `McpToolset` (Phases 7–8, any
transport) to the same five methods. `SandboxToolset` is not touched —
it only ever depended on the `SandboxRunner` interface.

## Public types

```ts
// RemoteSandboxRunner — this repo's own minimal HTTP contract, not a
// specific vendor's API (same spirit as Phase 18's "OpenAI-shaped"
// hosted provider: a concrete shape, not a claim of universality).
export interface RemoteSandboxRunnerOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch; // injectable for tests; defaults to global fetch
}
export class RemoteSandboxRunner implements SandboxRunner {
  constructor(options: RemoteSandboxRunnerOptions);
}

// McpSandboxRunner — adapts an already-connected McpToolset to the
// SandboxRunner shape.
export interface McpSandboxRunnerToolNames {
  readonly exec?: string; // default "exec"
  readonly read?: string; // default "read"
  readonly write?: string; // default "write"
}
export interface McpSandboxRunnerOptions {
  readonly toolset: McpToolset;
  readonly toolNames?: McpSandboxRunnerToolNames;
}
export class McpSandboxRunner implements SandboxRunner {
  constructor(options: McpSandboxRunnerOptions);
}
```

## Behaviour

**`RemoteSandboxRunner`'s HTTP contract.** `exec`/`read`/`write`
throw `SandboxNotReadyError` — a client-side check, no request sent —
before `setup()` has run, same contract `LocalDirRunner` already has.

- `setup()` → `POST {baseUrl}/sessions`, response `{ sessionId }`,
  stored for every later call.
- `exec(command, options)` → `POST /sessions/{id}/exec` with
  `{ command, cwd?, timeoutMs? }`; a `{ stdout, stderr, exitCode }`
  response resolves normally (nonzero `exitCode` included, same rule
  as `LocalDirRunner` — P30); `{ timedOut: true }` throws
  `SandboxTimeoutError`; a non-2xx response throws `SandboxExecError`.
- `read(path)` → `GET /sessions/{id}/files?path=`; the response body
  is the file content; a 404 throws `SandboxIoError`.
- `write(path, content)` → `PUT /sessions/{id}/files?path=` with
  `content` as the body; non-2xx throws `SandboxIoError`.
- `aclose()` → `DELETE /sessions/{id}`; a no-op if `setup()` was never
  called, same tolerance `LocalDirRunner.aclose()` already has.
- `options.headers` (from the constructor) are sent on every request —
  a caller's job to fill in (bearer tokens, etc.); no `${VAR}`
  substitution reinvented here, that stays MCP's own concern.
- No client-side path containment (P28) — whatever server sits behind
  `baseUrl` owns that boundary; this runner only forwards paths.

**`McpSandboxRunner`.** Wraps an `McpToolset` the caller already
connected. `setup()` is a no-op (the toolset is already connected by
the time it is passed in). `aclose()` calls the toolset's own public
`close()` (which closes its underlying session). Every
`SandboxRunner` method calls `toolset.execute({ id, name:
toolNames.<x>, arguments })` — i.e. goes through `McpToolset`'s
already-public `execute`, never a new session API; nothing under
`src/modules/mcp/` changes. `McpToolset.execute` takes no
`ToolContext`, so `SandboxExecOptions.signal` is accepted by
`McpSandboxRunner.exec` for interface conformance but has nothing to
forward to — cancelling an in-flight MCP tool call is not something
this phase adds.

- `exec`: the remote tool's text content must be a JSON string shaped
  `{ stdout, stderr, exitCode }`. A parse failure, or `result.isError`
  from the tool call itself, throws `SandboxExecError`.
- `read`: the remote tool's text content **is** the file's content,
  directly, no wrapping.
- `write`: any non-error result is treated as success.
- These are this module's own convention for "what an MCP exec server
  must expose to be adaptable" — not a rule MCP itself enforces.

**Cross-module import.** `sandbox/index.ts` imports `McpToolset` from
`../mcp/index.js`. D17 forbids **core** depending on modules; two
modules depending on each other for a feature that genuinely composes
both domains is a different thing — the first case of it in this
repo, not a violation of an existing rule.

## Non-goals

- No path-containment check in either new runner (P28) — see above.
- No retry/backoff policy for `RemoteSandboxRunner` — Phase 18
  introduces that pattern for a hosted LLM provider; sandbox does not
  need its own copy until a caller asks for one.
- No change to `McpToolset`/`src/modules/mcp/`.
- No shared parameterized "SandboxRunner contract" test helper (P31)
  — each runner's test file proves the contract independently, the
  same shape Phase 8's stdio/sse/http MCP tests already have.
