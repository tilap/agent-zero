# 11 — Parallel tools

## What this ships

Nothing new to import. When a model turn returns two or more tool
calls, `AgentLoop` now dispatches all of them at once instead of one
at a time. The fork from Phase 2 (text stops, tool calls loop) is
unchanged; this phase only changes how a turn's tool calls run once
that fork is taken.

## Public types

No new exported type, no new `Event` variant, no new `RunRequest` or
`AgentLoop` constructor field. `ToolsetRouter`, `BaseToolset`,
`ToolContext`, and every `Message`/`Event` shape are unchanged.

```ts
export class AgentLoop {
  async *run(
    request: RunRequest,
    options?: RunOptions,
  ): AsyncGenerator<Event, void, void>;
}
```

## Behaviour, per batch

A "batch" is every tool call a single model turn returned.

1. Emit a `tool_call` event for each call in the batch, in call order,
   before running any of them.
2. Start every call's pipeline concurrently — one `Promise` per call,
   all created in the same tick: `beforeTool` hook (if set) →
   `ToolsetRouter.execute` unless `beforeTool` already returned a
   result → `afterTool` hook (if set) → the Phase 10 result-size clip.
3. Wait for every pipeline to settle before observing any of them —
   `tool_result` events do not stream out as individual calls finish.
   - All fulfilled: emit a `tool_result` event for each result, in
     call order (not settle order), and push each as a `tool` message
     onto the transcript, same order. Continue to the next round.
   - One or more rejected (a throwing hook — `ToolsetRouter.execute`
     itself never throws, Phase 3): report the rejection belonging to
     the earliest call in the batch, emit one `{ type: "error" }`
     event, and stop the run. No `tool_result` event and no transcript
     push happens for any call in a batch that contained a rejection,
     including calls whose own pipeline fulfilled — matches Phase 9's
     "a hook throw is fatal", now defined for a batch instead of a
     single call.

**Cancellation.** The pre-round and pre-batch `signal?.aborted` checks
are unchanged. The per-call post-check that used to run after each
call in sequence now runs once, after the whole batch has settled: if
the signal is aborted at that point, emit `{ type: "cancelled" }` and
stop, without starting the next provider call. A call can still see
`context.signal` mid-flight and abort itself (unchanged, Phase 4); the
loop no longer promises that a sibling call already dispatched in the
same batch is skipped because of it — by the time any call in a batch
could observe an abort, every call in that batch has already started.

A batch of one call — every turn before this phase, and most turns
after it — behaves exactly as before: one `tool_call`, the pipeline
runs, one `tool_result` (or one `error`), then the post-batch abort
check. Phase 3–10 loop, bounds, cancellation, and hook suites are the
regression check and are not rewritten for this phase.

`ToolsetRouter` itself is unchanged: it already re-derives its owner
map on every `execute` call rather than caching mutable state, so
calling it from several concurrent call sites was already safe. This
phase is the first thing that actually does so.

## Non-goals

- No partial/streaming delivery of a batch's results as individual
  calls finish — a batch is observed as a unit. Streaming individual
  results earlier is a separate, later idea.
- No per-call cancellation once a batch has been dispatched.
- No concurrency limit or pool size option — nothing here needs
  bounding how many calls in one turn run at once; add a knob only
  when a caller asks for one.
- No change to `ToolsetRouter`, `BaseToolset`, or any event/message
  type.
