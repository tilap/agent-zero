# 02 — Text-only loop

## What this ships

`AgentLoop`, `RunRequest`, and the `Event` union. One round: send a
composed transcript to the provider, emit events, stop on text.

## Public types

```ts
export type Event =
  | { readonly type: "llm_request"; readonly messages: readonly Message[] }
  | { readonly type: "llm_response"; readonly text: string }
  | { readonly type: "final_text"; readonly text: string };

export interface RunRequest {
  readonly userMessage: string;
  readonly systemPrompt?: string;
  readonly maxRounds?: number; // accepted, defaulted; enforcement is Phase 4
  readonly stream?: boolean; // rejected unless the provider implements chatStream (Phase 17)
}

export class AgentLoop {
  constructor(options: { readonly provider: LlmProvider });
  run(request: RunRequest): AsyncGenerator<Event, void, void>;
}

export class UnsupportedOptionError extends Error {}
```

## Behaviour

- Compose the transcript: `systemPrompt` at index 0 if present, then the
  user message. Run `validateMessages` before the first provider call.
- One round emits exactly three events in order: `llm_request`,
  `llm_response`, `final_text`.
- `stream: true` throws `UnsupportedOptionError` before the provider is
  ever called, unless the provider implements `chatStream` — see
  [17-token-streaming.md](17-token-streaming.md).

## Non-goals

No tools, no cancellation, no bounds enforcement, no accumulated
transcript — with one round there is nothing to accumulate. Phase 3
introduces a transcript when a second round needs one.
