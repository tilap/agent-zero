import { BaseToolset } from "./toolset.js";
import type { ToolSchema } from "./toolset.js";
import type { ToolCall, ToolResult } from "./types.js";

export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface McpToolResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
}

export interface McpSession {
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface McpToolsetOptions {
  readonly name: string;
  readonly only?: readonly string[];
}

export class McpToolset extends BaseToolset {
  private readonly session: McpSession;
  private readonly prefix: string;
  private readonly only: ReadonlySet<string> | undefined;

  constructor(session: McpSession, options: McpToolsetOptions) {
    super();
    this.session = session;
    this.prefix = `${options.name}__`;
    this.only = options.only === undefined ? undefined : new Set(options.only);
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    const tools = await this.session.listTools();
    return tools
      .filter((tool) => this.only === undefined || this.only.has(tool.name))
      .map((tool) => ({
        name: `${this.prefix}${tool.name}`,
        description: tool.description ?? "",
        parameters: tool.inputSchema,
      }));
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const remoteName = call.name.startsWith(this.prefix)
      ? call.name.slice(this.prefix.length)
      : call.name;
    const result = await this.session.callTool(remoteName, call.arguments);
    const content = result.content.map((item) => item.text).join("\n");
    return {
      callId: call.id,
      content,
      ...(result.isError === undefined ? {} : { isError: result.isError }),
    };
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
