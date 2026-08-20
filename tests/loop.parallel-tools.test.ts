import { describe, expect, it } from "vitest";
import type { Hooks } from "../src/hooks.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";
import {
  ConcurrencyProbeToolset,
  DelayedToolset,
} from "./support/concurrency-probe.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function batchTurn(ids: readonly string[]) {
  return {
    text: "",
    toolCalls: ids.map((id) => ({ id, name: "wait", arguments: {} })),
  };
}

describe("AgentLoop parallel tool dispatch", () => {
  it("runs a two-call batch concurrently instead of hanging", async () => {
    const toolset = new ConcurrencyProbeToolset(2);
    const provider = new ScriptedProvider([
      batchTurn(["1", "2"]),
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(events.at(-1)).toMatchObject({ type: "final_text", text: "done" });
    expect(toolset.maxInFlight).toBe(2);
  });

  it("has both calls start before either ends", async () => {
    const toolset = new ConcurrencyProbeToolset(2);
    const provider = new ScriptedProvider([
      batchTurn(["1", "2"]),
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go" }));
    const phases = toolset.events.map((event) => event.phase);
    expect(phases).toEqual(["start", "start", "end", "end"]);
  });

  it("runs a three-call batch concurrently", async () => {
    const toolset = new ConcurrencyProbeToolset(3);
    const provider = new ScriptedProvider([
      batchTurn(["1", "2", "3"]),
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go" }));
    expect(toolset.maxInFlight).toBe(3);
  });

  it("emits every tool_call before any tool_result in a batch", async () => {
    const toolset = new ConcurrencyProbeToolset(2);
    const provider = new ScriptedProvider([
      batchTurn(["1", "2"]),
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(events.map((event) => event.type)).toEqual([
      "llm_request",
      "llm_response",
      "tool_call",
      "tool_call",
      "tool_result",
      "tool_result",
      "llm_request",
      "llm_response",
      "final_text",
    ]);
  });

  it("appends batch results in call order even when they settle out of order", async () => {
    const toolset = new DelayedToolset(new Map([["1", 20]]));
    const provider = new ScriptedProvider([
      batchTurn(["1", "2"]),
      { text: "done" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    await collect(loop.run({ userMessage: "go" }));
    expect(
      toolset.events.map((event) => `${event.callId}:${event.phase}`),
    ).toEqual(["1:start", "2:start", "2:end", "1:end"]);
    const secondRequest = provider.requests[1];
    const toolMessages = secondRequest?.messages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toEqual([
      { role: "tool", callId: "1", content: "done:1" },
      { role: "tool", callId: "2", content: "done:2" },
    ]);
  });

  it("a throwing afterTool for one call in a batch is fatal for the whole batch", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "noop", arguments: {} },
          { id: "2", name: "noop", arguments: {} },
        ],
      },
      { text: "unreachable" },
    ]);
    const hooks: Hooks = {
      afterTool: async ({ call }) => {
        if (call.id === "2") {
          throw new Error("boom");
        }
        return undefined;
      },
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(toolset.calls.map((call) => call.id)).toEqual(["1", "2"]);
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(events.some((event) => event.type === "tool_result")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("a beforeTool short-circuit for one call does not block its sibling", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "noop", arguments: {} },
          { id: "2", name: "noop", arguments: {} },
        ],
      },
      { text: "done" },
    ]);
    const hooks: Hooks = {
      beforeTool: async ({ call }) =>
        call.id === "1" ? { callId: "1", content: "blocked" } : undefined,
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    await collect(loop.run({ userMessage: "go" }));
    expect(toolset.calls.map((call) => call.id)).toEqual(["2"]);
    const secondRequest = provider.requests[1];
    const toolMessages = secondRequest?.messages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toEqual([
      { role: "tool", callId: "1", content: "blocked" },
      { role: "tool", callId: "2", content: "ok" },
    ]);
  });

  it("does not skip a sibling call once a batch has started, even after cancellation", async () => {
    const controller = new AbortController();
    const toolset = new RecordingToolset(controller);
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "noop", arguments: {} },
          { id: "2", name: "noop", arguments: {} },
        ],
      },
      { text: "unreachable" },
    ]);
    const loop = new AgentLoop({ provider, toolsets: [toolset] });
    const events = await collect(
      loop.run({ userMessage: "go" }, { signal: controller.signal }),
    );
    expect(toolset.calls.map((call) => call.id)).toEqual(["1", "2"]);
    expect(events.at(-1)).toEqual({ type: "cancelled" });
    expect(provider.requests).toHaveLength(1);
  });
});
