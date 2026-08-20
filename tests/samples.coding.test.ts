import { describe, expect, it } from "vitest";
import { run } from "../samples/coding/run.mjs";
import { ScriptedProvider } from "../src/providers/scripted.js";
import type { Event, ToolResult } from "../src/types.js";

function toolResultFor(
  events: readonly Event[],
  callId: string,
): ToolResult | undefined {
  for (const event of events) {
    if (event.type === "tool_result" && event.result.callId === callId) {
      return event.result;
    }
  }
  return undefined;
}

describe("samples/coding", () => {
  it("writes a file (auto-approved), reads it back, then final text", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          {
            id: "1",
            name: "write",
            arguments: {
              path: "hello.txt",
              content: "Hello from the sandbox!",
            },
          },
        ],
      },
      {
        text: "",
        toolCalls: [
          { id: "2", name: "read", arguments: { path: "hello.txt" } },
        ],
      },
      { text: "Wrote and read back hello.txt." },
    ]);
    const events = await run({ provider });

    expect(events.at(-1)).toMatchObject({
      type: "final_text",
      text: "Wrote and read back hello.txt.",
    });

    const writeResult = toolResultFor(events, "1");
    expect(writeResult?.isError).toBeFalsy();

    const readResult = toolResultFor(events, "2");
    expect(readResult?.content).toBe("Hello from the sandbox!");
  });
});
