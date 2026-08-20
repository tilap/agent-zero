# 19 — Second hosted provider (Gemini)

## What this ships

`GeminiProvider`: an `LlmProvider` over Google's Generative Language
API. Same purpose Phase 18 had (a real HTTP vendor, no SDK
dependency), but this one earns its keep by having a **genuinely
different wire shape**, not a renamed OpenAI:

| | OpenAI (Phase 18) | Gemini |
| --- | --- | --- |
| Model selection | `model` field in the body | `model` in the URL path: `models/{model}:generateContent` |
| Auth | `Authorization: Bearer <key>` | `x-goog-api-key: <key>` header |
| System prompt | a `system`-role message | top-level `systemInstruction` field |
| Roles | `system`/`user`/`assistant`/`tool` | only `user`/`model` |
| Tool result | `role: "tool"`, correlated by `tool_call_id` | a `user`-role turn with a `functionResponse` part, correlated by **name + position** |
| Tool call id | present | **absent** — `functionCall` has only `name`/`args` |
| Tool call arguments | a JSON string | already a parsed object |
| Stream end | explicit `data: [DONE]` | none — the HTTP body just ends |

`Loop`/`Agent`/`Runner` need no change — same confirmation Phase 18
already gave, proven again here.

## Public types

```ts
export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string; // default "https://generativelanguage.googleapis.com/v1beta"
  readonly timeoutMs?: number; // default 30_000
  readonly maxRetries?: number; // default 2
  readonly retryDelayMs?: number; // default 250
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export class GeminiProvider implements LlmProvider {
  constructor(options: GeminiProviderOptions);
  chat(request: LlmRequest): Promise<LlmResponse>;
  chatStream(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void>;
}
```

Reuses `HostedProviderError` (Phase 18) — no new error class.

## Behaviour

### Endpoint

`POST {baseUrl}/models/{model}:generateContent` for `chat`;
`POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse` for
`chatStream` — the `alt=sse` query parameter is required, without it
Gemini returns a JSON array instead of an event stream. `baseUrl`
normalized to end with `/`. Auth: `x-goog-api-key`, plus
`options.headers` merged in after.

### Request mapping

- The one system message (always first, per `validateMessages`) → top
  -level `systemInstruction: { parts: [{ text }] }`, never in
  `contents`.
- `user` → `{ role: "user", parts: [{ text: content }] }`.
- `assistant` → `{ role: "model", parts }` — a text part (only if
  non-empty) then one `functionCall` part per `ToolCall`:
  `{ functionCall: { name, args: call.arguments } }` — `args` sent as
  an object, not stringified.
- `tool` messages: **consecutive ones are grouped** into a single
  `{ role: "user", parts: [{ functionResponse: { name, response: { content } } }, …] }`
  entry, one `functionResponse` per message, in order — matching
  Gemini's documented multi-tool-response convention. Each entry's
  `name` is looked up from the preceding assistant message's matching
  `ToolCall` (by `callId`).
- `LlmRequest.tools` → `[{ functionDeclarations: [...] }]` — every
  function under one `tools[0]` entry, not one `tools[]` entry per
  function. Omitted when `tools` is `undefined`.

### Response mapping

`candidates[0].content.parts` — every `text` part concatenates into
`text`; every `functionCall` part becomes a `ToolCall` with a
synthetic id (`call-${counter}`, since Gemini gives none) and `args`
used directly (already an object, no `JSON.parse`). No candidates
throws `HostedProviderError`.

### Retry, timeout, streaming

Same policy as Phase 18: retryable = connection failure/timeout or
status `429`/`>= 500`; other non-2xx fails immediately; same
`HostedProviderError`, same defaults. No shared code with
`OpenAiProvider` — two providers is not enough repetition to justify
an abstraction. `chatStream` has no `[DONE]` to wait for — the
generator ends when the underlying stream reports done. A
`functionCall` part arriving mid-stream is buffered, never yielded as
a delta, same rule Phase 17/18 already have for tool calls.

## Non-goals

- No shared base class/module with `OpenAiProvider`.
- Not full Gemini API coverage (`safetySettings`, `generationConfig`,
  citations, grounding, multimodal parts, …).
- No `?key=` query-param auth style — header only, matching every
  other provider here.
- Same retry/sampling/API-key-sourcing non-goals Phase 18 already
  declared.
