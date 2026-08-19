import { describe, expect, it } from "vitest";
import type { Hooks } from "../src/hooks.js";
import { AgentLoop } from "../src/loop.js";
import { ScriptedProvider } from "../src/provider.js";
import type { Event } from "../src/types.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function toolCallTurn(id: string) {
  return { text: "", toolCalls: [{ id, name: "noop", arguments: {} }] };
}

describe("hooks", () => {
  it("without hooks, behaviour matches the pre-hooks loop", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.map((event) => event.type)).toEqual([
      "llm_request",
      "llm_response",
      "final_text",
    ]);
  });

  it("beforeModel returning undefined lets the provider run normally", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const hooks: Hooks = { beforeModel: async () => undefined };
    const loop = new AgentLoop({ provider, hooks });
    await collect(loop.run({ userMessage: "hi" }));
    expect(provider.requests).toHaveLength(1);
  });

  it("beforeModel returning a response skips the provider", async () => {
    const provider = new ScriptedProvider([]);
    const hooks: Hooks = { beforeModel: async () => ({ text: "from hook" }) };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(provider.requests).toHaveLength(0);
    expect(events.some((event) => event.type === "llm_request")).toBe(false);
    expect(events).toContainEqual({ type: "llm_response", text: "from hook" });
    expect(events.at(-1)).toEqual({ type: "final_text", text: "from hook" });
  });

  it("afterModel returning undefined leaves the provider's response untouched", async () => {
    const provider = new ScriptedProvider([{ text: "original" }]);
    const hooks: Hooks = { afterModel: async () => undefined };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.at(-1)).toEqual({ type: "final_text", text: "original" });
  });

  it("afterModel returning a response replaces the provider's response", async () => {
    const provider = new ScriptedProvider([{ text: "original" }]);
    const hooks: Hooks = { afterModel: async () => ({ text: "replaced" }) };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.at(-1)).toEqual({ type: "final_text", text: "replaced" });
  });

  it("afterModel does not run when beforeModel already short-circuited", async () => {
    let afterModelCalls = 0;
    const provider = new ScriptedProvider([]);
    const hooks: Hooks = {
      beforeModel: async () => ({ text: "from hook" }),
      afterModel: async () => {
        afterModelCalls += 1;
        return undefined;
      },
    };
    const loop = new AgentLoop({ provider, hooks });
    await collect(loop.run({ userMessage: "hi" }));
    expect(afterModelCalls).toBe(0);
  });

  it("beforeTool returning undefined lets the toolset run normally", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "done" },
    ]);
    const hooks: Hooks = { beforeTool: async () => undefined };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    await collect(loop.run({ userMessage: "go" }));
    expect(toolset.calls).toHaveLength(1);
  });

  it("beforeTool returning a result skips the toolset", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "done" },
    ]);
    const hooks: Hooks = {
      beforeTool: async () => ({ callId: "1", content: "blocked" }),
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(toolset.calls).toHaveLength(0);
    expect(events).toContainEqual({
      type: "tool_result",
      result: { callId: "1", content: "blocked" },
    });
  });

  it("afterTool returning undefined leaves the toolset's result untouched", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "done" },
    ]);
    const hooks: Hooks = { afterTool: async () => undefined };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(events).toContainEqual({
      type: "tool_result",
      result: { callId: "1", content: "ok" },
    });
  });

  it("afterTool returning a result replaces the toolset's result", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "done" },
    ]);
    const hooks: Hooks = {
      afterTool: async () => ({ callId: "1", content: "redacted" }),
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(events).toContainEqual({
      type: "tool_result",
      result: { callId: "1", content: "redacted" },
    });
  });

  it("afterTool does not run when beforeTool already short-circuited", async () => {
    let afterToolCalls = 0;
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "done" },
    ]);
    const hooks: Hooks = {
      beforeTool: async () => ({ callId: "1", content: "blocked" }),
      afterTool: async () => {
        afterToolCalls += 1;
        return undefined;
      },
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    await collect(loop.run({ userMessage: "go" }));
    expect(afterToolCalls).toBe(0);
  });

  it("a throwing beforeModel is fatal: one error event, provider never called", async () => {
    const provider = new ScriptedProvider([{ text: "unreachable" }]);
    const hooks: Hooks = {
      beforeModel: async () => {
        throw new Error("boom");
      },
    };
    const loop = new AgentLoop({ provider, hooks });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(provider.requests).toHaveLength(0);
  });

  it("a throwing afterTool is fatal after the tool already executed", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      toolCallTurn("1"),
      { text: "unreachable" },
    ]);
    const hooks: Hooks = {
      afterTool: async () => {
        throw new Error("boom");
      },
    };
    const loop = new AgentLoop({ provider, toolsets: [toolset], hooks });
    const events = await collect(loop.run({ userMessage: "go" }));
    expect(toolset.calls).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});
