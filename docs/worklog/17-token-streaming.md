# 17 — Token streaming

## What this ships

An optional `chatStream` method on `LlmProvider`, a new `llm_delta`
event, and `ScriptedProvider` implementing it. `RunRequest.stream`
already existed (Phase 2) as a placeholder that always threw; it now
does something when the provider supports it. The fork from Phase 2
(text stops, tool calls loop) is unchanged — streaming only changes
*how* a round gets its `LlmResponse`, never what happens with it once
obtained.

## Public types

```ts
// src/provider.ts — additive
export interface LlmDelta {
  readonly text: string;
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
  chatStream?(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void>;
}

// src/types.ts — additive
export type Event =
  | /* … existing variants … */
  | { readonly type: "llm_delta"; readonly text: string };
```

`chatStream` is optional — implementing it is a provider's choice, not
a requirement `LlmProvider` imposes. `ScriptedProvider` gains it in
this phase; a caller's own custom provider is free to skip it exactly
as it already skips any other optional capability.

## Behaviour

**`stream: true` without provider support.** The check at `run()`'s
entry narrows from Phase 2's unconditional throw to
`request.stream && this.provider.chatStream === undefined` — same
position (before `validateMessages`, before any provider call), same
`UnsupportedOptionError`. A provider that never implements
`chatStream` behaves exactly as it did before this phase.

**Per round, when streaming.** Instead of
`response = await this.provider.chat(llmRequest)`, the round does
`response = yield* this.streamChat(llmRequest)`, delegating to:

```ts
private async *streamChat(
  request: LlmRequest,
): AsyncGenerator<Event, LlmResponse, void> {
  const stream = this.provider.chatStream(request);
  let step = await stream.next();
  while (!step.done) {
    yield { type: "llm_delta", text: step.value.text };
    step = await stream.next();
  }
  return step.value;
}
```

`yield*` delegation means every `llm_delta` passes straight through
`run()`'s own generator, and the whole expression evaluates to
`streamChat`'s return value — the assembled `LlmResponse` — once
exhausted. This runs inside the same `try`/`catch` the non-streaming
path already has (Phase 2/9): a throw anywhere in the stream is caught
exactly like a `provider.chat` rejection, producing an `error` event,
no new error path. `beforeModel`/`afterModel` (Phase 9) are
unchanged — a `beforeModel` short-circuit skips the provider entirely
(no `chatStream` call, no deltas); `afterModel` still runs against the
fully-assembled `response`. `llm_response` still fires exactly once
per round, after every delta — a caller that never asks for streaming
sees the identical event stream it always has (Phase 2's three-event
contract for a text round is unchanged in shape, just optionally
preceded by `llm_delta`s).

**`ScriptedProvider.chatStream`.** Splits `turn.text` into
whitespace-preserving chunks (`text.match(/\S+\s*|\s+/g) ?? []` — the
matches always concatenate back to the exact original string), yields
`{ text: chunk }` for each, then returns the same `LlmResponse`
`chat()` would return for that script position, `toolCalls` included
whole. Shares `chat()`'s cursor and `ScriptExhaustedError`, and pushes
onto the same `requests` array — `chatStream` and `chat` are two ways
to read one script, not two scripts.

## Non-goals

- No partial tool-call streaming — a tool call is never split across
  `llm_delta` events; it always arrives complete on the round's
  `LlmResponse`, exactly as before this phase. Vendors disagree on
  the shape of partial tool-call deltas; buffering the whole call
  sidesteps that entirely.
- No token-level granularity guarantee — `ScriptedProvider` chunks by
  word for a deterministic, readable fixture. A real vendor adapter
  (Phases 18–19) chunks however its own stream does; nothing here
  promises "one delta per token."
- No new `AgentOptions`/`RunnerOptions` field — streaming stays a
  per-`RunRequest` choice, already true since Phase 2.
- No signal threaded into `chatStream` beyond what already exists —
  the pre-round abort check still applies before a round starts; a
  provider wanting mid-stream cancellation can already capture
  whatever it needs from the request it was given.
