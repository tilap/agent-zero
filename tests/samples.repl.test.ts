import { describe, expect, it } from "vitest";
import { run } from "../samples/repl/run.mjs";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event, Message } from "../src/types.js";

function scriptedInput(lines: readonly string[]) {
  let cursor = 0;
  return {
    async question(_prompt: string): Promise<string> {
      const line = lines[cursor];
      cursor += 1;
      return line ?? "exit";
    },
    close(): void {},
  };
}

function llmRequestMessages(events: readonly Event[]): (readonly Message[])[] {
  const seen: (readonly Message[])[] = [];
  for (const event of events) {
    if (event.type === "llm_request") {
      seen.push(event.messages);
    }
  }
  return seen;
}

describe("samples/repl", () => {
  it("exits immediately without calling the provider when the first line is exit", async () => {
    const provider = new ScriptedProvider([]);
    const events = await run({
      provider,
      input: scriptedInput(["exit"]),
    });

    expect(events).toEqual([]);
    expect(provider.requests).toEqual([]);
  });

  it("runs a single no-tool-call turn to final_text", async () => {
    const provider = new ScriptedProvider([{ text: "hello back" }]);
    const events = await run({
      provider,
      input: scriptedInput(["hi", "exit"]),
    });

    expect(
      events.some(
        (event) => event.type === "final_text" && event.text === "hello back",
      ),
    ).toBe(true);
  });

  it("approves the gated shout tool on a 'y' answer and uppercases the text", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "shout", arguments: { text: "hi there" } },
        ],
      },
      { text: "done" },
    ]);
    const events = await run({
      provider,
      input: scriptedInput(["say hi loudly", "y", "exit"]),
    });

    const result = events.find(
      (event) => event.type === "tool_result" && event.result.callId === "1",
    );
    expect(result).toMatchObject({
      type: "tool_result",
      result: { content: "HI THERE" },
    });
    expect(result?.type === "tool_result" && result.result.isError).toBeFalsy();
    expect(
      events.some(
        (event) => event.type === "final_text" && event.text === "done",
      ),
    ).toBe(true);
  });

  it("denies the gated shout tool on a 'n' answer", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "shout", arguments: { text: "nope" } }],
      },
      { text: "noted" },
    ]);
    const events = await run({
      provider,
      input: scriptedInput(["say nope loudly", "n", "exit"]),
    });

    const result = events.find(
      (event) => event.type === "tool_result" && event.result.callId === "1",
    );
    expect(result).toMatchObject({
      type: "tool_result",
      result: { isError: true },
    });
  });

  it("carries prior turns forward as priorMessages on the next turn", async () => {
    const provider = new ScriptedProvider([
      { text: "hi there" },
      { text: "ok" },
    ]);
    const events = await run({
      provider,
      input: scriptedInput(["hello", "world", "exit"]),
    });

    const requests = llmRequestMessages(events);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "world" },
    ]);
  });
});
