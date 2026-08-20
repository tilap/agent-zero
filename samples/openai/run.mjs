/* Run `pnpm build` first: node samples/openai/run.mjs
 * Uses a real OpenAI account if OPENAI_API_KEY is set:
 *   OPENAI_API_KEY=sk-... node samples/openai/run.mjs
 * Otherwise falls back to a tiny embedded offline fixture — same
 * OpenAiProvider class either way, only the backend differs.
 */
import { createServer } from "node:http";
import { Agent, BaseToolset, OpenAiProvider } from "../../dist/index.js";

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

// One canned tool-call-then-text exchange — enough to demonstrate the
// real OpenAiProvider request/response mapping over a real (loopback)
// HTTP round trip, without needing a network or an API key.
async function startOfflineFixture() {
  let callCount = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      callCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      if (callCount === 1) {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "add", arguments: '{"a":17,"b":25}' },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [
            { message: { role: "assistant", content: "17 + 25 is 42." } },
          ],
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function run(overrides = {}) {
  let provider = overrides.provider;
  let closeFixture;

  if (provider === undefined) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey !== undefined) {
      provider = new OpenAiProvider({
        apiKey,
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      });
    } else {
      const fixture = await startOfflineFixture();
      closeFixture = fixture.close;
      provider = new OpenAiProvider({
        apiKey: "sample-offline-fake",
        model: "gpt-4o-mini",
        baseUrl: fixture.baseUrl,
      });
    }
  }

  const agent = new Agent({ provider, toolsets: [new Calculator()] });
  const events = [];
  try {
    for await (const event of agent.run("What is 17 + 25?")) {
      events.push(event);
      console.log(event);
    }
  } finally {
    await closeFixture?.();
  }
  return events;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
