# 05 — Agent façade

## What this ships

`Agent` (`run` / `runSync`), `RunResult`, and a per-run workspace. The
runner that drives the loop stays private behind `Agent` — this is the
first increment with a public entry point (`src/index.ts`), so anything
not re-exported from it is an implementation detail. Later increments
add `hooks` (09) and `contextCompactor` (10) to `AgentOptions`. Skills
are not an Agent option; wire them as a system prompt plus a toolset
(06), the same way as MCP.

## Public types

```ts
export interface WorkspaceOptions {
  readonly path?: string; // absolute path; omitted means an ephemeral temp dir per run
}

export interface AgentOptions {
  readonly provider: LlmProvider;
  readonly toolsets?: readonly BaseToolset[];
  readonly systemPrompt?: string;
  readonly maxRounds?: number;
  readonly workspace?: WorkspaceOptions;
}

export type StopReason = "final_text" | "max_rounds" | "cancelled" | "error";

export interface RunResult {
  readonly text: string; // "" unless stopReason is "final_text"
  readonly events: readonly Event[];
  readonly rounds: number;
  readonly stopReason: StopReason;
  readonly error?: Error;
}

export class Agent {
  constructor(options: AgentOptions);
  run(
    input: string | RunRequest,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<Event, void, void>;
  runSync(
    input: string | RunRequest,
    options?: { signal?: AbortSignal },
  ): Promise<RunResult>;
}

export interface ToolContext {
  readonly signal?: AbortSignal;
  readonly workspace?: string;
}
```

## Behaviour

- `run(input)` accepts a bare string as shorthand for
  `{ userMessage: input }`.
- Without `workspace.path`, a temp directory is created before the first
  round and removed after the run ends for any terminal reason —
  `final_text`, `cancelled`, or `error` alike. With a path given, it is
  created if missing and never removed: deleting a directory the caller
  named is not this library's call to make.
- `ToolContext.workspace` stays optional at the type level — `AgentLoop`
  and `ToolsetRouter` are still usable standalone, without a workspace,
  as they were in Phases 3–4. Going through `Agent`, it is always
  populated in practice; a tool that only ever runs behind `Agent` can
  treat it as present.
- `stopReason` derives from the run's single terminal event (Phase 4):
  `max_rounds` is the `error` case whose `error` is a
  `MaxRoundsExceededError`; anything else stays a generic `error`.
- `runSync` fully drains `run` into a `RunResult`. The name describes
  "runs to completion", not synchronous execution — it still returns a
  promise.

## Non-goals

Parallel tool execution and steering. `Runner` is not exported; the
façade is the only public surface.
