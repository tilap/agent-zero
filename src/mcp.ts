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

// Shared by any session with a persistent channel (stdio, SSE): requests
// go out over that channel and responses arrive independently, matched
// by id. HTTP has no need for this — one POST is one response.
class PendingRequestTable {
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  add(id: number, entry: PendingRequest): void {
    this.pending.set(id, entry);
  }

  resolve(id: number, result: unknown): void {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(id);
    entry.resolve(result);
  }

  reject(id: number, error: Error): void {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(id);
    entry.reject(error);
  }

  closeAll(reason: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.reject(reason);
    }
    this.pending.clear();
  }
}

function dispatchJsonRpcMessage(
  raw: string,
  pending: PendingRequestTable,
): void {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (message.id === undefined) {
    return;
  }
  if (message.error !== undefined) {
    pending.reject(message.id, new McpProtocolError(message.error.message));
  } else {
    pending.resolve(message.id, message.result);
  }
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

  static async connectSse(options: SseMcpServerOptions): Promise<McpToolset> {
    const headers =
      options.headers === undefined
        ? undefined
        : substituteEnv(options.headers);
    let session: SseMcpSession;
    try {
      session = await SseMcpSession.connect({
        url: options.url,
        ...(headers === undefined ? {} : { headers }),
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

  static async connectHttp(options: HttpMcpServerOptions): Promise<McpToolset> {
    const headers =
      options.headers === undefined
        ? undefined
        : substituteEnv(options.headers);
    let session: HttpMcpSession;
    try {
      session = await HttpMcpSession.connect({
        url: options.url,
        ...(headers === undefined ? {} : { headers }),
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

export interface HttpMcpServerOptions {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly only?: readonly string[];
}

export interface SseMcpServerOptions {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly only?: readonly string[];
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
  private readonly pending = new PendingRequestTable();
  private nextId = 1;
  private buffer = "";

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.once("exit", () =>
      this.pending.closeAll(
        new McpConnectionError("MCP server process exited."),
      ),
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
    this.pending.closeAll(new McpConnectionError("MCP session closed."));
    this.child.kill();
  }

  private request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (this.pending.isClosed) {
      return Promise.reject(new McpConnectionError("MCP session is closed."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.add(id, { resolve, reject });
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
    dispatchJsonRpcMessage(line, this.pending);
  }
}

class SseMcpSession implements McpSession {
  private readonly pending = new PendingRequestTable();
  private readonly headers: Readonly<Record<string, string>>;
  private readonly streamUrl: string;
  private readonly abortController = new AbortController();
  private nextId = 1;
  private postUrl: string | undefined;

  private constructor(
    streamUrl: string,
    headers: Readonly<Record<string, string>>,
  ) {
    this.streamUrl = streamUrl;
    this.headers = headers;
  }

  static async connect(options: {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
  }): Promise<SseMcpSession> {
    const session = new SseMcpSession(options.url, options.headers ?? {});
    await session.openStream();
    await session.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    session.notify("notifications/initialized", {});
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
    this.pending.closeAll(new McpConnectionError("MCP session closed."));
    this.abortController.abort();
  }

  private async openStream(): Promise<void> {
    const response = await fetch(this.streamUrl, {
      headers: { accept: "text/event-stream", ...this.headers },
      signal: this.abortController.signal,
    });
    if (!response.ok || response.body === null) {
      throw new McpConnectionError(
        `SSE stream returned HTTP ${response.status} from ${this.streamUrl}.`,
      );
    }

    const endpoint = await new Promise<string>((resolve, reject) => {
      this.pump(response.body as ReadableStream<Uint8Array>, resolve, reject);
    });
    this.postUrl = new URL(endpoint, this.streamUrl).toString();
  }

  private async pump(
    body: ReadableStream<Uint8Array>,
    resolveEndpoint: (url: string) => void,
    rejectEndpoint: (error: Error) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let endpointSettled = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const parsed = parseSseEvent(rawEvent);
          if (parsed.event === "endpoint" && !endpointSettled) {
            endpointSettled = true;
            resolveEndpoint(parsed.data);
          } else if (parsed.event === "message") {
            dispatchJsonRpcMessage(parsed.data, this.pending);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (!endpointSettled) {
        rejectEndpoint(
          new McpConnectionError("SSE stream ended before an endpoint event."),
        );
      }
      this.pending.closeAll(new McpConnectionError("MCP SSE stream ended."));
    } catch (error) {
      const reason =
        error instanceof Error ? error : new McpConnectionError(String(error));
      if (!endpointSettled) {
        rejectEndpoint(reason);
      }
      this.pending.closeAll(reason);
    }
  }

  private request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (this.pending.isClosed) {
      return Promise.reject(new McpConnectionError("MCP session is closed."));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.add(id, { resolve, reject });
      this.post({ jsonrpc: "2.0", id, method, params }).catch(
        (error: unknown) => {
          this.pending.reject(
            id,
            error instanceof Error
              ? error
              : new McpConnectionError(String(error)),
          );
        },
      );
    });
  }

  private notify(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): void {
    this.post({ jsonrpc: "2.0", method, params }).catch(() => {
      // A dropped notification has no caller to report back to.
    });
  }

  private async post(message: unknown): Promise<void> {
    if (this.postUrl === undefined) {
      throw new McpConnectionError("SSE endpoint is not ready.");
    }
    const response = await fetch(this.postUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new McpConnectionError(
        `SSE POST returned HTTP ${response.status}.`,
      );
    }
  }
}

interface SseEvent {
  readonly event: string;
  readonly data: string;
}

function parseSseEvent(raw: string): SseEvent {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  return { event, data: dataLines.join("\n") };
}

const SESSION_ID_HEADER = "mcp-session-id";

class HttpMcpSession implements McpSession {
  private readonly url: string;
  private readonly headers: Readonly<Record<string, string>>;
  private nextId = 1;
  private sessionId: string | undefined;

  private constructor(url: string, headers: Readonly<Record<string, string>>) {
    this.url = url;
    this.headers = headers;
  }

  static async connect(options: {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
  }): Promise<HttpMcpSession> {
    const session = new HttpMcpSession(options.url, options.headers ?? {});
    await session.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    await session.notify("notifications/initialized", {});
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
    this.sessionId = undefined;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json",
      ...this.headers,
      ...(this.sessionId === undefined
        ? {}
        : { [SESSION_ID_HEADER]: this.sessionId }),
    };
  }

  private async request(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const id = this.nextId++;
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const sessionId = response.headers.get(SESSION_ID_HEADER);
    if (sessionId !== null) {
      this.sessionId = sessionId;
    }
    if (!response.ok) {
      throw new McpConnectionError(`HTTP ${response.status} from MCP server.`);
    }
    const message = (await response.json()) as JsonRpcMessage;
    if (message.error !== undefined) {
      throw new McpProtocolError(message.error.message);
    }
    return message.result;
  }

  private async notify(
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
    if (!response.ok) {
      throw new McpConnectionError(`HTTP ${response.status} from MCP server.`);
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
