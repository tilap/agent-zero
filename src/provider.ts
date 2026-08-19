import type { ToolSchema } from "./toolset.js";
import type { Message, ToolCall } from "./types.js";

export interface LlmRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
}

export interface LlmResponse {
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
}
