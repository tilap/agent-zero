import { describe, expect, it } from "vitest";
import { MaxRoundsExceededError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import type { Event } from "../src/types.js";
import { LoopingProvider } from "./support/looping-provider.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop bounds", () => {
  it("stops after the default max rounds (10) when the model always calls a tool", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const toolset = new RecordingToolset();
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go" }));
    expect(provider.requests).toHaveLength(10);
  });

  it("omits tools only on the last request", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const toolset = new RecordingToolset();
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go", maxRounds: 3 }));
    expect(provider.requests[0]?.tools).toBeDefined();
    expect(provider.requests[1]?.tools).toBeDefined();
    expect(provider.requests[2]?.tools).toBeUndefined();
  });

  it("does not execute tool calls returned on the last round", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const toolset = new RecordingToolset();
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go", maxRounds: 3 }));
    expect(toolset.calls).toHaveLength(2);
  });

  it("stops with final_text when the last round has both tool calls and text", async () => {
    const provider = new LoopingProvider({
      text: "partial answer",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const toolset = new RecordingToolset();
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(loop.run({ userMessage: "go", maxRounds: 2 }));
    expect(events.at(-1)).toMatchObject({
      type: "final_text",
      text: "partial answer",
    });
  });

  it("stops with an error when the last round has tool calls and no text", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const toolset = new RecordingToolset();
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(loop.run({ userMessage: "go", maxRounds: 2 }));
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    expect(last).toMatchObject({
      type: "error",
      error: expect.any(MaxRoundsExceededError),
    });
  });
});
