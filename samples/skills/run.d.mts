import type { LlmProvider } from "../../src/provider.js";
import type { Event } from "../../src/types.js";

export interface RunOverrides {
  readonly provider?: LlmProvider;
}

export function run(overrides?: RunOverrides): Promise<Event[]>;
