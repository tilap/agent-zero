import { describe, expect, it } from "vitest";
import { run } from "../samples/gemini/run.mjs";
import { GeminiProvider } from "../src/providers/gemini.js";
import { startGeminiHttpFixture } from "./support/gemini-http-fixture.js";

describe("samples/gemini", () => {
  it("runs a tool round then a text round against a fixture-backed GeminiProvider", async () => {
    const fixture = await startGeminiHttpFixture([
      {
        type: "json",
        body: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { functionCall: { name: "add", args: { a: 2, b: 3 } } },
                ],
              },
            },
          ],
        },
      },
      {
        type: "json",
        body: {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "The answer is 5." }] },
            },
          ],
        },
      },
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "sample-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const events = await run({ provider });
      expect(events.at(-1)).toMatchObject({
        type: "final_text",
        text: "The answer is 5.",
      });
      expect(events.some((event) => event.type === "tool_result")).toBe(true);
    } finally {
      await fixture.close();
    }
  });
});
