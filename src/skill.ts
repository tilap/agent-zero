import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { DuplicateSkillNameError, InvalidSkillError } from "./errors.js";

const FRONTMATTER_DELIMITER = "---";

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
}

export interface Skill {
  readonly metadata: SkillMetadata;
  readonly directory: string;
  readonly body: string;
}

function readFrontmatterField(
  fields: ReadonlyMap<string, string>,
  key: string,
  directory: string,
): string {
  const value = fields.get(key);
  if (value === undefined || value === "") {
    throw new InvalidSkillError(
      `SKILL.md in "${directory}" is missing a "${key}" field.`,
    );
  }
  return value;
}

export function parseSkill(source: string, directory: string): Skill {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new InvalidSkillError(
      `SKILL.md in "${directory}" must start with a "---" frontmatter block.`,
    );
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
  );
  if (closingIndex === -1) {
    throw new InvalidSkillError(
      `SKILL.md in "${directory}" is missing the closing "---" of its frontmatter.`,
    );
  }

  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closingIndex)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    fields.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }

  const name = readFrontmatterField(fields, "name", directory);
  const description = readFrontmatterField(fields, "description", directory);

  const bodyLines = lines.slice(closingIndex + 1);
  if (bodyLines[0] === "") {
    bodyLines.shift();
  }

  return {
    metadata: { name, description },
    directory,
    body: bodyLines.join("\n").trimEnd(),
  };
}

const SKILL_FILE_NAME = "SKILL.md";

export class SkillRegistry {
  private readonly skills: readonly Skill[];
  private readonly byName: ReadonlyMap<string, Skill>;

  constructor(skills: readonly Skill[]) {
    const byName = new Map<string, Skill>();
    for (const skill of skills) {
      if (byName.has(skill.metadata.name)) {
        throw new DuplicateSkillNameError(
          `Duplicate skill name: "${skill.metadata.name}".`,
        );
      }
      byName.set(skill.metadata.name, skill);
    }
    this.skills = skills;
    this.byName = byName;
  }

  static async fromDirectory(root: string): Promise<SkillRegistry> {
    const entries = await readdir(root, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const directory = join(root, entry.name);
      let source: string;
      try {
        source = await readFile(join(directory, SKILL_FILE_NAME), "utf8");
      } catch {
        continue;
      }
      skills.push(parseSkill(source, directory));
    }

    return new SkillRegistry(skills);
  }

  list(): readonly SkillMetadata[] {
    return this.skills.map((skill) => skill.metadata);
  }

  get(name: string): Skill | undefined {
    return this.byName.get(name);
  }

  prelude(): string {
    return this.skills
      .map((skill) => `${skill.metadata.name}: ${skill.metadata.description}`)
      .join("\n");
  }
}
