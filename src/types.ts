import { InvalidTranscriptError } from "./errors.js";

export type Role = "system" | "user" | "assistant";

export interface Message {
  readonly role: Role;
  readonly content: string;
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
}
