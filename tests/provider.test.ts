import { describe, expect, it } from "vitest";
import { ScriptExhaustedError } from "../src/errors.js";
import { ScriptedProvider } from "../src/providers/scripted.js";

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
});
