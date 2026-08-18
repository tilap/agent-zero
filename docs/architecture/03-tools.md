# 03 — Tools

## What this ships

`ToolCall`, `ToolResult`, `ToolSchema`, `BaseToolset`, `ToolsetRouter`,
and the loop's second branch: a round with tool calls executes them and
continues instead of stopping. This is the phase where the runtime
becomes an agent — skills, MCP, and the sandbox in later phases are all
just more toolsets behind the same router.

## Public types

```ts
export type Message =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
    }
  | {
      readonly role: "tool";
      readonly callId: string;
      readonly content: string;
      readonly isError?: boolean;
    };

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ToolResult {
  readonly callId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>; // JSON Schema
}

export abstract class BaseToolset {
  abstract listTools(): Promise<readonly ToolSchema[]>;
  abstract execute(call: ToolCall): Promise<ToolResult>;
}

export class ToolsetRouter {
  constructor(toolsets: readonly BaseToolset[]);
  listTools(): Promise<readonly ToolSchema[]>;
  execute(call: ToolCall): Promise<ToolResult>;
}

export class DuplicateToolNameError extends Error {}
```

`LlmRequest` gains an optional `tools`; `LlmResponse` and `ScriptedTurn`
gain an optional `toolCalls`.

## Behaviour

- A round with tool calls in the response: for each call, in the model's
  order, emit `tool_call`, execute it, emit `tool_result`, append. Then
  send another round. A round with no tool calls stops as before
  (`final_text`).
- After a tool round the transcript holds one `assistant` message
  carrying `toolCalls`, then one `tool` message per call, in call order.
- Execution is **sequential**. Concurrent execution is a behavioural
  change (result ordering, shared state) and gets its own phase (10), not
  bundled here as an optimisation.
- `ToolsetRouter.listTools()` throws `DuplicateToolNameError` on a name
  collision across toolsets — a setup mistake, thrown eagerly.
- `ToolsetRouter.execute()` on an unknown name returns
  `{ isError: true, content: "Unknown tool: <name>. Available: …" }`
  rather than throwing: the model must be able to read the failure and
  recover, which is the entire reason tool failures are results and not
  exceptions.
- A toolset that throws during `execute` is caught by the router and
  converted to the same `isError` shape — a throw never escapes into the
  loop.

`execute` takes only the call. Phase 4 adds an abort signal parameter,
Phase 5 adds the workspace path — each because a caller finally has
something to pass, not upfront.

## Non-goals

Parallelism, bounds, cancellation, streaming, JSON-Schema validation of
tool arguments (the tool validates its own input and reports failure as
an `isError` result).
