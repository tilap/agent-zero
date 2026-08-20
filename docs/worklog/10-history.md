# 10 — History

## What this ships

Three additions, all about the transcript a run starts and grows from,
none of them a new kind of loop:

- `RunRequest.priorMessages` — a caller-supplied slice of earlier
  conversation, composed as `[system?, ...priorMessages, user]` and
  validated as one transcript, same as today's `[system?, user]`.
- `ContextCompactor` — an optional protocol (`compact(messages)`) an
  `AgentLoop`/`Runner`/`Agent` can be built with, plus a
  `TruncatingCompactor` implementation. It runs once per round, before
  the provider call, and only when a caller opts in.
- A fixed cap (`MAX_TOOL_RESULT_CHARS`) on tool result content, applied
  unconditionally so one oversized `read`/`exec` result cannot blow up
  the next round's request.

Memory itself — what to persist, retrieve, or forget across process
restarts — stays the caller's job. This phase only makes the input
(`priorMessages`) and the accumulation (compaction, clipping) safe to
hand to the loop.

## Public types

```ts
// src/types.ts — additive
export type Event =
  | { readonly type: "llm_request"; readonly messages: readonly Message[] }
  | { readonly type: "llm_response"; readonly text: string }
  | { readonly type: "final_text"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "tool_result"; readonly result: ToolResult }
  | {
      readonly type: "context_compacted";
      readonly before: number;
      readonly after: number;
    }
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly error: Error };

// src/context.ts
export interface ContextCompactor {
  compact(
    messages: readonly Message[],
  ): readonly Message[] | Promise<readonly Message[]>;
}

export interface TruncatingCompactorOptions {
  readonly maxMessages: number;
}

export class TruncatingCompactor implements ContextCompactor {
  constructor(options: TruncatingCompactorOptions);
  compact(messages: readonly Message[]): readonly Message[];
}

export const MAX_TOOL_RESULT_CHARS: number;

// src/loop.ts — additive
export interface RunRequest {
  readonly userMessage: string;
  readonly systemPrompt?: string;
  readonly priorMessages?: readonly Message[];
  readonly maxRounds?: number;
  readonly stream?: boolean;
}

export class AgentLoop {
  constructor(options: {
    readonly provider: LlmProvider;
    readonly toolsets?: readonly BaseToolset[];
    readonly hooks?: Hooks;
    readonly contextCompactor?: ContextCompactor;
  });
}
```

`RunnerOptions` and `AgentOptions` both gain an optional
`contextCompactor?: ContextCompactor`, passed straight through to the
`AgentLoop` they build — the same shape `hooks` already has.

## Behaviour

**Composing `priorMessages`.** The loop builds the initial transcript
as `[system?, ...priorMessages, user]` (`priorMessages` defaults to
`[]`) and runs the existing `validateMessages` over the whole array
once, at the top — no separate validation path for history.

**Tool-pair invariant.** `validateMessages` now also tracks the set of
tool-call ids opened by the most recent assistant message carrying
`toolCalls`. While that set is non-empty, the next message must be a
`tool` message whose `callId` is in the set (removed once matched);
anything else — a non-`tool` message, or a `tool` message with an
unrecognised `callId` — throws `InvalidTranscriptError`. A `tool`
message arriving with no open call is an orphan result and throws the
same way. A non-empty pending set left at the end of the array also
throws: a composed transcript represents finished turns only. The
existing system-message checks are unchanged.

**`ContextCompactor`.** `TruncatingCompactor({ maxMessages })` returns
its input unchanged (same array) when already at or under budget.
Otherwise it drops the oldest messages until the budget is met, never
splitting a tool-call/tool-result group — an assistant message with
`toolCalls` and the `tool` messages right after it are dropped or kept
as one unit. A leading `system` message always survives (it still
counts toward `maxMessages`). The most recent chunk always survives,
even alone over budget — truncation never empties the transcript.

`AgentLoop`: when `options.contextCompactor` is set, it runs once per
round, right before composing that round's provider request, over the
working transcript. If the result's length differs from the input, the
loop emits `{ type: "context_compacted", before, after }` and continues
the round — and every later round — from the compacted array; further
pushes append onto it, not the original. No event fires when the
result is unchanged. Omitting `contextCompactor` reproduces every
earlier phase's behaviour exactly, including message identity.

**Tool result size cap.** Applied unconditionally, after
`beforeTool`/`afterTool` hooks have had their say (Phase 9), right
before the `tool_result` event and the transcript push — a floor under
every source of a result, not only the router's. A result at or under
`MAX_TOOL_RESULT_CHARS` passes through untouched; an oversized one is
sliced to that length with a trailing marker noting how many
characters were cut. The clipped content is what both the event and
the transcript see — the model never receives more than the cap.

## Non-goals

- No store, no embeddings, no cross-process persistence — a caller
  still owns the array and decides what to keep as `priorMessages`.
- No LLM-calling compactor (a `ContextCompactor` that summarizes via a
  model) — `TruncatingCompactor` spends zero extra tokens; a smarter
  one is a future implementation of the same protocol, not a change to
  it.
- `MAX_TOOL_RESULT_CHARS` is a fixed constant, not a per-call or
  per-agent option — no knob exists until a caller actually needs one.
