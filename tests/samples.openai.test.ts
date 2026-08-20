import { describe, expect, it } from "vitest";
import { run } from "../samples/openai/run.mjs";
import { OpenAiProvider } from "../src/providers/openai.js";
import { startOpenAiHttpFixture } from "./support/openai-http-fixture.js";

describe("samples/openai", () => {
  it("runs a tool round then a text round against a fixture-backed OpenAiProvider", async () => {
    const fixture = await startOpenAiHttpFixture([
      {
        type: "json",
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "add", arguments: '{"a":2,"b":3}' },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        type: "json",
        body: {
          choices: [
            { message: { role: "assistant", content: "The answer is 5." } },
          ],
        },
      },
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sample-test",
        model: "gpt-4o-mini",
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
