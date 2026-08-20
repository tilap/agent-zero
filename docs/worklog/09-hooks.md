# 09 — Hooks

## What this ships

`Hooks`: four optional functions — `beforeModel`, `afterModel`,
`beforeTool`, `afterTool` — that a caller can splice into
`AgentLoop`'s round logic without touching a toolset or the provider.
`AgentOptions.hooks` and `AgentLoop`'s constructor both accept them.
Nothing about the round's shape changes: the fork from Phase 2 (text
stops, tool calls loop) is still the only fork. Hooks just get a chance
to look at, or replace, what crosses it.

## Public types

```ts
export interface BeforeModelContext {
  readonly request: LlmRequest;
}
export interface AfterModelContext {
  readonly request: LlmRequest;
  readonly response: LlmResponse;
}
export interface BeforeToolContext {
  readonly call: ToolCall;
}
export interface AfterToolContext {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

export type BeforeModelHook = (
  context: BeforeModelContext,
) => LlmResponse | undefined | Promise<LlmResponse | undefined>;
export type AfterModelHook = (
  context: AfterModelContext,
) => LlmResponse | undefined | Promise<LlmResponse | undefined>;
export type BeforeToolHook = (
  context: BeforeToolContext,
) => ToolResult | undefined | Promise<ToolResult | undefined>;
export type AfterToolHook = (
  context: AfterToolContext,
) => ToolResult | undefined | Promise<ToolResult | undefined>;

export interface Hooks {
  readonly beforeModel?: BeforeModelHook;
  readonly afterModel?: AfterModelHook;
  readonly beforeTool?: BeforeToolHook;
  readonly afterTool?: AfterToolHook;
}
```

`AgentLoop`'s constructor and `AgentOptions` both gain an optional
`hooks?: Hooks`.

## Behaviour, per round

1. Compose `request`. If `hooks.beforeModel` is set, call it with
   `{ request }`.
   - Throws → emit `error` with that error, stop. `provider.chat` is
     never called.
   - Returns a defined `LlmResponse` → `provider.chat` is skipped for
     this round; no `llm_request` event fires, and that response becomes
     the round's `response`.
   - Returns `undefined` → fall through to the normal path.
2. Normal path: emit `llm_request`, call `provider.chat(request)` to get
   `response`. If `hooks.afterModel` is set, call it with
   `{ request, response }`; a throw is fatal the same way, a defined
   return replaces `response`. `afterModel` only runs on this path —
   never after a `beforeModel` short-circuit, since there is no real
   provider call to inspect.
3. Emit `llm_response` with the final `response` — always exactly one
   per round, whichever path produced it.
4. No tool calls → `final_text`, as before. Otherwise, for each call in
   order: emit `tool_call`. If `hooks.beforeTool` is set, call it with
   `{ call }`; a throw is fatal, a defined return skips
   `router.execute` and is used as `result` directly. Otherwise
   `result = await router.execute(call, context)`, and if
   `hooks.afterTool` is set it runs with `{ call, result }` under the
   same throw/replace/pass-through rules — again, only when `beforeTool`
   did not already short-circuit.
5. Emit `tool_result` with the final `result`, append to the transcript,
   continue.

Omitting `hooks` entirely reproduces Phase 4/5 behaviour exactly — the
existing loop, bounds, and facade suites are the regression check and
are not rewritten for this phase.

## Non-goals

No dedicated event marks a hook short-circuit or replacement — it shows
up as an absent `llm_request`, or a result the underlying provider or
toolset did not itself produce. No hook ordering or arrays: `Hooks` holds
one function per point; a caller wanting several composes them into one
function.
