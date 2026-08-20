# 15 — Sandbox (local)

## What this ships

A `SandboxRunner` protocol — `setup`, `exec`, `read`, `write`,
`aclose` — plus its first implementation, `LocalDirRunner`, and
`SandboxToolset`, the toolset that exposes those five methods as
`exec`/`read`/`write` tools to a model. All three live under
`src/modules/sandbox/`, born there (no earlier location to move from).

This is a toolset like MCP (Phase 7) or skills (Phase 6): a caller
builds a runner, calls `setup()`, wraps it in `SandboxToolset`, and
adds it to `toolsets` by hand. Nothing here touches `AgentOptions` or
`RunnerOptions`.

## Public types

```ts
// src/modules/sandbox/errors.ts
export class SandboxNotReadyError extends Error {}
export class SandboxTimeoutError extends Error {}
export class SandboxExecError extends Error {}
export class SandboxIoError extends Error {}
export class SandboxPathEscapeError extends Error {}

// src/modules/sandbox/index.ts
export interface SandboxExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SandboxExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SandboxRunner {
  setup(): Promise<void>;
  exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  aclose(): Promise<void>;
}

export interface LocalDirRunnerOptions {
  readonly rootDir?: string; // absolute path; omitted means an ephemeral temp dir
}

export class LocalDirRunner implements SandboxRunner {
  constructor(options?: LocalDirRunnerOptions);
}

export class SandboxToolset extends BaseToolset {
  constructor(runner: SandboxRunner);
}
```

## Behaviour

**`LocalDirRunner.setup()`.** With `rootDir` given, creates it
(`mkdir(rootDir, { recursive: true })`) and never removes it. Without
one, creates an ephemeral temp directory
(`mkdtemp(join(tmpdir(), "agent-zero-sandbox-"))`) that `aclose()`
removes — the same ephemeral-vs-explicit shape `Agent`'s own
`WorkspaceOptions` already has (Phase 5), reimplemented here rather
than imported: this module cannot depend on core internals, and no
existing module shares helpers with another one this way either.
Every other method throws `SandboxNotReadyError` before `setup()` has
run.

**Path containment.** `read`, `write`, and `exec`'s `cwd` all resolve
against the root and reject — `SandboxPathEscapeError`, before any
filesystem access — an absolute input path, or a relative one whose
resolved form does not stay inside the root. This is `LocalDirRunner`
enforcing a boundary it owns directly; it says nothing about what a
future remote runner should do with its own filesystem.

**`exec`.** Runs `command` through `node:child_process.exec` with
`cwd` set to the (contained) directory, `signal` forwarded straight to
Node's own `signal` option, and `timeout` forwarded to `timeoutMs`
when given.

- A clean exit resolves `{ stdout, stderr, exitCode: 0 }`.
- A **nonzero** exit also resolves — `{ stdout, stderr, exitCode }` —
  not a throw. `exitCode` is a normal part of the result; only
  `SandboxToolset` (below) turns a nonzero code into a model-visible
  error.
- A timeout throws `SandboxTimeoutError`.
- Anything else that stops the command from ever running (e.g. no
  shell available) throws `SandboxExecError`.

**`read`/`write`.** Plain UTF-8 file I/O against the contained path.
`write` creates parent directories first, so a nested path needs no
separate setup. Any `fs` failure (missing file on `read`, permission
error, …) is wrapped in `SandboxIoError`.

**`aclose`.** Removes the root only if it was created ephemeral; an
explicit `rootDir` is left exactly as `WorkspaceOptions` leaves an
explicit workspace path.

**`SandboxToolset`.** Three tools — `exec` (`command`, optional `cwd`,
optional `timeoutMs`), `read` (`path`), `write` (`path`, `content`).
`execute()` calls the matching runner method and forwards
`context.signal` into `exec`'s options; `context.workspace` (Phase 5)
is never read — a `SandboxRunner`'s root and an `Agent` run's
per-run scratch directory are unrelated. For `exec`, the result
reports `stdout`/`stderr`/`exitCode` in one string and sets
`isError: true` exactly when `exitCode !== 0`. There is no local
`try`/`catch`: a thrown `Sandbox*Error` reaches
`ToolsetRouter.execute`'s existing catch-all (Phase 3) and becomes an
`isError` tool result the same way any other toolset's exception
already does.

## Composing with approval

`SandboxToolset` knows nothing about `ApprovalPolicy` (Phase 14) and
never will — a caller who wants a human to approve `exec`/`write`
calls before they run writes an ordinary policy,
`{ requiresApproval: (call) => call.name === "exec" }`, and passes it
to `Runner` like any other. The two features compose because both are
built on the same `ToolCall` shape; nothing sandbox-specific is
needed to make it work.

## Non-goals

- **Not a security boundary.** `LocalDirRunner` scopes *paths*; it
  does not sandbox the *command* `exec` runs. A model with `exec`
  access can do anything the host OS user can do outside the declared
  root — read other files, reach the network, spawn other processes.
  A real isolation boundary is a different runner behind the same
  protocol (Phase 16), not a property of this one.
- No automatic wiring into `AgentOptions`/`RunnerOptions` — build a
  runner, call `setup()`, construct `SandboxToolset`, add it to
  `toolsets`, same as MCP.
- No built-in approval gating — composes with Phase 14, does not
  depend on it or require it.
- No resource limits (CPU, memory, disk quota).
