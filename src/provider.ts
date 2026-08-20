import type { ToolSchema } from "./toolset.js";
import type { Message, ToolCall } from "./types.js";

export interface GenerationParams {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
}

export interface LlmRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
  readonly generationParams?: GenerationParams;
}

export interface LlmResponse {
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface LlmDelta {
  readonly text: string;
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
  chatStream?(request: LlmRequest): AsyncGenerator<LlmDelta, LlmResponse, void>;
}
