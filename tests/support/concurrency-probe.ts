import { BaseToolset } from "../../src/toolset.js";
import type { ToolSchema } from "../../src/toolset.js";
import type { ToolCall, ToolResult } from "../../src/types.js";

export interface ProbeEvent {
  readonly callId: string;
  readonly phase: "start" | "end";
}

/**
 * A toolset that rendezvous every call before letting any of them
 * resolve: `execute` records a "start" entry, then blocks until
 * `releaseAt` calls are simultaneously in flight, then resolves all of
 * them. Run with fewer concurrently-dispatched calls than `releaseAt`,
 * it hangs — that hang is the proof that calls were not dispatched
 * concurrently, not a timing assertion.
 */
export class ConcurrencyProbeToolset extends BaseToolset {
  readonly events: ProbeEvent[] = [];
  maxInFlight = 0;

  private readonly releaseAt: number;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(releaseAt: number) {
    super();
    this.releaseAt = releaseAt;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "wait",
        description: "Rendezvous with sibling calls before resolving.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    this.events.push({ callId: call.id, phase: "start" });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      if (this.waiting.length >= this.releaseAt) {
        for (const release of this.waiting) {
          release();
        }
      }
    });

    this.inFlight -= 1;
    this.events.push({ callId: call.id, phase: "end" });
    return { callId: call.id, content: `done:${call.id}` };
  }
}

/**
 * A toolset where each call resolves after its own configured delay
 * (default 0ms). Useful to make calls settle in a chosen order that is
 * independent of dispatch order or microtask interleaving, unlike
 * `ConcurrencyProbeToolset`.
 */
export class DelayedToolset extends BaseToolset {
  readonly events: ProbeEvent[] = [];
  private readonly delaysMs: ReadonlyMap<string, number>;

  constructor(delaysMs: ReadonlyMap<string, number>) {
    super();
    this.delaysMs = delaysMs;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "wait",
        description: "Resolves after a configured per-call delay.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    this.events.push({ callId: call.id, phase: "start" });
    const delayMs = this.delaysMs.get(call.id) ?? 0;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    this.events.push({ callId: call.id, phase: "end" });
    return { callId: call.id, content: `done:${call.id}` };
  }
}
