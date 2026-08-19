import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DuplicateSkillNameError,
  InvalidSkillError,
  SkillRegistry,
  parseSkill,
} from "../src/modules/skill/index.js";

const FIXTURES = join(import.meta.dirname, "support/skills");

describe("parseSkill", () => {
  it("parses metadata and body from valid frontmatter", () => {
    const skill = parseSkill(
      "---\nname: writer\ndescription: Drafts short prose.\n---\nBody text.",
      "/skills/writer",
    );
    expect(skill.metadata).toEqual({
      name: "writer",
      description: "Drafts short prose.",
    });
    expect(skill.body).toContain("Body text.");
    expect(skill.directory).toBe("/skills/writer");
  });

  it("throws when the name field is missing", () => {
    expect(() =>
      parseSkill("---\ndescription: no name here\n---\nBody.", "/skills/x"),
    ).toThrow(InvalidSkillError);
  });

  it("throws when the description field is missing", () => {
    expect(() => parseSkill("---\nname: x\n---\nBody.", "/skills/x")).toThrow(
      InvalidSkillError,
    );
  });

  it("throws when there is no frontmatter delimiter", () => {
    expect(() =>
      parseSkill("just a body, no frontmatter", "/skills/x"),
    ).toThrow(InvalidSkillError);
  });
});

describe("SkillRegistry", () => {
  it("discovers every SKILL.md under the root directory", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    expect(
      registry
        .list()
        .map((metadata) => metadata.name)
        .sort(),
    ).toEqual(["reviewer", "writer"]);
  });

  it("rejects two skills that share a name", () => {
    const original = parseSkill(
      "---\nname: writer\ndescription: Drafts short prose.\n---\nBody.",
      "/skills/writer",
    );
    const duplicate = parseSkill(
      "---\nname: writer\ndescription: another one\n---\nBody.",
      "/skills/writer-2",
    );
    expect(() => new SkillRegistry([original, duplicate])).toThrow(
      DuplicateSkillNameError,
    );
  });

  it("list() carries metadata only, no body", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    for (const metadata of registry.list()) {
      expect("body" in metadata).toBe(false);
    }
  });

  it("prelude() contains L1 metadata but not skill bodies", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    const prelude = registry.prelude();
    expect(prelude).toContain("writer");
    expect(prelude).toContain("Drafts short prose from bullet points.");
    expect(prelude).toContain("reviewer");
    expect(prelude).not.toContain("house style");
  });

  it("get() returns the full skill for a known name", async () => {
    const registry = await SkillRegistry.fromDirectory(FIXTURES);
    expect(registry.get("writer")?.metadata.name).toBe("writer");
    expect(registry.get("unknown")).toBeUndefined();
  });
});
