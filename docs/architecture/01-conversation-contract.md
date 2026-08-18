# 01 — Conversation contract

## What this ships

`Message`, `validateMessages`, `LlmProvider`, `LlmResponse`, and a scripted
provider for tests. One `chat()` call. No loop, no tools, no streaming.

## Public types

```ts
export type Role = "system" | "user" | "assistant";

export interface Message {
  readonly role: Role;
  readonly content: string;
}

export function validateMessages(messages: readonly Message[]): void;

export interface LlmRequest {
  readonly messages: readonly Message[];
}

export interface LlmResponse {
  readonly text: string;
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
}
```

## Invariants

- A transcript is non-empty; `validateMessages` throws
  `InvalidTranscriptError` otherwise.
- A `system` message may appear only at index 0, and at most once.
  Deciding this now — rather than deferring it — means the loop (Phase 2)
  composes the system prompt without also inventing this rule.
- `content` is a plain string with no emptiness rule: an assistant message
  may legitimately carry `""` once tool calls exist (Phase 3).
- `ScriptedProvider` never invents a reply. A call past the end of its
  script throws `ScriptExhaustedError` naming how many calls were made —
  a silent default would let a broken loop look correct.

## Non-goals

No loop, no tools, no streaming, no token accounting, no retry. Those are
later phases; nothing here anticipates their shape.
