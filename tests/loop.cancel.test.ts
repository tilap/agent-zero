import { describe, expect, it } from "vitest";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/provider.js";
import type { LlmProvider } from "../src/provider.js";
import type { Event } from "../src/types.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop cancellation", () => {
  it("yields cancelled without calling the provider when already aborted", async () => {
    const provider = new ScriptedProvider([{ text: "unreachable" }]);
    const loop = new AgentLoop({ provider });
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      loop.run({ userMessage: "hi" }, { signal: controller.signal }),
    );
    expect(events).toEqual([{ type: "cancelled" }]);
    expect(provider.requests).toEqual([]);
  });

  it("yields cancelled after a tool aborts mid-run and does not call the provider again", async () => {
    const controller = new AbortController();
    const toolset = new RecordingToolset(controller);
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "noop", arguments: {} }],
      },
      { text: "unreachable" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(
      loop.run({ userMessage: "hi" }, { signal: controller.signal }),
    );
    expect(events.at(-1)).toEqual({ type: "cancelled" });
    expect(provider.requests).toHaveLength(1);
  });

  it("emits an error event when the provider rejects, without throwing", async () => {
    const provider: LlmProvider = {
      chat: async () => {
        throw new Error("boom");
      },
    };
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: expect.any(Error),
    });
  });

  it("emits exactly one terminal event for a normal run", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    const terminal = events.filter((event) =>
      ["final_text", "cancelled", "error"].includes(event.type),
    );
    expect(terminal).toHaveLength(1);
  });

  it("forwards the run's signal to tool execution, observable as aborted", async () => {
    const controller = new AbortController();
    const toolset = new RecordingToolset(controller);
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "noop", arguments: {} }],
      },
      { text: "unreachable" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(
      loop.run({ userMessage: "hi" }, { signal: controller.signal }),
    );
    expect(toolset.contexts[0]?.signal).toBe(controller.signal);
    expect(toolset.contexts[0]?.signal?.aborted).toBe(true);
  });
});
