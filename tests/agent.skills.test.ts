import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { ScriptedProvider } from "../src/provider.js";
import { SkillRegistry } from "../src/skill.js";

const FIXTURES = join(import.meta.dirname, "support/skills");

describe("Agent with skills", () => {
  it("composes the skill prelude into the system prompt", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    const provider = new ScriptedProvider([{ text: "done" }]);
    const agent = new Agent({ provider, skills: registry });

    await agent.runSync("hi");

    const [request] = provider.requests;
    const system = request?.messages.find(
      (message) => message.role === "system",
    );
    expect(system?.content).toContain(registry.prelude());
  });

  it("wires the skill catalog toolset without the caller passing toolsets", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "load_skill", arguments: { name: "writer" } },
        ],
      },
      { text: "loaded" },
    ]);
    const agent = new Agent({ provider, skills: registry });

    const result = await agent.runSync("load the writer skill");

    expect(result.stopReason).toBe("final_text");
    expect(result.text).toBe("loaded");
  });

  it("keeps both the caller's system prompt and the skill prelude", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    const provider = new ScriptedProvider([{ text: "done" }]);
    const agent = new Agent({
      provider,
      skills: registry,
      systemPrompt: "You are a careful assistant.",
    });

    await agent.runSync("hi");

    const [request] = provider.requests;
    const system = request?.messages.find(
      (message) => message.role === "system",
    );
    expect(system?.content).toContain("You are a careful assistant.");
    expect(system?.content).toContain(registry.prelude());
  });
});
