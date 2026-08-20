import { describe, expect, it } from "vitest";
import type { ApprovalPolicy } from "../src/approval.js";
import {
  NoActiveRunError,
  UnknownApprovalRequestError,
} from "../src/errors.js";
import type { Hooks } from "../src/hooks.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import { Runner } from "../src/runner.js";
import type { Event } from "../src/types.js";
import { RecordingToolset } from "./support/recording-toolset.js";

async function exhaust(gen: AsyncGenerator<Event, void, void>) {
  const events: Event[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return events;
}

function gatedOn(ids: readonly string[]): ApprovalPolicy {
  return { requiresApproval: (call) => ids.includes(call.id) };
}

describe("Runner approval", () => {
  it("pauses an approved call until approve() is called, then runs it", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "done" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn(["1"]),
    });
    const gen = runner.run({ userMessage: "go" });
    const events: Event[] = [];
    events.push((await gen.next()).value as Event); // llm_request
    events.push((await gen.next()).value as Event); // llm_response
    events.push((await gen.next()).value as Event); // tool_call
    expect(events.at(-1)).toMatchObject({
      type: "tool_call",
      call: { id: "1" },
    });

    const pending = gen.next();
    runner.approve("1");
    events.push((await pending).value as Event); // tool_result

    expect(toolset.calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "tool_result",
      result: { callId: "1", content: "ok" },
    });
    const rest = await exhaust(gen);
    expect(rest.at(-1)).toEqual({ type: "final_text", text: "done" });
  });

  it("a denied call never reaches the toolset and is visible to the model", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "cannot do that" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn(["1"]),
    });
    const gen = runner.run({ userMessage: "go" });
    await gen.next(); // llm_request
    await gen.next(); // llm_response
    await gen.next(); // tool_call

    const pending = gen.next();
    runner.deny("1");
    const resultStep = await pending;

    expect(toolset.calls).toHaveLength(0);
    expect(resultStep.value).toMatchObject({
      type: "tool_result",
      result: {
        callId: "1",
        content: "Tool call denied by approval.",
        isError: true,
      },
    });
    const rest = await exhaust(gen);
    expect(rest.at(-1)).toEqual({ type: "final_text", text: "cannot do that" });
  });

  it("a policy that never gates behaves exactly like no approval configured", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "done" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn([]),
    });
    const events = await exhaust(runner.run({ userMessage: "go" }));
    expect(toolset.calls).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "final_text", text: "done" });
  });

  it("an ungated call in the same batch does not wait on its gated sibling", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [
          { id: "1", name: "noop", arguments: {} },
          { id: "2", name: "noop", arguments: {} },
        ],
      },
      { text: "done" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn(["1"]),
    });
    const gen = runner.run({ userMessage: "go" });
    await gen.next(); // llm_request
    await gen.next(); // llm_response
    await gen.next(); // tool_call 1
    await gen.next(); // tool_call 2

    const pending = gen.next();
    runner.approve("1");
    await pending; // tool_result 1
    const secondResult = await gen.next(); // tool_result 2
    expect(secondResult.value).toMatchObject({
      type: "tool_result",
      result: { callId: "2" },
    });

    await exhaust(gen);
    expect(toolset.calls.map((call) => call.id).sort()).toEqual(["1", "2"]);
    const secondRequest = provider.requests[1];
    const toolMessages = secondRequest?.messages.filter(
      (message) => message.role === "tool",
    );
    expect(toolMessages).toEqual([
      { role: "tool", callId: "1", content: "ok" },
      { role: "tool", callId: "2", content: "ok" },
    ]);
  });

  it("cancelling while waiting ends the run without calling the toolset", async () => {
    const toolset = new RecordingToolset();
    const controller = new AbortController();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "unreachable" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn(["1"]),
    });
    const gen = runner.run(
      { userMessage: "go" },
      { signal: controller.signal },
    );
    await gen.next(); // llm_request
    await gen.next(); // llm_response
    await gen.next(); // tool_call

    const pending = gen.next();
    controller.abort();
    await pending;

    const rest = await exhaust(gen);
    expect(rest.at(-1)).toEqual({ type: "cancelled" });
    expect(toolset.calls).toHaveLength(0);
    expect(provider.requests).toHaveLength(1);
  });

  it("throws UnknownApprovalRequestError for an id that is not pending", async () => {
    const provider = new ScriptedProvider([{ text: "hi" }]);
    const runner = new Runner({ provider });
    const gen = runner.run({ userMessage: "hi" });
    await gen.next();
    expect(() => runner.approve("nope")).toThrow(UnknownApprovalRequestError);
    await exhaust(gen);
  });

  it("throws NoActiveRunError before any run has started", () => {
    const runner = new Runner({ provider: new ScriptedProvider([]) });
    expect(() => runner.approve("1")).toThrow(NoActiveRunError);
    expect(() => runner.deny("1")).toThrow(NoActiveRunError);
  });

  it("a beforeTool short-circuit skips approval entirely for that call", async () => {
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "done" },
    ]);
    const hooks: Hooks = {
      beforeTool: async () => ({ callId: "1", content: "from hook" }),
    };
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      hooks,
      approvalPolicy: gatedOn(["1"]),
    });
    const events = await exhaust(runner.run({ userMessage: "go" }));
    expect(toolset.calls).toHaveLength(0);
    expect(events.find((event) => event.type === "tool_result")).toMatchObject({
      type: "tool_result",
      result: { content: "from hook" },
    });
  });

  it("a synchronous approve() inside a plain for-await loop body throws UnknownApprovalRequestError", async () => {
    // Pins a documented footgun (see docs/worklog/14-approval.md,
    // "Driving approval"): `for await` suspends the generator exactly at
    // the yielded tool_call event, before ApprovalRegistry.requestApproval
    // has registered the pending id — so calling approve() synchronously
    // inside the loop body always finds nothing pending. Not a bug in
    // Runner/ApprovalRegistry; the correct pattern steps the generator
    // manually (see the other tests in this file, or samples/coding).
    const toolset = new RecordingToolset();
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "noop", arguments: {} }] },
      { text: "done" },
    ]);
    const runner = new Runner({
      provider,
      toolsets: [toolset],
      approvalPolicy: gatedOn(["1"]),
    });

    const driveWithForAwait = async () => {
      for await (const event of runner.run({ userMessage: "go" })) {
        if (event.type === "tool_call" && event.call.id === "1") {
          runner.approve(event.call.id);
        }
      }
    };

    await expect(driveWithForAwait()).rejects.toThrow(
      UnknownApprovalRequestError,
    );
  });
});
