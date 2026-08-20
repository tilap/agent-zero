# 06 — Skills

## What this ships

`parseSkill`, `SkillRegistry`, and `SkillToolset`. A skill is a folder
holding a `SKILL.md` file plus optional resource files. Nothing here
changes `AgentLoop`: skills are a toolset and a system-prompt addition,
same as tools were in Phase 3 — "more capability behind the same fork",
not a new one. Callers wire them the same way they pass any other
toolset: `systemPrompt: registry.prelude()` and
`toolsets: [new SkillToolset(registry), ...]`.

## Public types

```ts
export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
}

export interface Skill {
  readonly metadata: SkillMetadata;
  readonly directory: string; // absolute path to the folder holding SKILL.md
  readonly body: string; // markdown after the frontmatter
}

export function parseSkill(source: string, directory: string): Skill;

export class SkillRegistry {
  constructor(skills: readonly Skill[]);
  static fromDirectory(root: string): Promise<SkillRegistry>;
  list(): readonly SkillMetadata[];
  get(name: string): Skill | undefined;
  prelude(): string;
}

export class SkillToolset extends BaseToolset {
  constructor(registry: SkillRegistry);
  listTools(): Promise<readonly ToolSchema[]>;
  execute(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}

export class InvalidSkillError extends Error {}
export class DuplicateSkillNameError extends Error {}
```

## Behaviour

- A `SKILL.md` file is `---\nname: …\ndescription: …\n---\n<body>`. Only
  those two frontmatter fields are read; there is no general YAML parser
  here, just enough to pull two scalar lines out. A missing delimiter or
  a missing field throws `InvalidSkillError` naming the file.
- `SkillRegistry.fromDirectory(root)` reads one `SKILL.md` per immediate
  subdirectory of `root` — not recursive. Two skills that resolve to the
  same `metadata.name`, even from different directories, throw
  `DuplicateSkillNameError`. The frontmatter `name` is canonical; the
  directory name is not read back.
- Three levels of disclosure, matching what a model actually needs at
  each point:
  - **L1** — `SkillRegistry.list()` and `.prelude()` expose only
    `metadata` (name + description). This is what a caller puts in the
    system prompt so the model knows a skill exists without paying for
    its body.
  - **L2** — `Skill.body`, returned by the `load_skill` tool once the
    model decides a skill is relevant.
  - **L3** — a skill's resource files, returned by `load_skill_resource`
    once the skill's own body points the model at one.
- `SkillToolset` exposes exactly three tools:
  - `list_skills` — no arguments; returns the same text as
    `registry.prelude()`. It exists so a model can re-fetch the catalog
    mid-run, not because the catalog is otherwise hidden from it.
  - `load_skill({ name })` — returns the skill's `body`. An unknown name
    is an `isError` result naming the known skills, the same pattern as
    an unknown tool call (Phase 3) — a model-facing failure, not a throw.
  - `load_skill_resource({ name, path })` — reads `path` relative to the
    skill's `directory`. The resolved path must stay inside that
    directory; anything that escapes it (`../…`, an absolute path) is
    rejected as `isError` and is never read. A missing file is likewise
    `isError`.
- Wiring is the caller's job, the same as MCP: pass
  `systemPrompt: registry.prelude()` (after any other prompt text) and
  include `new SkillToolset(registry)` in `toolsets`. `Agent` has no
  skills-specific option.

## Non-goals

Skill discovery beyond one flat directory level, resource write access,
a general YAML/frontmatter parser for arbitrary fields, and any ranking
or search over skills — the model reads the whole L1 catalog and decides.
