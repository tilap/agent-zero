# 04 — Bounds and cancel

## What this ships

`maxRounds` enforcement, cancellation through an `AbortSignal`, and two
new terminal events: `cancelled` and `error`. Production safety, still no
façade.

## Public types

```ts
export type Event =
  | /* … phases 2–3 … */
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly error: Error };

export class AgentLoop {
  run(
    request: RunRequest,
    options?: { readonly signal?: AbortSignal },
  ): AsyncGenerator<Event, void, void>;
}

export class MaxRoundsExceededError extends Error {}

export interface ToolContext {
  readonly signal?: AbortSignal;
}

export abstract class BaseToolset {
  abstract execute(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}
```

## Behaviour

- `maxRounds` defaults to **10**, counting from round 1.
- On the last round the request carries no tools: `tools` is `undefined`,
  never `[]`. Absence and "zero tools" are different claims to a
  provider.
- If the model still returns tool calls on the last round, they are
  **not executed**. Text alongside them still produces `final_text`; no
  text produces `error` with `MaxRoundsExceededError`. The turn is never
  silently dropped.
- `ToolContext` is born here with exactly one field, `signal`, forwarded
  by the router to every `execute` call — a long-running tool can now
  observe that the run it belongs to no longer exists.
- Cancellation is checked before the first round, at the start of every
  round, and after every tool result. An already-aborted signal yields
  one `cancelled` event and the provider is never called.
- A provider or toolset-setup failure emits `error` and the generator
  returns normally — it does not throw. Programmer errors (`stream: true`,
  a duplicate tool name) still throw eagerly; those are bugs, not run-time
  data.
- Exactly one terminal event per run: `final_text` | `cancelled` | `error`.

## Non-goals

Nothing from Phase 5 onward: no workspace, no façade, no parallel tool
execution.
