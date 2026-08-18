import { InvalidTranscriptError } from "./errors.js";

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

export type Event =
  | { readonly type: "llm_request"; readonly messages: readonly Message[] }
  | { readonly type: "llm_response"; readonly text: string }
  | { readonly type: "final_text"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "tool_result"; readonly result: ToolResult };

export function validateMessages(messages: readonly Message[]): void {
  if (messages.length === 0) {
    throw new InvalidTranscriptError("A transcript must not be empty.");
  }

  const systemCount = messages.filter(
    (message) => message.role === "system",
  ).length;
  if (systemCount > 1) {
    throw new InvalidTranscriptError(
      `A transcript must contain at most one system message, got ${systemCount}.`,
    );
  }
  if (systemCount === 1 && messages[0]?.role !== "system") {
    throw new InvalidTranscriptError(
      "A system message must be the first message in the transcript.",
    );
  }
}
