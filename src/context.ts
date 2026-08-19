import type { Message, ToolResult } from "./types.js";

export const MAX_TOOL_RESULT_CHARS = 20_000;

export interface ContextCompactor {
  compact(
    messages: readonly Message[],
  ): readonly Message[] | Promise<readonly Message[]>;
}

export interface TruncatingCompactorOptions {
  readonly maxMessages: number;
}

function isOpenToolCallGroup(message: Message): boolean {
  return message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0;
}

// A chunk is one or more messages that must move together: an assistant
// message with tool calls plus the tool results that immediately follow
// it, or a single unrelated message. Truncation drops whole chunks, so a
// tool-call/tool-result pair is never split.
function toChunks(messages: readonly Message[]): Message[][] {
  const chunks: Message[][] = [];
  let index = 0;

  while (index < messages.length) {
    // biome-ignore lint/style/noNonNullAssertion: index is within bounds
    const message = messages[index]!;
    if (!isOpenToolCallGroup(message)) {
      chunks.push([message]);
      index += 1;
      continue;
    }

    // biome-ignore lint/style/noNonNullAssertion: guarded by isOpenToolCallGroup
    const ids = new Set(message.toolCalls!.map((call) => call.id));
    const chunk = [message];
    index += 1;
    while (index < messages.length) {
      const next = messages[index];
      if (next?.role !== "tool" || !ids.has(next.callId)) {
        break;
      }
      chunk.push(next);
      ids.delete(next.callId);
      index += 1;
    }
    chunks.push(chunk);
  }

  return chunks;
}

export class TruncatingCompactor implements ContextCompactor {
  private readonly maxMessages: number;

  constructor(options: TruncatingCompactorOptions) {
    this.maxMessages = options.maxMessages;
  }

  compact(messages: readonly Message[]): readonly Message[] {
    if (messages.length <= this.maxMessages) {
      return messages;
    }

    const hasSystem = messages[0]?.role === "system";
    const system = hasSystem ? messages[0] : undefined;
    const rest = hasSystem ? messages.slice(1) : messages;
    const budget = this.maxMessages - (system === undefined ? 0 : 1);

    const chunks = toChunks(rest);
    const kept: Message[][] = [];
    let total = 0;

    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      // biome-ignore lint/style/noNonNullAssertion: i is within bounds
      const chunk = chunks[i]!;
      if (kept.length > 0 && total + chunk.length > budget) {
        break;
      }
      kept.unshift(chunk);
      total += chunk.length;
    }

    const result = kept.flat();
    return system === undefined ? result : [system, ...result];
  }
}

export function clipToolResult(
  result: ToolResult,
  max: number = MAX_TOOL_RESULT_CHARS,
): ToolResult {
  if (result.content.length <= max) {
    return result;
  }
  const cut = result.content.length - max;
  return {
    ...result,
    content: `${result.content.slice(0, max)}\n…[truncated ${cut} of ${result.content.length} characters]`,
  };
}
