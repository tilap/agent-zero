import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import type { Hooks } from "../src/hooks.js";
import { ScriptedProvider } from "../src/providers/scripted.js";

describe("Agent with hooks", () => {
  it("threads hooks through to the loop", async () => {
    const provider = new ScriptedProvider([]);
    const hooks: Hooks = { beforeModel: async () => ({ text: "from hook" }) };
    const agent = new Agent({ provider, hooks });

    const result = await agent.runSync("hi");

    expect(provider.requests).toHaveLength(0);
    expect(result).toMatchObject({
      text: "from hook",
      stopReason: "final_text",
    });
  });
});
