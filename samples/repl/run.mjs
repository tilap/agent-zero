/* Run `pnpm build` first: node samples/repl/run.mjs
 * Uses a real OpenAI account if OPENAI_API_KEY is set:
 *   OPENAI_API_KEY=sk-... node samples/repl/run.mjs
 * Otherwise falls back to a tiny canned ScriptedProvider conversation, same
 * OpenAiProvider class either way, only the backend differs (samples/openai
 * convention).
 *
 * No steering: injecting a message mid-run needs a non-blocking stdin read
 * while a turn is already in flight — out of scope for this sample. Type
 * "exit" to quit; Ctrl+C/Ctrl+D are not specially handled.
 */
import { createInterface } from "node:readline/promises";
import {
  BaseToolset,
  OpenAiProvider,
  Runner,
  ScriptedProvider,
} from "../../dist/index.js";

const GATED_TOOLS = new Set(["shout"]);

class Shout extends BaseToolset {
  async listTools() {
    return [
      {
        name: "shout",
        description: "Uppercase the given text.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ];
  }

  async execute(call) {
    return {
      callId: call.id,
      content: String(call.arguments.text).toUpperCase(),
    };
  }
}

function defaultProvider() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey !== undefined) {
    return new OpenAiProvider({
      apiKey,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  return new ScriptedProvider([
    {
      text: "",
      toolCalls: [
        { id: "1", name: "shout", arguments: { text: "hello from the repl" } },
      ],
    },
    { text: "Shouted a greeting for you." },
  ]);
}

function defaultInput() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    question: (prompt) => rl.question(prompt),
    close: () => rl.close(),
  };
}

// The loop's own `llm_request` event snapshots the exact running transcript
// (see loop.ts:148, mutated in place through the run) — reusing it here
// avoids re-deriving tool-call/tool-result pairing by hand. The only thing
// missing from that snapshot is the final round's own text, since the loop
// returns immediately after final_text without pushing it.
function nextHistory(history, events) {
  let lastRequestMessages;
  let finalText;
  for (const event of events) {
    if (event.type === "llm_request") {
      lastRequestMessages = event.messages;
    } else if (event.type === "final_text") {
      finalText = event.text;
    }
  }
  if (lastRequestMessages === undefined || finalText === undefined) {
    return history;
  }
  return [...lastRequestMessages, { role: "assistant", content: finalText }];
}

function render(event) {
  switch (event.type) {
    case "llm_delta":
      process.stdout.write(event.text);
      break;
    case "final_text":
      process.stdout.write("\n");
      break;
    case "tool_call":
      console.log(
        `  → tool: ${event.call.name}(${JSON.stringify(event.call.arguments)})`,
      );
      break;
    case "tool_result":
      console.log(`  ✓ ${event.result.content}`);
      break;
    case "error":
      console.error(`  ✗ ${event.error.message}`);
      break;
    default:
      break;
  }
}

export async function run(overrides = {}) {
  const provider = overrides.provider ?? defaultProvider();
  const input = overrides.input ?? defaultInput();

  const runner = new Runner({
    provider,
    toolsets: [new Shout()],
    approvalPolicy: { requiresApproval: (call) => GATED_TOOLS.has(call.name) },
  });

  const events = [];
  let history = [];

  try {
    for (;;) {
      const line = await input.question("> ");
      if (line === "exit") {
        break;
      }

      const turnEvents = [];
      const gen = runner.run({
        userMessage: line,
        priorMessages: history,
        stream: provider.chatStream !== undefined,
      });
      let step = await gen.next();
      while (!step.done) {
        const event = step.value;
        turnEvents.push(event);
        events.push(event);
        render(event);
        if (event.type === "tool_call" && GATED_TOOLS.has(event.call.name)) {
          const answer = await input.question(
            `  Autoriser "${event.call.name}(${JSON.stringify(event.call.arguments)})" ? [y/N] `,
          );
          // approve()/deny() must resolve the pending request the loop
          // registers when it resumes — fire the next step first (without
          // awaiting), then decide, then await. A plain `for await` cannot
          // do this: it would await the next event before this callback
          // runs again, so the decision would fire before anything is
          // pending yet (samples/coding documents the same trap).
          const pending = gen.next();
          if (answer.trim().toLowerCase().startsWith("y")) {
            runner.approve(event.call.id);
          } else {
            runner.deny(event.call.id);
          }
          step = await pending;
          continue;
        }
        step = await gen.next();
      }

      history = nextHistory(history, turnEvents);
    }
  } finally {
    input.close();
  }

  return events;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
