import { describe, expect, it } from "vitest";
import { ScriptExhaustedError } from "../src/errors.js";
import type { LlmDelta, LlmResponse } from "../src/provider.js";
import { ScriptedProvider } from "../src/providers/scripted.js";

async function drainStream(
  stream: AsyncGenerator<LlmDelta, LlmResponse, void>,
) {
  const deltas: LlmDelta[] = [];
  let step = await stream.next();
  while (!step.done) {
    deltas.push(step.value);
    step = await stream.next();
  }
  return { deltas, response: step.value };
}

describe("ScriptedProvider", () => {
  it("returns the first scripted text", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const response = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.text).toBe("hello");
  });

  it("returns successive scripts in order", async () => {
    const provider = new ScriptedProvider([
      { text: "first" },
      { text: "second" },
    ]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    await expect(provider.chat(request)).resolves.toMatchObject({
      text: "first",
    });
    await expect(provider.chat(request)).resolves.toMatchObject({
      text: "second",
    });
  });

  it("throws once the script is exhausted", async () => {
    const provider = new ScriptedProvider([{ text: "only" }]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    await provider.chat(request);
    await expect(provider.chat(request)).rejects.toThrow(ScriptExhaustedError);
  });

  it("records every request received, in order", async () => {
    const provider = new ScriptedProvider([{ text: "a" }, { text: "b" }]);
    const first = { messages: [{ role: "user", content: "one" }] } as const;
    const second = { messages: [{ role: "user", content: "two" }] } as const;
    await provider.chat(first);
    await provider.chat(second);
    expect(provider.requests).toEqual([first, second]);
  });

  it("chatStream deltas concatenate back to the scripted text", async () => {
    const provider = new ScriptedProvider([{ text: "hello there" }]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    const { deltas, response } = await drainStream(
      provider.chatStream(request),
    );
    expect(deltas.map((delta) => delta.text).join("")).toBe("hello there");
    expect(response.text).toBe("hello there");
  });

  it("chatStream's return value matches chat() for the same position", async () => {
    const provider = new ScriptedProvider([{ text: "hello" }]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    const { response } = await drainStream(provider.chatStream(request));
    expect(response).toEqual({ text: "hello" });
  });

  it("chatStream carries toolCalls on the return value, never on a delta", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 1, b: 1 } }],
      },
    ]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    const { deltas, response } = await drainStream(
      provider.chatStream(request),
    );
    expect(response.toolCalls).toEqual([
      { id: "1", name: "add", arguments: { a: 1, b: 1 } },
    ]);
    expect(deltas).toEqual([]);
  });

  it("chatStream advances the same cursor as chat()", async () => {
    const provider = new ScriptedProvider([
      { text: "first" },
      { text: "second" },
    ]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    const { response: streamedFirst } = await drainStream(
      provider.chatStream(request),
    );
    expect(streamedFirst.text).toBe("first");
    const chatted = await provider.chat(request);
    expect(chatted.text).toBe("second");
  });

  it("chatStream throws ScriptExhaustedError once the script is exhausted", async () => {
    const provider = new ScriptedProvider([{ text: "only" }]);
    const request = { messages: [{ role: "user", content: "hi" }] } as const;
    await provider.chat(request);
    await expect(drainStream(provider.chatStream(request))).rejects.toThrow(
      ScriptExhaustedError,
    );
  });

  it("chatStream records the request onto the same .requests array", async () => {
    const provider = new ScriptedProvider([{ text: "a" }, { text: "b" }]);
    const first = { messages: [{ role: "user", content: "one" }] } as const;
    const second = { messages: [{ role: "user", content: "two" }] } as const;
    await drainStream(provider.chatStream(first));
    await provider.chat(second);
    expect(provider.requests).toEqual([first, second]);
  });
});
