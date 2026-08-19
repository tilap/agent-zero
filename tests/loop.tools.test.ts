import { describe, expect, it } from "vitest";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";
import { CalculatorToolset } from "./support/calculator.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop with tools", () => {
  it("runs a tool round then a text round", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
      },
      { text: "the answer is 5" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    const events = await collect(loop.run({ userMessage: "what is 2+3?" }));
    const finalText = events.at(-1);
    expect(finalText).toMatchObject({
      type: "final_text",
      text: "the answer is 5",
    });
  });

  it("emits events in the expected order for a tool round", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
      },
      { text: "the answer is 5" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    const events = await collect(loop.run({ userMessage: "what is 2+3?" }));
    expect(events.map((event) => event.type)).toEqual([
      "llm_request",
      "llm_response",
      "tool_call",
      "tool_result",
      "llm_request",
      "llm_response",
      "final_text",
    ]);
  });

  it("appends the assistant tool-call message then the tool result message", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
      },
      { text: "the answer is 5" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    await collect(loop.run({ userMessage: "what is 2+3?" }));
    const secondRequest = provider.requests[1];
    expect(secondRequest?.messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
    });
    expect(secondRequest?.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "1",
      content: "5",
    });
  });

  it("appends results for two calls in one turn in call order", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "add", arguments: { a: 1, b: 1 } },
          { id: "2", name: "add", arguments: { a: 2, b: 2 } },
        ],
      },
      { text: "done" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    await collect(loop.run({ userMessage: "add stuff" }));
    const secondRequest = provider.requests[1];
    const toolMessages = secondRequest?.messages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toEqual([
      { role: "tool", callId: "1", content: "2" },
      { role: "tool", callId: "2", content: "4" },
    ]);
  });

  it("sends the tool schemas on every request", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 1, b: 1 } }],
      },
      { text: "done" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    await collect(loop.run({ userMessage: "add stuff" }));
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toContain(
      "add",
    );
    expect(provider.requests[1]?.tools?.map((tool) => tool.name)).toContain(
      "add",
    );
  });

  it("lets the model see an isError tool result and continue", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "divide", arguments: { a: 1, b: 0 } }],
      },
      { text: "cannot divide by zero" },
    ]);
    const loop = new AgentLoop({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    const events = await collect(loop.run({ userMessage: "divide by 0" }));
    const finalText = events.at(-1);
    expect(finalText).toMatchObject({
      type: "final_text",
      text: "cannot divide by zero",
    });
    const secondRequest = provider.requests[1];
    expect(secondRequest?.messages.at(-1)).toMatchObject({
      role: "tool",
      isError: true,
    });
  });
});
