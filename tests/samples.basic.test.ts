import { describe, expect, it } from "vitest";
import { run } from "../samples/basic/run.mjs";
import { ScriptedProvider } from "../src/providers/scripted.js";

describe("samples/basic", () => {
  it("runs a tool round then a text round with a scripted provider", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
      },
      { text: "The answer is 5." },
    ]);
    const events = await run({ provider });
    expect(events.at(-1)).toMatchObject({
      type: "final_text",
      text: "The answer is 5.",
    });
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
  });
});
