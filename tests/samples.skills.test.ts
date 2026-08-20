import { describe, expect, it } from "vitest";
import { run } from "../samples/skills/run.mjs";
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

describe("samples/skills", () => {
  it("lists then loads the bundled summarize skill, using its real body", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "list_skills", arguments: {} }],
      },
      {
        text: "",
        toolCalls: [
          { id: "2", name: "load_skill", arguments: { name: "summarize" } },
        ],
      },
      { text: "Loaded the summarize skill." },
    ]);
    const events = await run({ provider });

    expect(events.at(-1)).toMatchObject({
      type: "final_text",
      text: "Loaded the summarize skill.",
    });

    const loadResult = toolResultFor(events, "2");
    expect(loadResult?.content).toContain("three sentences");
  });
});
