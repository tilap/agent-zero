import { describe, expect, it } from "vitest";
import { NoActiveRunError } from "../src/errors.js";
import { ScriptedProvider } from "../src/providers/scripted.js";
import { Runner } from "../src/runner.js";
import type { Event } from "../src/types.js";
import { CalculatorToolset } from "./support/calculator.js";

async function drive(
  gen: AsyncGenerator<Event, void, void>,
  onEvent: (event: Event, events: readonly Event[]) => void,
): Promise<Event[]> {
  const events: Event[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    onEvent(step.value, events);
    step = await gen.next();
  }
  return events;
}

function twoRoundScript() {
  return [
    {
      text: "",
      toolCalls: [{ id: "1", name: "add", arguments: { a: 2, b: 2 } }],
    },
    { text: "4" },
  ];
}

describe("Runner steering", () => {
  it("injects queued text before the next round's request", async () => {
    const provider = new ScriptedProvider(twoRoundScript());
    const runner = new Runner({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    await drive(runner.run({ userMessage: "what is 2 + 2?" }), (event) => {
      if (event.type === "tool_result") {
        runner.sendSteering("hurry up");
      }
    });
    const secondRequest = provider.requests[1];
    expect(secondRequest?.messages.at(-1)).toEqual({
      role: "user",
      content: "hurry up",
    });
  });

  it("emits steering_injected right before the next round's llm_request", async () => {
    const provider = new ScriptedProvider(twoRoundScript());
    const runner = new Runner({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    const events = await drive(
      runner.run({ userMessage: "what is 2 + 2?" }),
      (event) => {
        if (event.type === "tool_result") {
          runner.sendSteering("hurry up");
        }
      },
    );
    const steeringIndex = events.findIndex(
      (event) => event.type === "steering_injected",
    );
    const nextRequestIndex = events.findIndex(
      (event, index) => index > steeringIndex && event.type === "llm_request",
    );
    expect(steeringIndex).toBeGreaterThan(-1);
    expect(events[steeringIndex]).toEqual({
      type: "steering_injected",
      text: "hurry up",
    });
    expect(nextRequestIndex).toBe(steeringIndex + 1);
  });

  it("injects several queued lines in call order", async () => {
    const provider = new ScriptedProvider(twoRoundScript());
    const runner = new Runner({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    await drive(runner.run({ userMessage: "what is 2 + 2?" }), (event) => {
      if (event.type === "tool_result") {
        runner.sendSteering("first");
        runner.sendSteering("second");
      }
    });
    const secondRequest = provider.requests[1];
    const userMessages = secondRequest?.messages.filter(
      (message) => message.role === "user",
    );
    expect(userMessages?.slice(-2)).toEqual([
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ]);
  });

  it("throws NoActiveRunError before any run has started", () => {
    const runner = new Runner({ provider: new ScriptedProvider([]) });
    expect(() => runner.sendSteering("too early")).toThrow(NoActiveRunError);
  });

  it("throws NoActiveRunError once a run has completed", async () => {
    const provider = new ScriptedProvider([{ text: "hi" }]);
    const runner = new Runner({ provider });
    await drive(runner.run({ userMessage: "hi" }), () => {});
    expect(() => runner.sendSteering("too late")).toThrow(NoActiveRunError);
  });

  it("never emits steering_injected and matches the unsteered baseline when unused", async () => {
    const provider = new ScriptedProvider(twoRoundScript());
    const runner = new Runner({
      provider,
      toolsets: [new CalculatorToolset()],
    });
    const events = await drive(
      runner.run({ userMessage: "what is 2 + 2?" }),
      () => {},
    );
    expect(events.some((event) => event.type === "steering_injected")).toBe(
      false,
    );
    expect(events.at(-1)).toEqual({ type: "final_text", text: "4" });
  });
});
