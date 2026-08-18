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

Setup and development commands: see [docs/INDEX.md](docs/INDEX.md).
