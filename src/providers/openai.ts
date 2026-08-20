import { HostedProviderError } from "../errors.js";
import type {
  LlmDelta,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "../provider.js";
import type { ToolSchema } from "../toolset.js";
import type { Message, ToolCall } from "../types.js";

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

interface OpenAiToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAiMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly OpenAiToolCall[];
  readonly tool_call_id?: string;
}

interface OpenAiTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

interface OpenAiChatResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content: string | null;
      readonly tool_calls?: readonly OpenAiToolCall[];
    };
  }[];
}

interface OpenAiStreamToolCallFragment {
  readonly index: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface OpenAiStreamChunk {
  readonly choices?: readonly {
    readonly delta?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly OpenAiStreamToolCallFragment[];
    };
  }[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function toOpenAiToolCall(call: ToolCall): OpenAiToolCall {
  return {
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

function toOpenAiMessages(messages: readonly Message[]): OpenAiMessage[] {
  return messages.map((message): OpenAiMessage => {
    switch (message.role) {
      case "system":
      case "user":
        return { role: message.role, content: message.content };
      case "assistant": {
        const toolCalls = message.toolCalls;
        const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0;
        return {
          role: "assistant",
          content:
            message.content === "" && hasToolCalls ? null : message.content,
          ...(hasToolCalls
            ? { tool_calls: toolCalls.map(toOpenAiToolCall) }
            : {}),
        };
      }
      case "tool":
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.callId,
        };
    }
  });
}

function toOpenAiTools(tools: readonly ToolSchema[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCallArguments(
  name: string,
  argumentsJson: string,
): Record<string, unknown> {
  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    throw new HostedProviderError(
      `Malformed tool call arguments for "${name}": ${argumentsJson}`,
    );
  }
}

function fromOpenAiToolCall(call: OpenAiToolCall): ToolCall {
  return {
    id: call.id,
    name: call.function.name,
    arguments: parseToolCallArguments(
      call.function.name,
      call.function.arguments,
    ),
  };
}

async function* readSseLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice("data:".length).trimStart();
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class OpenAiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly extraHeaders: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    const base = options.baseUrl ?? DEFAULT_BASE_URL;
    this.baseUrl = base.endsWith("/") ? base : `${base}/`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.extraHeaders = options.headers ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  private requestHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
      ...this.extraHeaders,
    };
  }

  private requestBody(
    request: LlmRequest,
    extra?: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    return {
      model: this.model,
      messages: toOpenAiMessages(request.messages),
      ...(request.tools === undefined
        ? {}
        : { tools: toOpenAiTools(request.tools) }),
      ...extra,
    };
  }

  private async fetchOnce(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(new URL("chat/completions", this.baseUrl), {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async describeFailure(
    response: Response,
    attempts: number,
  ): Promise<string> {
    const text = await response.text();
    let message = `status ${response.status} after ${attempts} attempt(s)`;
    try {
      const parsed = JSON.parse(text) as {
        readonly error?: { readonly message?: string };
      };
      if (parsed.error?.message !== undefined) {
        message += `: ${parsed.error.message}`;
      }
    } catch {
      // not a JSON error body — keep the plain status message
    }
    return message;
  }

  private async fetchWithRetry(
    body: Record<string, unknown>,
  ): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchOnce(body);
      } catch (error) {
        if (attempt >= this.maxRetries) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new HostedProviderError(
            `Request failed after ${attempt + 1} attempt(s): ${message}`,
          );
        }
        attempt += 1;
        await delay(this.retryDelayMs);
        continue;
      }

      if (isRetryableStatus(response.status)) {
        if (attempt >= this.maxRetries) {
          throw new HostedProviderError(
            await this.describeFailure(response, attempt + 1),
          );
        }
        attempt += 1;
        await delay(this.retryDelayMs);
        continue;
      }

      if (!response.ok) {
        throw new HostedProviderError(
          await this.describeFailure(response, attempt + 1),
        );
      }

      return response;
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.fetchWithRetry(this.requestBody(request));
    const parsed = (await response.json()) as OpenAiChatResponse;
    const message = parsed.choices?.[0]?.message;
    if (message === undefined) {
      throw new HostedProviderError("Response had no choices.");
    }
    const toolCalls =
      message.tool_calls === undefined
        ? undefined
        : message.tool_calls.map(fromOpenAiToolCall);
    return {
      text: message.content ?? "",
      ...(toolCalls === undefined ? {} : { toolCalls }),
    };
  }

  async *chatStream(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void> {
    const response = await this.fetchWithRetry(
      this.requestBody(request, { stream: true }),
    );
    if (response.body === null) {
      throw new HostedProviderError("Streaming response had no body.");
    }

    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let text = "";
    let sawDone = false;

    for await (const payload of readSseLines(response.body)) {
      if (payload === "[DONE]") {
        sawDone = true;
        break;
      }
      let chunk: OpenAiStreamChunk;
      try {
        chunk = JSON.parse(payload) as OpenAiStreamChunk;
      } catch {
        throw new HostedProviderError(
          `Malformed streaming payload: ${payload}`,
        );
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta === undefined) {
        continue;
      }
      if (
        delta.content !== undefined &&
        delta.content !== null &&
        delta.content !== ""
      ) {
        text += delta.content;
        yield { text: delta.content };
      }
      if (delta.tool_calls !== undefined) {
        for (const fragment of delta.tool_calls) {
          const existing = toolCalls.get(fragment.index);
          const id = fragment.id ?? existing?.id;
          const name = fragment.function?.name ?? existing?.name;
          if (id === undefined || name === undefined) {
            throw new HostedProviderError(
              `Tool call fragment at index ${fragment.index} has no id/name and none was seen before.`,
            );
          }
          toolCalls.set(fragment.index, {
            id,
            name,
            arguments:
              (existing?.arguments ?? "") +
              (fragment.function?.arguments ?? ""),
          });
        }
      }
    }

    if (!sawDone) {
      throw new HostedProviderError("Streaming response ended without [DONE].");
    }

    const finalToolCalls = [...toolCalls.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      arguments: parseToolCallArguments(entry.name, entry.arguments),
    }));

    return {
      text,
      ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
    };
  }
}
