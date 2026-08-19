import type {
  McpSession,
  McpToolDescriptor,
  McpToolResult,
} from "../../src/modules/mcp/index.js";

export interface FakeCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export class FakeMcpSession implements McpSession {
  readonly calls: FakeCall[] = [];
  closed = false;

  constructor(
    private readonly tools: readonly McpToolDescriptor[],
    private readonly results: Readonly<
      Record<string, McpToolResult | (() => McpToolResult)>
    > = {},
  ) {}

  async listTools(): Promise<readonly McpToolDescriptor[]> {
    return this.tools;
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<McpToolResult> {
    this.calls.push({ name, args });
    const configured = this.results[name];
    if (configured === undefined) {
      throw new Error(`FakeMcpSession has no configured result for "${name}".`);
    }
    return typeof configured === "function" ? configured() : configured;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
