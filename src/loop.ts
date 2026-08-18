import { UnsupportedOptionError } from "./errors.js";
import type { LlmProvider } from "./provider.js";
import type { Event, Message } from "./types.js";
import { validateMessages } from "./types.js";

export interface RunRequest {
  readonly userMessage: string;
  readonly systemPrompt?: string;
  readonly maxRounds?: number;
  readonly stream?: boolean;
}

// This is the whole idea an "agent" boils down to: send messages, get
// text back, stop. Phase 3 adds the other branch — tool calls instead of
// text — and loops back into another round instead of stopping. Every
// later phase (skills, MCP, hooks, sandbox) hangs more capability off
// that one fork; it never changes the fork itself.
export class AgentLoop {
  private readonly provider: LlmProvider;

  constructor(options: { readonly provider: LlmProvider }) {
    this.provider = options.provider;
  }

  async *run(request: RunRequest): AsyncGenerator<Event, void, void> {
    if (request.stream) {
      throw new UnsupportedOptionError(
        "Streaming is not supported until token streaming ships.",
      );
    }

    const messages: Message[] = [];
    if (request.systemPrompt !== undefined) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.userMessage });
    validateMessages(messages);

    yield { type: "llm_request", messages };
    const response = await this.provider.chat({ messages });
    yield { type: "llm_response", text: response.text };
    yield { type: "final_text", text: response.text };
  }
}
