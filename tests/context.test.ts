import { describe, expect, it } from "vitest";
import { MAX_TOOL_RESULT_CHARS, TruncatingCompactor } from "../src/context.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event, Message } from "../src/types.js";
import { HugeToolset } from "./support/huge-toolset.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function user(content: string): Message {
  return { role: "user", content };
}

function assistantText(content: string): Message {
  return { role: "assistant", content };
}

function assistantTool(id: string): Message {
  return {
    role: "assistant",
    content: "",
    toolCalls: [{ id, name: "noop", arguments: {} }],
  };
}

function toolResult(callId: string): Message {
  return { role: "tool", callId, content: "ok" };
}

describe("TruncatingCompactor", () => {
  it("returns the same array reference when already under budget", () => {
    const messages: Message[] = [user("hi")];
    const compactor = new TruncatingCompactor({ maxMessages: 5 });
    expect(compactor.compact(messages)).toBe(messages);
  });

  it("drops the oldest messages first when over budget", () => {
    const messages: Message[] = [
      user("1"),
      assistantText("a1"),
      user("2"),
      assistantText("a2"),
      user("3"),
    ];
    const compactor = new TruncatingCompactor({ maxMessages: 3 });
    expect(compactor.compact(messages)).toEqual(messages.slice(-3));
  });

  it("always keeps a leading system message", () => {
    const system: Message = { role: "system", content: "be terse" };
    const messages: Message[] = [
      system,
      user("1"),
      assistantText("a1"),
      user("2"),
      assistantText("a2"),
      user("3"),
    ];
    const compactor = new TruncatingCompactor({ maxMessages: 3 });
    const result = compactor.compact(messages);
    expect(result[0]).toEqual(system);
    expect(result).toHaveLength(3);
  });

  it("never splits an assistant tool-call group from its tool results", () => {
    const messages: Message[] = [
      user("go"),
      assistantTool("1"),
      toolResult("1"),
      user("next"),
      assistantText("done"),
    ];
    const compactor = new TruncatingCompactor({ maxMessages: 3 });
    const result = compactor.compact(messages);
    expect(result.some((message) => message.role === "tool")).toBe(false);
  });

  it("keeps the most recent chunk even alone over budget", () => {
    const messages: Message[] = [
      user("go"),
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "1", name: "noop", arguments: {} },
          { id: "2", name: "noop", arguments: {} },
          { id: "3", name: "noop", arguments: {} },
        ],
      },
      toolResult("1"),
      toolResult("2"),
      toolResult("3"),
    ];
    const compactor = new TruncatingCompactor({ maxMessages: 2 });
    const result = compactor.compact(messages);
    expect(result).toHaveLength(4);
    expect(result.some((message) => message.role === "user")).toBe(false);
  });
});

describe("tool result size cap", () => {
  it("leaves a result at or under the cap untouched", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "noop", arguments: {} }],
      },
      { text: "done" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new RecordingToolset()],
    });
    const events = await collect(loop.run({ userMessage: "go" }));
    const toolResultEvent = events.find(
      (event) => event.type === "tool_result",
    );
    expect(toolResultEvent).toMatchObject({
      type: "tool_result",
      result: { content: "ok" },
    });
  });

  it("clips an oversized tool result to MAX_TOOL_RESULT_CHARS with a marker", async () => {
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
    const events = await collect(loop.run({ userMessage: "go" }));
    const toolResultEvent = events.find(
      (event) => event.type === "tool_result",
    );
    if (toolResultEvent?.type !== "tool_result") {
      throw new Error("expected a tool_result event");
    }
    const content = toolResultEvent.result.content;
    expect(content.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 500);
    expect(content.startsWith("x".repeat(MAX_TOOL_RESULT_CHARS))).toBe(true);
    expect(content).toContain("truncated");
  });
});
