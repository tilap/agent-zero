# agent-zero

The smallest agent runtime that is still useful.

An agent run is a bounded loop: send messages (and optional tool
schemas) to a model; the model replies with text (stop) or tool calls
(execute, append results, loop); stop on text, cancel, or max rounds.

## Usage

```ts
import { Agent, ScriptedProvider } from "agent-zero";

const provider = new ScriptedProvider([{ text: "hello!" }]);
const agent = new Agent({ provider });

const result = await agent.runSync("hi");
console.log(result.text); // "hello!"
```

`ScriptedProvider` is a scripted stand-in for a real model — useful for
tests and for trying the runtime without wiring up an API key. A hosted
provider ships in a later phase; until then, bring your own `LlmProvider`
by implementing its one method, `chat`.

## Beyond the loop

Everything else attaches to that one loop as a toolset or a hook —
nothing here reopens it:

- **Tools** — implement `BaseToolset` and pass it to `Agent`. Unknown
  tools and toolset throws become results the model can read, not
  exceptions.
- **Skills** — `SkillRegistry.fromDirectory` discovers `SKILL.md` files;
  pass `registry.prelude()` as the system prompt and
  `new SkillToolset(registry)` in `toolsets`, the same way as MCP.
- **MCP** — `McpToolset.connectStdio` / `.connectSse` / `.connectHttp`
  wrap an MCP server as a toolset, tool names prefixed per server.
- **Hooks** — `AgentOptions.hooks` (`beforeModel`, `afterModel`,
  `beforeTool`, `afterTool`) can short-circuit or replace a model
  response or a tool result without writing a toolset.

Setup and development commands: see [docs/INDEX.md](docs/INDEX.md).
