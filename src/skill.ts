import { InvalidSkillError } from "./errors.js";

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
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
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
