import { ScriptExhaustedError } from "../errors.js";
import type {
  LlmDelta,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "../provider.js";
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

  private nextTurn(request: LlmRequest): ScriptedTurn {
    this.seenRequests.push(request);
    const turn = this.script[this.cursor];
    if (turn === undefined) {
      throw new ScriptExhaustedError(
        `Script exhausted after ${this.cursor} call(s).`,
      );
    }
    this.cursor += 1;
    return turn;
  }

  private static toResponse(turn: ScriptedTurn): LlmResponse {
    return turn.toolCalls === undefined
      ? { text: turn.text }
      : { text: turn.text, toolCalls: turn.toolCalls };
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    return ScriptedProvider.toResponse(this.nextTurn(request));
  }

  async *chatStream(
    request: LlmRequest,
  ): AsyncGenerator<LlmDelta, LlmResponse, void> {
    const turn = this.nextTurn(request);
    for (const chunk of turn.text.match(/\S+\s*|\s+/g) ?? []) {
      yield { text: chunk };
    }
    return ScriptedProvider.toResponse(turn);
  }
}
