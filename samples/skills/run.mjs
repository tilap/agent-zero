/* Run `pnpm build` first: node samples/skills/run.mjs */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  ScriptedProvider,
  SkillRegistry,
  SkillToolset,
} from "../../dist/index.js";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "skills");

function defaultProvider() {
  return new ScriptedProvider([
    { text: "", toolCalls: [{ id: "1", name: "list_skills", arguments: {} }] },
    {
      text: "",
      toolCalls: [
        { id: "2", name: "load_skill", arguments: { name: "summarize" } },
      ],
    },
    { text: "Loaded the summarize skill." },
  ]);
}

export async function run(overrides = {}) {
  const provider = overrides.provider ?? defaultProvider();
  const registry = await SkillRegistry.fromDirectory(SKILLS_DIR);

  // No AgentOptions.skills — wire the prelude and the toolset by hand,
  // the shape Phase 6's core/modules layout settled on.
  const agent = new Agent({
    provider,
    systemPrompt: registry.prelude(),
    toolsets: [new SkillToolset(registry)],
  });

  const events = [];
  for await (const event of agent.run("What skills do you have?")) {
    events.push(event);
    console.log(event);
  }
  return events;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
