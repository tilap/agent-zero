import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ApprovalPolicy } from "../src/approval.js";
import {
  LocalDirRunner,
  SandboxToolset,
} from "../src/modules/sandbox/index.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import { Runner } from "../src/runner.js";
import type { Event } from "../src/types.js";

async function exhaust(gen: AsyncGenerator<Event, void, void>) {
  const events: Event[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return events;
}

describe("Sandbox composed with approval", () => {
  it("a denied exec call never reaches the sandbox", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-approval-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      const toolset = new SandboxToolset(runner);
      const policy: ApprovalPolicy = {
        requiresApproval: (call) => call.name === "exec",
      };
      const provider = new ScriptedProvider([
        {
          text: "",
          toolCalls: [
            {
              id: "1",
              name: "exec",
              arguments: { command: "touch marker.txt" },
            },
          ],
        },
        { text: "not allowed" },
      ]);
      const agentRunner = new Runner({
        provider,
        toolsets: [toolset],
        approvalPolicy: policy,
      });

      const gen = agentRunner.run({ userMessage: "make a file" });
      await gen.next(); // llm_request
      await gen.next(); // llm_response
      await gen.next(); // tool_call

      const pending = gen.next();
      agentRunner.deny("1");
      const resultStep = await pending;

      expect(resultStep.value).toMatchObject({
        type: "tool_result",
        result: { isError: true },
      });
      const events = await exhaust(gen);
      expect(events.at(-1)).toEqual({
        type: "final_text",
        text: "not allowed",
      });
      expect(existsSync(join(rootDir, "marker.txt"))).toBe(false);

      await runner.aclose();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
