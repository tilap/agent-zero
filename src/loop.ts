import { MaxRoundsExceededError, UnsupportedOptionError } from "./errors.js";
import type { Hooks } from "./hooks.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";
import type { BaseToolset, ToolContext } from "./toolset.js";
import { ToolsetRouter } from "./toolset.js";
import type { Event, Message, ToolResult } from "./types.js";
import { validateMessages } from "./types.js";

const DEFAULT_MAX_ROUNDS = 10;

export interface RunRequest {
  readonly userMessage: string;
  readonly systemPrompt?: string;
  readonly maxRounds?: number;
  readonly stream?: boolean;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly workspace?: string;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function toToolMessage(result: ToolResult): Message {
  return result.isError === undefined
    ? { role: "tool", callId: result.callId, content: result.content }
    : {
        role: "tool",
        callId: result.callId,
        content: result.content,
        isError: result.isError,
      };
}

// This is the whole idea an "agent" boils down to: send messages, get
// text or tool calls back. Text stops the loop (final_text). Tool calls
// execute, append their results, and the loop sends another round. Every
// later phase (skills, MCP, hooks, sandbox) hangs more capability off
// that one fork; it never changes the fork itself.
export class AgentLoop {
  private readonly provider: LlmProvider;
  private readonly toolsets: readonly BaseToolset[];
  private readonly router: ToolsetRouter;
  private readonly hooks: Hooks | undefined;

  constructor(options: {
    readonly provider: LlmProvider;
    readonly toolsets?: readonly BaseToolset[];
    readonly hooks?: Hooks;
  }) {
    this.provider = options.provider;
    this.toolsets = options.toolsets ?? [];
    this.router = new ToolsetRouter(this.toolsets);
    this.hooks = options.hooks;
  }

  async *run(
    request: RunRequest,
    options?: RunOptions,
  ): AsyncGenerator<Event, void, void> {
    if (request.stream) {
      throw new UnsupportedOptionError(
        "Streaming is not supported until token streaming ships.",
      );
    }

    const signal = options?.signal;
    const workspace = options?.workspace;
    const maxRounds = request.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const hasTools = this.toolsets.length > 0;

    const messages: Message[] = [];
    if (request.systemPrompt !== undefined) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userMessage });
    validateMessages(messages);

    for (let round = 1; ; round += 1) {
      if (signal?.aborted) {
        yield { type: "cancelled" };
        return;
      }

      const isLastRound = round === maxRounds;
      const tools =
        hasTools && !isLastRound ? await this.router.listTools() : undefined;
      const llmRequest: LlmRequest =
        tools === undefined ? { messages } : { messages, tools };

      let response: LlmResponse;
      try {
        const shortCircuit =
          this.hooks?.beforeModel === undefined
            ? undefined
            : await this.hooks.beforeModel({ request: llmRequest });
        if (shortCircuit !== undefined) {
          response = shortCircuit;
        } else {
          yield { type: "llm_request", messages: [...messages] };
          response = await this.provider.chat(llmRequest);
          const replaced =
            this.hooks?.afterModel === undefined
              ? undefined
              : await this.hooks.afterModel({ request: llmRequest, response });
          if (replaced !== undefined) {
            response = replaced;
          }
        }
      } catch (error) {
        yield { type: "error", error: toError(error) };
        return;
      }
      yield { type: "llm_response", text: response.text };

      const toolCalls = response.toolCalls ?? [];
      if (toolCalls.length === 0) {
        yield { type: "final_text", text: response.text };
        return;
      }

      if (isLastRound) {
        if (response.text !== "") {
          yield { type: "final_text", text: response.text };
        } else {
          yield {
            type: "error",
            error: new MaxRoundsExceededError(
              `Exceeded max rounds (${maxRounds}) with unresolved tool calls.`,
            ),
          };
        }
        return;
      }

      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls,
      });

      const toolContext: ToolContext = {
        ...(signal === undefined ? {} : { signal }),
        ...(workspace === undefined ? {} : { workspace }),
      };
      for (const call of toolCalls) {
        if (signal?.aborted) {
          yield { type: "cancelled" };
          return;
        }
        yield { type: "tool_call", call };

        let result: ToolResult;
        try {
          const shortCircuit =
            this.hooks?.beforeTool === undefined
              ? undefined
              : await this.hooks.beforeTool({ call });
          if (shortCircuit !== undefined) {
            result = shortCircuit;
          } else {
            result = await this.router.execute(call, toolContext);
            const replaced =
              this.hooks?.afterTool === undefined
                ? undefined
                : await this.hooks.afterTool({ call, result });
            if (replaced !== undefined) {
              result = replaced;
            }
          }
        } catch (error) {
          yield { type: "error", error: toError(error) };
          return;
        }

        yield { type: "tool_result", result };
        messages.push(toToolMessage(result));
        if (signal?.aborted) {
          yield { type: "cancelled" };
          return;
        }
      }
    }
  }
}
