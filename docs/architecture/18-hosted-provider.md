# 18 — Hosted model provider

## What this ships

`OpenAiProvider`: an `LlmProvider` over OpenAI's chat completions HTTP
API (`POST {baseUrl}/chat/completions`) — "OpenAI-shaped" in the sense
that this is one concrete vendor shape, not a claim of full API
coverage. Hand-rolled `fetch`, no SDK dependency — the same choice MCP
already made for its own transports. `Loop`/`Agent`/`Runner` need no
change: `OpenAiProvider` is just another value satisfying the
`LlmProvider` interface Phase 1 defined and Phase 17 extended with
`chatStream`.

## Public types

```ts
// src/errors.ts — additive
export class HostedProviderError extends Error {}

// src/providers/openai.ts
export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string; // default "https://api.openai.com/v1"
  readonly timeoutMs?: number; // default 30_000
  readonly maxRetries?: number; // default 2 (up to 3 attempts total)
  readonly retryDelayMs?: number; // default 250
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export class OpenAiProvider implements LlmProvider {
  constructor(options: OpenAiProviderOptions);
  chat(request: LlmRequest): Promise<LlmResponse>;
  chatStream(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void>;
}
```

## Behaviour

### Endpoint and request body

`baseUrl` is normalized to end with `/` in the constructor, so
`new URL("chat/completions", baseUrl)` resolves correctly (the
default `https://api.openai.com/v1` becomes
`https://api.openai.com/v1/chat/completions`, not a URL missing its
`v1` segment). Every request body carries `model` and the mapped
`messages`/`tools`; `chatStream` sends the identical body plus
`stream: true` — without that field OpenAI silently returns a normal
JSON response instead of an SSE one. Headers: `authorization: Bearer
<apiKey>`, `content-type: application/json`, then `options.headers`
merged in after (so a caller can override — e.g. pointing this
provider at an OpenAI-compatible third-party endpoint with a
different auth header).

### Request mapping

- `system` / `user` → `{ role, content }`.
- `assistant` → `{ role: "assistant", content, tool_calls? }`; when
  `toolCalls` is present and `content === ""`, `content` is sent as
  `null` (OpenAI's documented shape for a tool-calls-only turn).
  Each `ToolCall` → `{ id, type: "function", function: { name, arguments: JSON.stringify(call.arguments) } }`.
- `tool` → `{ role: "tool", tool_call_id: callId, content }`.
  `isError` has no wire representation — the model reads the failure
  from `content` already, same as every other provider.
- `LlmRequest.tools` → `{ type: "function", function: { name, description, parameters } }`
  per `ToolSchema`; omitted entirely when `tools` is `undefined`.
- `LlmRequest.generationParams` → `temperature`/`max_tokens`/`top_p` on
  the body, each omitted individually when its field is `undefined` —
  not an all-or-nothing bag.

### Response mapping

`choices[0].message.content` (string or `null`) → `text` (`null`
becomes `""`). `choices[0].message.tool_calls` → `toolCalls`, each
`{ id, function: { name, arguments } }` mapped to
`{ id, name, arguments: JSON.parse(arguments) }`. Unparseable
`arguments` throws `HostedProviderError`.

### Retry and timeout

One private `fetchWithRetry` wraps every request. Each attempt gets
its own `AbortController` timing out after `timeoutMs`.

- **Retryable**: `fetch` throwing/timing out, or status `429`/`>= 500`.
  Up to `maxRetries` retries, `retryDelayMs` between attempts — a
  small fixed delay, no backoff curve, no `Retry-After` handling.
- **Not retryable**: any other non-2xx status (e.g. `400`, `401`) —
  fails immediately, budget untouched.
- Failure throws `HostedProviderError` with the status and, when the
  body parses as `{ error: { message } }`, that message too.

`chatStream` uses the same `fetchWithRetry` to obtain the initial
response — retries apply only up to that point. Once the SSE body has
started being read, any failure (malformed line, missing `[DONE]`)
throws directly, never retried — a stream already mid-flight cannot
be safely resumed without replaying already-yielded `llm_delta` text
or silently dropping content.

### Streaming

Reads `response.body` line by line (`TextDecoder`, buffering partial
lines across network chunks), extracting each `data: ` payload.
`data: [DONE]` ends the stream. Otherwise `JSON.parse` and inspect
`choices[0].delta`:

- `delta.content` → `yield { text: delta.content }` immediately — the
  only source of `llm_delta` events.
- `delta.tool_calls` (fragments keyed by `index`) → accumulated,
  never yielded (Phase 17's rule: no partial tool-call deltas). Only
  the *first* fragment for a given `index` carries `id`/
  `function.name`; every later fragment for that index carries
  neither, only the next slice of `function.arguments` to append —
  the accumulator must not overwrite `id`/`name` with `undefined` on
  those later fragments.

On stream end, the generator returns the assembled `LlmResponse`:
accumulated text plus the finalized, JSON-parsed tool calls.

## Non-goals

- Not full OpenAI API coverage (`n`, `logprobs`, vision content,
  `parallel_tool_calls`, structured outputs, …) — only what
  `LlmRequest`/`LlmResponse`/`LlmDelta` need.
- No exponential backoff / jitter, no `Retry-After` handling.
- No retry once an SSE stream has started emitting content.
- No "developer"/reasoning-model role handling — works against
  mainstream chat models (`gpt-4o`, `gpt-4.1`, …), not the `o1`/`o3`
  family, which rejects a `system` message sent this way.
- No API-key/env-var convention — `apiKey` is a required constructor
  option, sourcing it is the caller's job.
- No change to `Loop`/`Agent`/`Runner`/`provider.ts`.
