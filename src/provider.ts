import { ScriptExhaustedError } from "./errors.js";
import type { Message } from "./types.js";

export interface LlmRequest {
  readonly messages: readonly Message[];
}

export interface LlmResponse {
  readonly text: string;
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
}

export interface ScriptedTurn {
  readonly text: string;
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
    return { text: turn.text };
  }
}
