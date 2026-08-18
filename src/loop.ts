import { MaxRoundsExceededError, UnsupportedOptionError } from "./errors.js";
import type { LlmProvider } from "./provider.js";
import type { BaseToolset } from "./toolset.js";
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

  constructor(options: {
    readonly provider: LlmProvider;
    readonly toolsets?: readonly BaseToolset[];
  }) {
    this.provider = options.provider;
    this.toolsets = options.toolsets ?? [];
    this.router = new ToolsetRouter(this.toolsets);
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

      yield { type: "llm_request", messages: [...messages] };
      const response = await this.provider.chat(
        tools === undefined ? { messages } : { messages, tools },
      );
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

      for (const call of toolCalls) {
        if (signal?.aborted) {
          yield { type: "cancelled" };
          return;
        }
        yield { type: "tool_call", call };
        const result = await this.router.execute(call);
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
