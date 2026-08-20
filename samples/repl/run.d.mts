import type { LlmProvider } from "../../src/provider.js";
import type { Event } from "../../src/types.js";

export interface ReplInput {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface RunOverrides {
  readonly provider?: LlmProvider;
  readonly input?: ReplInput;
}

export function run(overrides?: RunOverrides): Promise<Event[]>;
