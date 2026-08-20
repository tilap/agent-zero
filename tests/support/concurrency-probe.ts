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
  private readonly releaseOrder: "call-order" | "reverse-order";
  private inFlight = 0;
  private readonly waiting: Array<{ callId: string; resolve: () => void }> =
    [];

  constructor(
    releaseAt: number,
    releaseOrder: "call-order" | "reverse-order" = "call-order",
  ) {
    super();
    this.releaseAt = releaseAt;
    this.releaseOrder = releaseOrder;
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
      this.waiting.push({ callId: call.id, resolve });
      if (this.waiting.length >= this.releaseAt) {
        const ordered =
          this.releaseOrder === "call-order"
            ? this.waiting
            : [...this.waiting].reverse();
        for (const entry of ordered) {
          entry.resolve();
        }
      }
    });

    this.inFlight -= 1;
    this.events.push({ callId: call.id, phase: "end" });
    return { callId: call.id, content: `done:${call.id}` };
  }
}
