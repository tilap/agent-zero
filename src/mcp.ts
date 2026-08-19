import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  McpConfigError,
  McpConnectionError,
  McpProtocolError,
} from "./errors.js";
import { BaseToolset } from "./toolset.js";
import type { ToolSchema } from "./toolset.js";
import type { ToolCall, ToolResult } from "./types.js";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "agent-zero", version: "0.1.0" };

interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
}

interface JsonRpcMessage {
  readonly jsonrpc?: "2.0";
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: JsonRpcErrorPayload;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

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

  static async connectStdio(
    options: StdioMcpServerOptions,
  ): Promise<McpToolset> {
    const env =
      options.env === undefined ? undefined : substituteEnv(options.env);
    let session: StdioMcpSession;
    try {
      session = await StdioMcpSession.connect({
        command: options.command,
        ...(options.args === undefined ? {} : { args: options.args }),
        ...(env === undefined ? {} : { env }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new McpConnectionError(
        `Failed to connect to MCP server "${options.name}": ${message}`,
      );
    }
    return new McpToolset(session, {
      name: options.name,
      ...(options.only === undefined ? {} : { only: options.only }),
    });
  }
}

export interface StdioMcpServerOptions {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly only?: readonly string[];
}

class StdioMcpSession implements McpSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.once("exit", () =>
      this.onClosed(new McpConnectionError("MCP server process exited.")),
    );
  }

  static async connect(options: {
    readonly command: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  }): Promise<StdioMcpSession> {
    const child = await new Promise<ChildProcessWithoutNullStreams>(
      (resolveSpawn, reject) => {
        const proc = spawn(options.command, [...(options.args ?? [])], {
          env:
            options.env === undefined
              ? process.env
              : { ...process.env, ...options.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        proc.once("error", reject);
        proc.once("spawn", () => resolveSpawn(proc));
      },
    );

    const session = new StdioMcpSession(child);
    try {
      await session.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      session.notify("notifications/initialized", {});
    } catch (error) {
      child.kill();
      throw error;
    }
    return session;
  }

  async listTools(): Promise<readonly McpToolDescriptor[]> {
    const result = (await this.request("tools/list", {})) as
      | { readonly tools?: readonly McpToolDescriptor[] }
      | undefined;
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<McpToolResult> {
    return (await this.request("tools/call", {
      name,
      arguments: args,
    })) as McpToolResult;
  }

  async close(): Promise<void> {
    this.onClosed(new McpConnectionError("MCP session closed."));
    this.child.kill();
  }

  private onClosed(reason: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
  }

  private request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new McpConnectionError("MCP session is closed."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: unknown): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim() !== "") {
        this.onMessage(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private onMessage(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new McpProtocolError(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }
}

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function substituteEnv(
  record: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = value.replace(ENV_VAR_PATTERN, (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        throw new McpConfigError(
          `Missing environment variable "${name}" referenced by "${key}".`,
        );
      }
      return resolved;
    });
  }
  return result;
}
