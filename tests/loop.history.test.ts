import { describe, expect, it } from "vitest";
import { MAX_TOOL_RESULT_CHARS, TruncatingCompactor } from "../src/context.js";
import { InvalidTranscriptError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";
import { HugeToolset } from "./support/huge-toolset.js";
import { LoopingProvider } from "./support/looping-provider.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop with priorMessages", () => {
  it("places priorMessages between the system prompt and the new user message", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const loop = new AgentLoop({ provider });
    await collect(
      loop.run({
        userMessage: "new question",
        systemPrompt: "be terse",
        priorMessages: [
          { role: "user", content: "old question" },
          { role: "assistant", content: "old answer" },
        ],
      }),
    );
    expect(provider.requests[0]?.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
    ]);
  });

  it("carries a full multi-turn history into the composed request", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const loop = new AgentLoop({ provider });
    await collect(
      loop.run({
        userMessage: "q2",
        priorMessages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
        ],
      }),
    );
    expect(provider.requests[0]?.messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("rejects invalid priorMessages before calling the provider", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const loop = new AgentLoop({ provider });
    await expect(
      collect(
        loop.run({
          userMessage: "go",
          priorMessages: [{ role: "tool", callId: "1", content: "oops" }],
        }),
      ),
    ).rejects.toThrow(InvalidTranscriptError);
    expect(provider.requests).toEqual([]);
  });
});

describe("AgentLoop with contextCompactor", () => {
  it("does not emit context_compacted when history stays under budget", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const compactor = new TruncatingCompactor({ maxMessages: 10 });
    const loop = new AgentLoop({ provider, contextCompactor: compactor });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.some((event) => event.type === "context_compacted")).toBe(
      false,
    );
  });

  it("never emits context_compacted without a configured compactor", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.some((event) => event.type === "context_compacted")).toBe(
      false,
    );
  });

  it("emits context_compacted once per round it fires, with matching before/after counts", async () => {
    const provider = new LoopingProvider({
      text: "",
      toolCalls: [{ id: "1", name: "noop", arguments: {} }],
    });
    const compactor = new TruncatingCompactor({ maxMessages: 2 });
    const loop = new AgentLoop({
      provider,
      toolsets: [new RecordingToolset()],
      contextCompactor: compactor,
    });
    const events = await collect(loop.run({ userMessage: "go", maxRounds: 3 }));
    const compactedEvents = events.filter(
      (event) => event.type === "context_compacted",
    );
    expect(compactedEvents).toEqual([
      { type: "context_compacted", before: 3, after: 2 },
      { type: "context_compacted", before: 4, after: 2 },
    ]);
  });
});

describe("AgentLoop tool result clipping across rounds", () => {
  it("carries the clipped tool result into the next round's request", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "huge", arguments: {} }],
      },
      { text: "done" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new HugeToolset()],
    });
    await collect(loop.run({ userMessage: "go" }));
    const secondRequest = provider.requests[1];
    const toolMessage = secondRequest?.messages.at(-1);
    if (toolMessage?.role !== "tool") {
      throw new Error("expected the last message to be a tool result");
    }
    expect(toolMessage.content).toContain("truncated");
    expect(toolMessage.content.length).toBeLessThan(
      MAX_TOOL_RESULT_CHARS + 500,
    );
  });
});
