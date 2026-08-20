# 13 — Steering

## What this ships

`Runner.sendSteering(text)`: queue a line of text from outside a run
that is still in progress. The loop injects it as a `user` message
into the transcript, before the next provider call, then continues —
no new round, no change to the fork from Phase 2. A new event,
`steering_injected`, marks when that happens.

## Public types

```ts
// src/steering.ts
export interface SteeringSource {
  /** Return and clear whatever text is pending; called once per round. */
  drain(): readonly string[];
}

// src/types.ts — additive
export type Event =
  | /* … existing variants … */
  | { readonly type: "steering_injected"; readonly text: string };

// src/loop.ts — additive
export class AgentLoop {
  constructor(options: {
    // … existing fields …
    readonly steering?: SteeringSource;
  });
}

// src/runner.ts — additive
export class Runner {
  // … existing members …
  sendSteering(text: string): void;
}

// src/errors.ts — additive
export class NoActiveRunError extends Error {}
```

`RunnerOptions` gains nothing — steering has no caller-supplied
*policy* to configure, only a method to call on the live run.
`AgentOptions`/`Agent` gain nothing either: reaching into a run in
progress needs the handle only `Runner` hands back (Phase 12).

## Behaviour

**Draining, once per round.** Right after the round's
`contextCompactor` step (Phase 10) and before composing that round's
request: if `steering` is set, call `steering.drain()`. For each
string returned, in order, push `{ role: "user", content: text }` onto
the transcript and emit `{ type: "steering_injected", text }`. An
empty drain (nothing queued — the common case) does nothing and emits
no event. This applies to round 1 exactly like every later round: the
first chance a caller has to call `sendSteering` is right after
starting `run()`, and anything queued in that gap lands before the
very first provider call — not a special case, the same "before the
next provider call" contract every round already has.

**`Runner.sendSteering(text)`.** Enqueues onto the current run's
pending steering. `Runner` builds a fresh queue at the top of every
`run()` call and clears it in the same `finally` block that already
tears down the workspace — one active run's steering state at a time,
same lifecycle the workspace already has. Calling `sendSteering` when
no run is active — before the first `run()` call, or after the
previous one has finished — throws `NoActiveRunError`: a caller that
thinks a line was queued when it silently wasn't is worse than one
that has to catch an error it can reasonably expect.

## Non-goals

- No silent no-op when no run is active — an explicit error only.
- No `Agent.sendSteering` — a caller who wants this constructs a
  `Runner` directly (Phase 12 exists so they can).
- No special wiring for a toolset or hook to call `sendSteering` on
  itself mid-round; nothing stops a caller closing over the `Runner`
  and doing that, but the kit adds no support for it.
- No cap on how much text can be queued before it is drained — no
  knob until a caller needs one.
