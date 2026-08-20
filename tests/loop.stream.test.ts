import { describe, expect, it } from "vitest";
import type { Hooks } from "../src/hooks.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop streaming", () => {
  it("emits llm_delta events before llm_response, concatenating to the full text", async () => {
    const provider = new ScriptedProvider([{ text: "hello there" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi", stream: true }));
    const deltaIndexes = events
      .map((event, index) => (event.type === "llm_delta" ? index : -1))
      .filter((index) => index !== -1);
    const responseIndex = events.findIndex(
      (event) => event.type === "llm_response",
    );
    expect(deltaIndexes.length).toBeGreaterThan(0);
    expect(Math.max(...deltaIndexes)).toBeLessThan(responseIndex);

    const deltaText = events
      .filter((event) => event.type === "llm_delta")
      .map((event) => (event as { text: string }).text)
      .join("");
    const response = events[responseIndex];
    expect(response).toMatchObject({ text: "hello there" });
    expect(deltaText).toBe("hello there");
  });

  it("still runs a tool round normally under streaming, with no delta for the tool call", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 2 } }],
      },
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "go", stream: true }));
    expect(events.at(-1)).toMatchObject({ type: "final_text", text: "done" });
    const firstRoundDeltas = events
      .slice(
        0,
        events.findIndex((event) => event.type === "tool_call"),
      )
      .filter((event) => event.type === "llm_delta");
    expect(firstRoundDeltas).toEqual([]);
  });

  it("does not call chatStream when beforeModel short-circuits", async () => {
    const provider = new ScriptedProvider([{ text: "unreachable" }]);
    let chatStreamCalls = 0;
    const originalChatStream = provider.chatStream.bind(provider);
    provider.chatStream = (request) => {
      chatStreamCalls += 1;
      return originalChatStream(request);
    };
    const hooks: Hooks = {
      beforeModel: async () => ({ text: "from hook" }),
    };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi", stream: true }));
    expect(chatStreamCalls).toBe(0);
    expect(events.some((event) => event.type === "llm_delta")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "final_text", text: "from hook" });
  });

  it("afterModel still replaces the streamed response", async () => {
    const provider = new ScriptedProvider([{ text: "original" }]);
    const hooks: Hooks = {
      afterModel: async () => ({ text: "replaced" }),
    };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi", stream: true }));
    expect(events.at(-1)).toEqual({ type: "final_text", text: "replaced" });
  });

  it("emits llm_delta in both rounds of a multi-round streamed run", async () => {
    const provider = new ScriptedProvider([
      {
        text: "let me check",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 1, b: 1 } }],
      },
      { text: "the answer" },
    ]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "go", stream: true }));
    const toolCallIndex = events.findIndex(
      (event) => event.type === "tool_call",
    );
    const deltasBeforeToolCall = events
      .slice(0, toolCallIndex)
      .filter((event) => event.type === "llm_delta");
    const deltasAfterToolCall = events
      .slice(toolCallIndex)
      .filter((event) => event.type === "llm_delta");
    expect(deltasBeforeToolCall.length).toBeGreaterThan(0);
    expect(deltasAfterToolCall.length).toBeGreaterThan(0);
  });
});
