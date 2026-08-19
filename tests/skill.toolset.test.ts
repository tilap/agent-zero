import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillRegistry, SkillToolset } from "../src/modules/skill/index.js";

const FIXTURES = join(import.meta.dirname, "support/skills");

async function loadToolset() {
  const registry = await SkillRegistry.fromDirectory(FIXTURES);
  return { registry, toolset: new SkillToolset(registry) };
}

describe("SkillToolset", () => {
  it("exposes exactly the three catalog tools", async () => {
    const { toolset } = await loadToolset();
    const tools = await toolset.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "list_skills",
      "load_skill",
      "load_skill_resource",
    ]);
  });

  it("list_skills returns the registry prelude", async () => {
    const { registry, toolset } = await loadToolset();
    const result = await toolset.execute(
      { id: "1", name: "list_skills", arguments: {} },
      {},
    );
    expect(result.content).toBe(registry.prelude());
    expect(result.isError).toBeUndefined();
  });

  it("load_skill returns the skill body", async () => {
    const { toolset } = await loadToolset();
    const result = await toolset.execute(
      { id: "1", name: "load_skill", arguments: { name: "writer" } },
      {},
    );
    expect(result.content).toContain("house style");
    expect(result.isError).toBeUndefined();
  });

  it("load_skill on an unknown name is an error result naming the known skills", async () => {
    const { toolset } = await loadToolset();
    const result = await toolset.execute(
      { id: "1", name: "load_skill", arguments: { name: "unknown" } },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("writer");
    expect(result.content).toContain("reviewer");
  });

  it("load_skill_resource returns a resource file's content", async () => {
    const { toolset } = await loadToolset();
    const result = await toolset.execute(
      {
        id: "1",
        name: "load_skill_resource",
        arguments: { name: "writer", path: "reference.md" },
      },
      {},
    );
    expect(result.content).toContain("Active voice");
    expect(result.isError).toBeUndefined();
  });

  it("load_skill_resource refuses a path that escapes the skill directory", async () => {
    const { toolset } = await loadToolset();
    const result = await toolset.execute(
      {
        id: "1",
        name: "load_skill_resource",
        arguments: { name: "writer", path: "../secret.txt" },
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).not.toContain("do-not-read-this-sentinel");
  });

  it("load_skill_resource on a missing file is an error result", async () => {
    const { toolset } = await loadToolset();
    const result = await toolset.execute(
      {
        id: "1",
        name: "load_skill_resource",
        arguments: { name: "writer", path: "missing.md" },
      },
      {},
    );
    expect(result.isError).toBe(true);
  });
});
