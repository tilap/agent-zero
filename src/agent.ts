import { MaxRoundsExceededError } from "./errors.js";
import type { RunRequest } from "./loop.js";
import type { LlmProvider } from "./provider.js";
import { Runner } from "./runner.js";
import type { WorkspaceOptions } from "./runner.js";
import { SkillToolset } from "./skill.js";
import type { SkillRegistry } from "./skill.js";
import type { BaseToolset } from "./toolset.js";
import type { Event } from "./types.js";

export interface AgentOptions {
  readonly provider: LlmProvider;
  readonly toolsets?: readonly BaseToolset[];
  readonly systemPrompt?: string;
  readonly maxRounds?: number;
  readonly workspace?: WorkspaceOptions;
  readonly skills?: SkillRegistry;
}

export type StopReason = "final_text" | "max_rounds" | "cancelled" | "error";

export interface RunResult {
  readonly text: string;
  readonly events: readonly Event[];
  readonly rounds: number;
  readonly stopReason: StopReason;
  readonly error?: Error;
}

function toRunRequest(
  input: string | RunRequest,
  defaultSystemPrompt: string | undefined,
): RunRequest {
  const request: RunRequest =
    typeof input === "string" ? { userMessage: input } : input;
  if (request.systemPrompt !== undefined || defaultSystemPrompt === undefined) {
    return request;
  }
  return { ...request, systemPrompt: defaultSystemPrompt };
}

function toRunResult(events: readonly Event[]): RunResult {
  const rounds = events.filter((event) => event.type === "llm_request").length;
  const terminal = events.at(-1);

  if (terminal?.type === "final_text") {
    return { text: terminal.text, events, rounds, stopReason: "final_text" };
  }
  if (terminal?.type === "cancelled") {
    return { text: "", events, rounds, stopReason: "cancelled" };
  }
  if (terminal?.type === "error") {
    const stopReason: StopReason =
      terminal.error instanceof MaxRoundsExceededError ? "max_rounds" : "error";
    return { text: "", events, rounds, stopReason, error: terminal.error };
  }

  throw new Error("Run ended without a terminal event.");
}

function withSkillsPrelude(
  systemPrompt: string | undefined,
  skills: SkillRegistry | undefined,
): string | undefined {
  if (skills === undefined) {
    return systemPrompt;
  }
  const prelude = skills.prelude();
  return systemPrompt === undefined ? prelude : `${systemPrompt}\n\n${prelude}`;
}

function withSkillsToolset(
  toolsets: readonly BaseToolset[] | undefined,
  skills: SkillRegistry | undefined,
): readonly BaseToolset[] | undefined {
  if (skills === undefined) {
    return toolsets;
  }
  return [...(toolsets ?? []), new SkillToolset(skills)];
}

export class Agent {
  private readonly runner: Runner;
  private readonly systemPrompt: string | undefined;

  constructor(options: AgentOptions) {
    this.systemPrompt = withSkillsPrelude(options.systemPrompt, options.skills);
    const toolsets = withSkillsToolset(options.toolsets, options.skills);
    this.runner = new Runner({
      provider: options.provider,
      ...(toolsets === undefined ? {} : { toolsets }),
      ...(options.maxRounds === undefined
        ? {}
        : { maxRounds: options.maxRounds }),
      ...(options.workspace === undefined
        ? {}
        : { workspace: options.workspace }),
    });
  }

  run(
    input: string | RunRequest,
    options?: { readonly signal?: AbortSignal },
  ): AsyncGenerator<Event, void, void> {
    const request = toRunRequest(input, this.systemPrompt);
    return this.runner.run(request, options);
  }

  async runSync(
    input: string | RunRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RunResult> {
    const events: Event[] = [];
    for await (const event of this.run(input, options)) {
      events.push(event);
    }
    return toRunResult(events);
  }
}
