import { describe, expect, it } from "vitest";
import { UnsupportedOptionError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import type { LlmProvider } from "../src/provider.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event } from "../src/types.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentLoop", () => {
  it("emits llm_request, llm_response, final_text for one round", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    expect(events.map((event) => event.type)).toEqual([
      "llm_request",
      "llm_response",
      "final_text",
    ]);
  });

  it("final_text carries the scripted text", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const events = await collect(loop.run({ userMessage: "hi" }));
    const finalText = events.at(-1);
    expect(finalText).toMatchObject({ type: "final_text", text: "hello" });
  });

  it("composes system prompt then user message", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    await collect(loop.run({ userMessage: "hi", systemPrompt: "be terse" }));
    expect(provider.requests[0]?.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
  });

  it("omits the system message when no systemPrompt is given", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    await collect(loop.run({ userMessage: "hi" }));
    expect(provider.requests[0]?.messages).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("forwards RunRequest.generationParams into every llmRequest", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const generationParams = { temperature: 0.2, maxTokens: 64 };
    await collect(loop.run({ userMessage: "hi", generationParams }));
    expect(provider.requests[0]?.generationParams).toEqual(generationParams);
  });

  it("omits generationParams from llmRequest when not given", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    await collect(loop.run({ userMessage: "hi" }));
    expect(provider.requests[0]?.generationParams).toBeUndefined();
  });

  it("rejects stream before calling a provider without chatStream", async () => {
    // ScriptedProvider implements chatStream (Phase 17) — a provider that
    // does not is the one that still needs to reject stream: true.
    const calls: unknown[] = [];
    const provider: LlmProvider = {
      chat: async (request) => {
        calls.push(request);
        return { text: "unreachable" };
      },
    };
    const loop = new AgentLoop({ provider });
    await expect(
      collect(loop.run({ userMessage: "hi", stream: true })),
    ).rejects.toThrow(UnsupportedOptionError);
    expect(calls).toEqual([]);
  });

  it("completes the generator right after final_text", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const loop = new AgentLoop({ provider });
    const generator = loop.run({ userMessage: "hi" });
    const seen: Event[] = [];
    for await (const event of generator) {
      seen.push(event);
    }
    expect(seen).toHaveLength(3);
  });
});
