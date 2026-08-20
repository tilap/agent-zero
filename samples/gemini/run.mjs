/* Run `pnpm build` first: node samples/gemini/run.mjs
 * Uses a real Gemini account if GEMINI_API_KEY is set (free AI Studio
 * key, no card): GEMINI_API_KEY=AIza... node samples/gemini/run.mjs
 * Otherwise falls back to a tiny embedded offline fixture — same
 * GeminiProvider class either way, only the backend differs.
 */
import { createServer } from "node:http";
import { Agent, BaseToolset, GeminiProvider } from "../../dist/index.js";

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

// One canned functionCall-then-text exchange — enough to demonstrate the
// real GeminiProvider request/response mapping over a real (loopback)
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
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { functionCall: { name: "add", args: { a: 17, b: 25 } } },
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
          candidates: [
            { content: { role: "model", parts: [{ text: "17 + 25 is 42." }] } },
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey !== undefined) {
      provider = new GeminiProvider({
        apiKey,
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      });
    } else {
      const fixture = await startOfflineFixture();
      closeFixture = fixture.close;
      provider = new GeminiProvider({
        apiKey: "sample-offline-fake",
        model: "gemini-2.5-flash",
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
