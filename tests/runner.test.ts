import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import { Runner } from "../src/runner.js";
import type { Event } from "../src/types.js";
import { CalculatorToolset } from "./support/calculator.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("Runner", () => {
  it("yields the same event sequence as Agent for the same script", async () => {
    const script = [
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 2 } }],
      },
      { text: "4" },
    ];
    const runner = new Runner({
      provider: new ScriptedProvider(script),
      toolsets: [new CalculatorToolset()],
    });
    const agent = new Agent({
      provider: new ScriptedProvider(script),
      toolsets: [new CalculatorToolset()],
    });

    const runnerEvents = await collect(
      runner.run({ userMessage: "what is 2 + 2?" }),
    );
    const agentEvents = await collect(agent.run("what is 2 + 2?"));

    expect(runnerEvents).toEqual(agentEvents);
  });

  it("drives a run to final_text when constructed directly", async () => {
    const runner = new Runner({
      provider: new ScriptedProvider([{ text: "hi" }]),
    });
    const events = await collect(runner.run({ userMessage: "hi" }));
    expect(events.at(-1)).toEqual({ type: "final_text", text: "hi" });
  });

  it("is importable from the package entry point", async () => {
    const entryPoint: Record<string, unknown> = await import("../src/index.js");
    expect(entryPoint.Runner).toBe(Runner);
  });
});
