# 14 — Approval

## What this ships

A gate in front of tool execution: `RunnerOptions.approvalPolicy`
decides which calls must pause, and `Runner.approve(callId)` /
`Runner.deny(callId)` are how a human (or anything else with the
`Runner` handle) resolves one from outside the run. Not a hook — a
hook answers now, synchronously enough that the round just continues;
approval waits, possibly indefinitely, for an external decision. Not
steering — steering adds text the model reads; approval decides
whether a specific tool call runs at all. `denied` becomes a
model-visible `isError` tool result, the same shape a thrown error or
an unknown tool name already produces (Phase 3) — never a thrown
exception the caller has to catch.

## Public types

```ts
// src/approval.ts
export type ApprovalDecision = "approved" | "denied";

export interface ApprovalPolicy {
  /** True if this call must pause for a decision before it runs. */
  requiresApproval(call: ToolCall): boolean;
}

export interface ApprovalGate extends ApprovalPolicy {
  requestApproval(
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision>;
}

// src/loop.ts — additive
export class AgentLoop {
  constructor(options: {
    // … existing fields …
    readonly approval?: ApprovalGate;
  });
}

// src/runner.ts — additive
export interface RunnerOptions {
  // … existing fields …
  readonly approvalPolicy?: ApprovalPolicy;
}
export class Runner {
  // … existing members …
  approve(callId: string): void;
  deny(callId: string): void;
}

// src/errors.ts — additive
export class UnknownApprovalRequestError extends Error {}
```

`AgentOptions`/`Agent` gain nothing — same reasoning as steering
(Phase 13): resolving a pending approval needs the live `Runner`
handle, which `Agent` never hands back.

## Behaviour

**Gating, inside the existing per-call pipeline (Phase 11's
`runToolCall`).** Order: `beforeTool` hook runs first, unchanged; a
short-circuit there means approval is never consulted for that call —
a hook that already produced a result takes priority over asking a
human about a call that will not actually reach the toolset either
way. Otherwise, if `approval.requiresApproval(call)` is true: await
`approval.requestApproval(call, context.signal)`.

- `"denied"` → the result is
  `{ callId: call.id, content: "Tool call denied by approval.", isError: true }`
  directly. `router.execute` and `afterTool` do not run — the same
  skip a `beforeTool` short-circuit already produces.
- `"approved"` (or `requiresApproval` was false, or no `approval` is
  configured at all) → falls through to `router.execute` then
  `afterTool`, unchanged from Phase 11.

No new event announces the pause: `tool_call` (Phase 3) already fires
for every call in a batch before any of them run, and a caller that
configured the policy already knows, from that same policy, which
calls are about to wait — repeating the decision as an event would
tell it nothing it does not already know.

**Cancellation while waiting.** The pending decision's `Promise`
listens for the run's own `AbortSignal` (forwarded through
`ToolContext.signal`, unchanged since Phase 4); on abort it resolves
`"denied"` itself, rather than rejecting. That denied result flows
through the same batch machinery Phase 11 already has: it becomes a
`tool_result`, gets pushed, and then the loop's existing post-batch
`signal?.aborted` check fires and ends the run in `cancelled` — no
second cancellation path, no new race to get right.

**`RunnerOptions.approvalPolicy`.** Optional, standing configuration
for the `Runner` instance (like `hooks`, `contextCompactor`) — not a
per-run value. `Runner` builds one internal registry per active run,
wrapping whatever policy (or none) was configured, with the same
one-run-at-a-time lifecycle `SteeringQueue` already has (Phase 13):
built at the top of `run()`, cleared in the same `finally`.

**`Runner.approve`/`Runner.deny`.** Resolve the pending decision for
`callId`. No run active → `NoActiveRunError` (Phase 13's error,
reused — the failure is the same regardless of which method needed
the handle). A run is active but `callId` matches nothing currently
pending (wrong id, already decided, or that call never required
approval) → `UnknownApprovalRequestError`.

## Non-goals

- No new `Event` variant — `tool_call` is enough (see above).
- No `Agent` forwarding — no `AgentOptions.approvalPolicy`, no
  `Agent.approve`/`deny`.
- No approval timeout built in — a caller wanting one calls `deny`
  from its own `setTimeout`; no knob until one is asked for.
- No accessor listing currently-pending approvals — a caller already
  knows what it is waiting on from `tool_call` events plus its own
  policy.
- A `beforeTool` short-circuit silently skips approval for that call,
  by design (see Behaviour) — not a gap to close later.
