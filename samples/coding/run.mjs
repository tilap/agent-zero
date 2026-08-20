/* Run `pnpm build` first: node samples/coding/run.mjs */
import {
  LocalDirRunner,
  Runner,
  SandboxToolset,
  ScriptedProvider,
} from "../../dist/index.js";

const GATED_TOOLS = new Set(["write", "exec"]);

function defaultProvider() {
  return new ScriptedProvider([
    {
      text: "",
      toolCalls: [
        {
          id: "1",
          name: "write",
          arguments: { path: "hello.txt", content: "Hello from the sandbox!" },
        },
      ],
    },
    {
      text: "",
      toolCalls: [{ id: "2", name: "read", arguments: { path: "hello.txt" } }],
    },
    { text: "Wrote and read back hello.txt." },
  ]);
}

export async function run(overrides = {}) {
  const provider = overrides.provider ?? defaultProvider();
  const sandbox = new LocalDirRunner();
  await sandbox.setup();

  // Runner, not Agent — approval (Phase 14) needs the live handle Agent
  // never hands back.
  const runner = new Runner({
    provider,
    toolsets: [new SandboxToolset(sandbox)],
    approvalPolicy: { requiresApproval: (call) => GATED_TOOLS.has(call.name) },
  });

  const events = [];
  try {
    const gen = runner.run({
      userMessage: "Write hello.txt with a greeting, then read it back.",
    });
    let step = await gen.next();
    while (!step.done) {
      const event = step.value;
      events.push(event);
      console.log(event);
      if (event.type === "tool_call" && GATED_TOOLS.has(event.call.name)) {
        // approve() must resolve the pending request the loop registers
        // when it resumes — fire the next step first (without awaiting),
        // then approve, then await. A plain `for await` cannot do this:
        // it would await the next event before this callback runs again,
        // so approve() would fire before anything is pending yet.
        console.log(`  [approval] auto-approving "${event.call.name}"`);
        const pending = gen.next();
        runner.approve(event.call.id);
        step = await pending;
        continue;
      }
      step = await gen.next();
    }
  } finally {
    await sandbox.aclose();
  }
  return events;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
