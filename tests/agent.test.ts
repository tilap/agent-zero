import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { MaxRoundsExceededError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";
import { CalculatorToolset } from "./support/calculator.js";
import { LoopingProvider } from "./support/looping-provider.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("Agent", () => {
  it("runSync completes a tool round then a text round", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 2 } }],
      },
      { text: "4" },
    ]);
    const agent = new Agent({ provider, toolsets: [new CalculatorToolset()] });
    const result = await agent.runSync("what is 2 + 2?");
    expect(result.text).toBe("4");
    expect(result.stopReason).toBe("final_text");
    expect(result.rounds).toBe(2);
  });

  it("run yields the same event sequence as AgentLoop directly", async () => {
    const script = [{ text: "hello" }];
    const loop = new AgentLoop({ provider: new ScriptedProvider(script) });
    const agent = new Agent({ provider: new ScriptedProvider(script) });

    const loopEvents = await collect(loop.run({ userMessage: "hi" }));
    const agentEvents = await collect(agent.run("hi"));

    expect(agentEvents).toEqual(loopEvents);
  });

  it("treats a string input and the equivalent RunRequest identically", async () => {
    const script = [{ text: "hello" }];
    const agentA = new Agent({ provider: new ScriptedProvider(script) });
    const agentB = new Agent({ provider: new ScriptedProvider(script) });

    const resultA = await agentA.runSync("hi");
    const resultB = await agentB.runSync({ userMessage: "hi" });

    expect(resultA).toEqual(resultB);
  });

  it("reports cancellation through runSync", async () => {
    const provider = new ScriptedProvider([{ text: "unreachable" }]);
    const agent = new Agent({ provider });
    const controller = new AbortController();
    controller.abort();
    const result = await agent.runSync("hi", { signal: controller.signal });
    expect(result.stopReason).toBe("cancelled");
    expect(result.text).toBe("");
  });

  it("reports max_rounds with a MaxRoundsExceededError", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "add", arguments: { a: 1, b: 1 } }],
    });
    const agent = new Agent({
      provider,
      toolsets: [new CalculatorToolset()],
      maxRounds: 2,
    });
    const result = await agent.runSync("go");
    expect(result.stopReason).toBe("max_rounds");
    expect(result.error).toBeInstanceOf(MaxRoundsExceededError);
  });

  it("forwards AgentOptions.generationParams as a run default", async () => {
    const provider = new ScriptedProvider([{ text: "hi" }]);
    const generationParams = { temperature: 0.3, topP: 0.9 };
    const agent = new Agent({ provider, generationParams });
    await agent.runSync("hi");
    expect(provider.requests[0]?.generationParams).toEqual(generationParams);
  });

  it("exports Runner from the public entry point alongside Agent", async () => {
    const entryPoint: Record<string, unknown> = await import("../src/index.js");
    expect("Runner" in entryPoint).toBe(true);
    expect(entryPoint.Agent).toBeDefined();
  });
});
