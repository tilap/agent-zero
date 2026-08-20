# 12 — Public Runner

## What this ships

`Runner`, `RunnerOptions`, and `RunnerRunOptions`, exported from
`src/index.ts`. Nothing about `Runner` itself changes — it already
owns the workspace lifecycle and already is what `Agent` builds and
delegates to internally (Phase 5). This phase only makes that fact
public, so a caller can hold the same handle `Agent` has always held
privately.

## Public types

```ts
export interface WorkspaceOptions {
  readonly path?: string;
}

export interface RunnerOptions {
  readonly provider: LlmProvider;
  readonly toolsets?: readonly BaseToolset[];
  readonly maxRounds?: number;
  readonly workspace?: WorkspaceOptions;
  readonly hooks?: Hooks;
  readonly contextCompactor?: ContextCompactor;
  readonly generationParams?: GenerationParams;
}

export interface RunnerRunOptions {
  readonly signal?: AbortSignal;
}

export class Runner {
  constructor(options: RunnerOptions);
  run(
    request: RunRequest,
    options?: RunnerRunOptions,
  ): AsyncGenerator<Event, void, void>;
}
```

`WorkspaceOptions` was already exported (Phase 5).

## Behaviour

- `Agent` is unchanged: it builds one `Runner` in its constructor from
  `AgentOptions`, and `run`/`runSync` forward to it. Nothing here
  alters that — this phase adds a second, direct way to reach the same
  class, not a new code path.
- A caller constructing `Runner` directly gets exactly what `Agent`
  gets internally: per-run workspace lifecycle (ephemeral by default,
  created and removed around the run; kept if an explicit path is
  given), `maxRounds`/`generationParams` each applied as a default only
  when the matching `RunRequest` field is not set, and
  `hooks`/`contextCompactor` forwarded straight into the `AgentLoop`
  it builds per call.
- `Runner.run` takes a `RunRequest` directly — no bare-string
  shorthand, and no `systemPrompt` default. `Agent` is still the only
  place that shorthand and default live (Phase 5); `Runner` is the
  lower-level surface those conveniences sit on top of.

## Why a caller would use `Runner` instead of `Agent`

`Agent.run`/`runSync` hand back an event stream or a final result —
never a handle to the thing producing them. A caller that needs to
reach *into* a run already in progress (queue a steering line, resolve
a pending approval — Phases 13–14) needs an object it can keep and
call methods on for the run's whole lifetime. That object is `Runner`.
A caller with no such need has no reason to move off `Agent`.

## Non-goals

No new `Runner` capability ships here — steering and approval are
Phases 13 and 14, both additions to `Runner` that need it to be public
first. `AgentOptions`/`Agent` gain nothing in this phase.
