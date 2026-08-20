import { HostedProviderError } from "../errors.js";
import type {
  LlmDelta,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "../provider.js";
import type { ToolSchema } from "../toolset.js";
import type { Message, ToolCall } from "../types.js";

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

interface GeminiFunctionResponsePart {
  readonly functionResponse: {
    readonly name: string;
    readonly response: { readonly content: string };
  };
}

interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly unknown[];
}

interface GeminiTool {
  readonly functionDeclarations: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }[];
}

interface GeminiResponsePart {
  readonly text?: string;
  readonly functionCall?: {
    readonly name: string;
    readonly args?: Readonly<Record<string, unknown>>;
  };
  // A "thinking" model (e.g. gemini-3.6-flash) attaches an opaque
  // thoughtSignature next to a functionCall part; the API rejects the
  // next turn's functionCall if it isn't echoed back unchanged. There is
  // no field for this on the vendor-agnostic ToolCall type, so it rides
  // along inside the synthetic id we already generate (Gemini gives tool
  // calls no id of its own) instead of leaking a Gemini-only concept
  // into core types.
  readonly thoughtSignature?: string;
}

interface GeminiGenerateContentResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly GeminiResponsePart[] };
  }[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function toGeminiTools(tools: readonly ToolSchema[]): GeminiTool[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

const THOUGHT_SIGNATURE_SEPARATOR = ":";

function toolCallId(
  counter: number,
  thoughtSignature: string | undefined,
): string {
  const base = `call-${counter}`;
  return thoughtSignature === undefined
    ? base
    : `${base}${THOUGHT_SIGNATURE_SEPARATOR}${thoughtSignature}`;
}

function extractThoughtSignature(id: string): string | undefined {
  const index = id.indexOf(THOUGHT_SIGNATURE_SEPARATOR);
  return index === -1 ? undefined : id.slice(index + 1);
}

function toolNameFor(
  callId: string,
  priorAssistantToolCalls: readonly ToolCall[] | undefined,
): string {
  const match = priorAssistantToolCalls?.find((call) => call.id === callId);
  if (match === undefined) {
    throw new HostedProviderError(
      `No matching tool call found for result "${callId}".`,
    );
  }
  return match.name;
}

function toGeminiRequestBody(request: LlmRequest): Record<string, unknown> {
  let systemInstruction: { parts: [{ text: string }] } | undefined;
  const contents: GeminiContent[] = [];
  let lastAssistantToolCalls: readonly ToolCall[] | undefined;
  let toolGroup: GeminiFunctionResponsePart[] | undefined;

  const flushToolGroup = () => {
    if (toolGroup !== undefined) {
      contents.push({ role: "user", parts: toolGroup });
      toolGroup = undefined;
    }
  };

  for (const message of request.messages) {
    if (message.role !== "tool") {
      flushToolGroup();
    }
    switch (message.role) {
      case "system":
        systemInstruction = { parts: [{ text: message.content }] };
        break;
      case "user":
        contents.push({ role: "user", parts: [{ text: message.content }] });
        break;
      case "assistant": {
        const parts: unknown[] = [];
        if (message.content !== "") {
          parts.push({ text: message.content });
        }
        if (message.toolCalls !== undefined) {
          for (const call of message.toolCalls) {
            const thoughtSignature = extractThoughtSignature(call.id);
            parts.push({
              functionCall: { name: call.name, args: call.arguments },
              ...(thoughtSignature === undefined ? {} : { thoughtSignature }),
            });
          }
        }
        contents.push({ role: "model", parts });
        lastAssistantToolCalls = message.toolCalls;
        break;
      }
      case "tool": {
        const name = toolNameFor(message.callId, lastAssistantToolCalls);
        const part: GeminiFunctionResponsePart = {
          functionResponse: { name, response: { content: message.content } },
        };
        toolGroup = toolGroup === undefined ? [part] : [...toolGroup, part];
        break;
      }
    }
  }
  flushToolGroup();

  const params = request.generationParams;
  const generationConfig = {
    ...(params?.temperature === undefined
      ? {}
      : { temperature: params.temperature }),
    ...(params?.maxTokens === undefined
      ? {}
      : { maxOutputTokens: params.maxTokens }),
    ...(params?.topP === undefined ? {} : { topP: params.topP }),
  };

  return {
    ...(systemInstruction === undefined ? {} : { systemInstruction }),
    contents,
    ...(request.tools === undefined
      ? {}
      : { tools: toGeminiTools(request.tools) }),
    ...(Object.keys(generationConfig).length === 0 ? {} : { generationConfig }),
  };
}

function fromGeminiParts(parts: readonly GeminiResponsePart[]): LlmResponse {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let counter = 0;
  for (const part of parts) {
    if (part.text !== undefined) {
      text += part.text;
    }
    if (part.functionCall !== undefined) {
      counter += 1;
      toolCalls.push({
        id: toolCallId(counter, part.thoughtSignature),
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }
  return {
    text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
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

export class GeminiProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly extraHeaders: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
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
      "x-goog-api-key": this.apiKey,
      "content-type": "application/json",
      ...this.extraHeaders,
    };
  }

  private async fetchOnce(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(new URL(path, this.baseUrl), {
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
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await this.fetchOnce(path, body);
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
    const response = await this.fetchWithRetry(
      `models/${this.model}:generateContent`,
      toGeminiRequestBody(request),
    );
    const parsed = (await response.json()) as GeminiGenerateContentResponse;
    const parts = parsed.candidates?.[0]?.content?.parts;
    if (parts === undefined) {
      throw new HostedProviderError("Response had no candidates.");
    }
    return fromGeminiParts(parts);
  }

  async *chatStream(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void> {
    const response = await this.fetchWithRetry(
      `models/${this.model}:streamGenerateContent?alt=sse`,
      toGeminiRequestBody(request),
    );
    if (response.body === null) {
      throw new HostedProviderError("Streaming response had no body.");
    }

    let text = "";
    const toolCalls: ToolCall[] = [];
    let counter = 0;

    for await (const payload of readSseLines(response.body)) {
      let chunk: GeminiGenerateContentResponse;
      try {
        chunk = JSON.parse(payload) as GeminiGenerateContentResponse;
      } catch {
        throw new HostedProviderError(
          `Malformed streaming payload: ${payload}`,
        );
      }
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text !== undefined && part.text !== "") {
          text += part.text;
          yield { text: part.text };
        }
        if (part.functionCall !== undefined) {
          counter += 1;
          toolCalls.push({
            id: toolCallId(counter, part.thoughtSignature),
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
          });
        }
      }
    }

    return {
      text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}
