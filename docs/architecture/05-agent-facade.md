# 05 — Agent façade

## What this ships

`Agent` (`run` / `runSync`), `RunResult`, and a per-run workspace. The
runner that drives the loop stays private behind `Agent` until Phase 10 —
this is the first phase with a public entry point (`src/index.ts`), so
anything not re-exported from it is an implementation detail.

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
  readonly workspace: string;
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
- `ToolContext.workspace` becomes required here (it was optional through
  Phase 4): by this phase every run has one, so an optional field would
  make every tool handle a case that cannot happen.
- `stopReason` derives from the run's single terminal event (Phase 4):
  `max_rounds` is the `error` case whose `error` is a
  `MaxRoundsExceededError`; anything else stays a generic `error`.
- `runSync` fully drains `run` into a `RunResult`. The name describes
  "runs to completion", not synchronous execution — it still returns a
  promise.

## Non-goals

Parallel tool execution, steering, hooks, skills, history — all later
phases. `Runner` is not exported; the façade is the only public surface.
