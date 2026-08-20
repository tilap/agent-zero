# agent-zero

The smallest agent runtime that is still useful.

An agent run is a bounded loop: send messages (and optional tool
schemas) to a model; the model replies with text (stop) or tool calls
(execute, append results, loop); stop on text, cancel, or max rounds.

This is a learning/study project: I built it from scratch, one small
phase at a time, to understand what an agent runtime actually has to
do underneath a framework. I wrote a short post about it (in French):
[tilap.devo.fr/agent-ia-from-scratch](https://tilap.devo.fr/agent-ia-from-scratch/).

## Basic usage

```ts
import { Agent, ScriptedProvider } from "agent-zero";

const provider = new ScriptedProvider([{ text: "hello!" }]);
const agent = new Agent({ provider });

const result = await agent.runSync("hi");
console.log(result.text); // "hello!"
```

`ScriptedProvider` is a scripted stand-in for a real model — useful for
tests and for trying the runtime without wiring up an API key. Bring
your own `LlmProvider` by implementing its one method, `chat`, or use
one of the hosted providers below.

## Advanced usage

**A real model.** `OpenAiProvider` and `GeminiProvider` implement the
same `LlmProvider` interface as `ScriptedProvider` — swap it in, keep
everything else:

```ts
import { Agent, OpenAiProvider } from "agent-zero";

const provider = new OpenAiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
});
const agent = new Agent({ provider });

const result = await agent.runSync("What's the capital of France?");
console.log(result.text);
```

**A custom tool.** Extend `BaseToolset`, describe the tool's schema,
implement `execute` — the router handles unknown tools and thrown
errors for you:

```ts
import { Agent, BaseToolset, OpenAiProvider } from "agent-zero";

class Calculator extends BaseToolset {
  async listTools() {
    return [
      {
        name: "add",
        description: "Add two numbers.",
        parameters: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
      },
    ];
  }

  async execute(call) {
    const { a, b } = call.arguments;
    return { callId: call.id, content: String(a + b) };
  }
}

const agent = new Agent({
  provider: new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  toolsets: [new Calculator()],
});
```

**Streaming events.** `agent.runSync` collects a whole run into one
`RunResult`; `agent.run` is the underlying async generator, useful when
you want to react to each step (tokens, tool calls, tool results) as it
happens:

```ts
for await (const event of agent.run("hi")) {
  if (event.type === "llm_delta") process.stdout.write(event.text);
}
```

For pausing a tool call on a human decision, injecting a message into a
run already in progress, or driving a live run outside a simple
request/response, see `Runner` — the live-run handle `Agent` builds on
top of. Details: [docs/INDEX.md](docs/INDEX.md).

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

## Samples

`samples/` has small, runnable apps proving the published package
works end to end — a basic tool-calling loop, both hosted providers,
skills, a sandboxed coding agent with approval, and a readline REPL.
See [samples/README.md](samples/README.md).

Setup and development commands: see [docs/INDEX.md](docs/INDEX.md).

## License

MIT — see [LICENSE](LICENSE).
