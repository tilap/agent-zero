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
  | { readonly type: "tool_result"; readonly result: ToolResult }
  | {
      readonly type: "context_compacted";
      readonly before: number;
      readonly after: number;
    }
  | { readonly type: "steering_injected"; readonly text: string }
  | { readonly type: "llm_delta"; readonly text: string }
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly error: Error };

function validateToolPairing(messages: readonly Message[]): void {
  let pending: Set<string> | undefined;

  for (const [index, message] of messages.entries()) {
    if (pending !== undefined && pending.size > 0) {
      if (message.role !== "tool") {
        throw new InvalidTranscriptError(
          `Message at index ${index} arrived before ${pending.size} pending tool call(s) were resolved.`,
        );
      }
      if (!pending.has(message.callId)) {
        throw new InvalidTranscriptError(
          `Tool result at index ${index} has callId "${message.callId}", which does not match any open tool call.`,
        );
      }
      pending.delete(message.callId);
    } else if (message.role === "tool") {
      throw new InvalidTranscriptError(
        `Tool result at index ${index} has callId "${message.callId}", which does not match any open tool call.`,
      );
    }

    if (message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0) {
      // biome-ignore lint/style/noNonNullAssertion: guarded by the length check above
      pending = new Set(message.toolCalls!.map((call) => call.id));
    }
  }

  if (pending !== undefined && pending.size > 0) {
    throw new InvalidTranscriptError(
      `Transcript ends with ${pending.size} unresolved tool call(s).`,
    );
  }
}

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

  validateToolPairing(messages);
}
