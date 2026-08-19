import { ScriptExhaustedError } from "../errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../provider.js";
import type { ToolCall } from "../types.js";

export interface ScriptedTurn {
  readonly text: string;
  readonly toolCalls?: readonly ToolCall[];
}

export class ScriptedProvider implements LlmProvider {
  private readonly script: readonly ScriptedTurn[];
  private cursor = 0;
  private readonly seenRequests: LlmRequest[] = [];

  constructor(script: readonly ScriptedTurn[]) {
    this.script = script;
  }

  get requests(): readonly LlmRequest[] {
    return this.seenRequests;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.seenRequests.push(request);
    const turn = this.script[this.cursor];
    if (turn === undefined) {
      throw new ScriptExhaustedError(
        `Script exhausted after ${this.cursor} call(s).`,
      );
    }
    this.cursor += 1;
    return turn.toolCalls === undefined
      ? { text: turn.text }
      : { text: turn.text, toolCalls: turn.toolCalls };
  }
}
