/* Run `pnpm build` first: node samples/basic/run.mjs */
import { Agent, BaseToolset, ScriptedProvider } from "../../dist/index.js";

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

function defaultProvider() {
  return new ScriptedProvider([
    {
      text: "",
      toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 3 } }],
    },
    { text: "The answer is 5." },
  ]);
}

export async function run(overrides = {}) {
  const provider = overrides.provider ?? defaultProvider();
  const agent = new Agent({ provider, toolsets: [new Calculator()] });

  const events = [];
  for await (const event of agent.run("What is 2 + 3?")) {
    events.push(event);
    console.log(event);
  }
  return events;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
