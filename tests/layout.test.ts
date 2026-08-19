import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");

const FORBIDDEN_CORE_IMPORT =
  /from ["']\.\/(?:skill|mcp|modules\/|providers\/)/;

async function coreSourceFiles(): Promise<string[]> {
  const entries = await readdir(SRC, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        entry.name !== "index.ts",
    )
    .map((entry) => join(SRC, entry.name));
}

describe("source layout", () => {
  it("keeps skill, mcp, and the scripted provider out of the src root", () => {
    expect(existsSync(join(SRC, "skill.ts"))).toBe(false);
    expect(existsSync(join(SRC, "mcp.ts"))).toBe(false);
    expect(existsSync(join(SRC, "modules/skill/index.ts"))).toBe(true);
    expect(existsSync(join(SRC, "modules/mcp/index.ts"))).toBe(true);
    expect(existsSync(join(SRC, "providers/scripted.ts"))).toBe(true);
    expect(existsSync(join(SRC, "provider.ts"))).toBe(true);
  });

  it("loads skill, mcp, and the scripted provider from their directories", async () => {
    const skill = await import("../src/modules/skill/index.js");
    const mcp = await import("../src/modules/mcp/index.js");
    const scripted = await import("../src/providers/scripted.js");

    expect(skill.parseSkill).toBeTypeOf("function");
    expect(skill.SkillRegistry).toBeDefined();
    expect(skill.SkillToolset).toBeDefined();
    expect(mcp.McpToolset).toBeDefined();
    expect(scripted.ScriptedProvider).toBeDefined();
  });

  it("does not let core files import modules or providers", async () => {
    const files = await coreSourceFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(FORBIDDEN_CORE_IMPORT);
    }
  });
});
