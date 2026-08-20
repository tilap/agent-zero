import { exec as execCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { BaseToolset } from "../../toolset.js";
import type { ToolContext, ToolSchema } from "../../toolset.js";
import type { ToolCall, ToolResult } from "../../types.js";
import type { McpToolset } from "../mcp/index.js";
import {
  SandboxExecError,
  SandboxIoError,
  SandboxNotReadyError,
  SandboxPathEscapeError,
  SandboxTimeoutError,
} from "./errors.js";

export {
  SandboxExecError,
  SandboxIoError,
  SandboxNotReadyError,
  SandboxPathEscapeError,
  SandboxTimeoutError,
} from "./errors.js";

export interface SandboxExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface SandboxExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface SandboxRunner {
  setup(): Promise<void>;
  exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  aclose(): Promise<void>;
}

function resolveWithinRoot(root: string, input: string): string {
  if (isAbsolute(input)) {
    throw new SandboxPathEscapeError(
      `Path must be relative to the sandbox root: "${input}".`,
    );
  }
  const resolved = resolve(root, input);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new SandboxPathEscapeError(
      `Path escapes the sandbox root: "${input}".`,
    );
  }
  return resolved;
}

export interface LocalDirRunnerOptions {
  readonly rootDir?: string;
}

interface PreparedRoot {
  readonly path: string;
  readonly ephemeral: boolean;
}

export class LocalDirRunner implements SandboxRunner {
  private readonly rootDirOption: string | undefined;
  private prepared: PreparedRoot | undefined;

  constructor(options?: LocalDirRunnerOptions) {
    this.rootDirOption = options?.rootDir;
  }

  async setup(): Promise<void> {
    if (this.rootDirOption !== undefined) {
      await mkdir(this.rootDirOption, { recursive: true });
      this.prepared = { path: this.rootDirOption, ephemeral: false };
      return;
    }
    const path = await mkdtemp(join(tmpdir(), "agent-zero-sandbox-"));
    this.prepared = { path, ephemeral: true };
  }

  private requireRoot(): string {
    if (this.prepared === undefined) {
      throw new SandboxNotReadyError("Call setup() before using the sandbox.");
    }
    return this.prepared.path;
  }

  async exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const root = this.requireRoot();
    const cwd =
      options?.cwd !== undefined ? resolveWithinRoot(root, options.cwd) : root;

    return new Promise<SandboxExecResult>((resolvePromise, reject) => {
      execCallback(
        command,
        {
          cwd,
          encoding: "utf8",
          ...(options?.timeoutMs !== undefined
            ? { timeout: options.timeoutMs }
            : {}),
          ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise({ stdout, stderr, exitCode: 0 });
            return;
          }
          if (typeof error.code === "number") {
            resolvePromise({ stdout, stderr, exitCode: error.code });
            return;
          }
          if (error.killed === true && options?.timeoutMs !== undefined) {
            reject(
              new SandboxTimeoutError(
                `Command timed out after ${options.timeoutMs}ms: ${command}`,
              ),
            );
            return;
          }
          reject(new SandboxExecError(error.message));
        },
      );
    });
  }

  async read(path: string): Promise<string> {
    const root = this.requireRoot();
    const target = resolveWithinRoot(root, path);
    try {
      return await readFile(target, "utf8");
    } catch (error) {
      throw new SandboxIoError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async write(path: string, content: string): Promise<void> {
    const root = this.requireRoot();
    const target = resolveWithinRoot(root, path);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    } catch (error) {
      throw new SandboxIoError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async aclose(): Promise<void> {
    if (this.prepared === undefined) {
      return;
    }
    const { path, ephemeral } = this.prepared;
    this.prepared = undefined;
    if (ephemeral) {
      await rm(path, { recursive: true, force: true });
    }
  }
}

export class SandboxToolset extends BaseToolset {
  private readonly runner: SandboxRunner;

  constructor(runner: SandboxRunner) {
    super();
    this.runner = runner;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    return [
      {
        name: "exec",
        description:
          "Run a shell command in the sandbox and return its output.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
            timeoutMs: { type: "number" },
          },
          required: ["command"],
        },
      },
      {
        name: "read",
        description: "Read a file from the sandbox.",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      {
        name: "write",
        description:
          "Write a file in the sandbox, creating parent directories as needed.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    ];
  }

  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    if (call.name === "exec") {
      const command = String(call.arguments.command);
      const cwd =
        call.arguments.cwd === undefined
          ? undefined
          : String(call.arguments.cwd);
      const timeoutMs =
        call.arguments.timeoutMs === undefined
          ? undefined
          : Number(call.arguments.timeoutMs);
      const result = await this.runner.exec(command, {
        ...(cwd !== undefined ? { cwd } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
      });
      return {
        callId: call.id,
        content: `exit code: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        ...(result.exitCode !== 0 ? { isError: true } : {}),
      };
    }

    if (call.name === "read") {
      const path = String(call.arguments.path);
      const content = await this.runner.read(path);
      return { callId: call.id, content };
    }

    if (call.name === "write") {
      const path = String(call.arguments.path);
      const content = String(call.arguments.content);
      await this.runner.write(path, content);
      return { callId: call.id, content: "ok" };
    }

    return {
      callId: call.id,
      content: `Unknown tool: ${call.name}. Available: exec, read, write`,
      isError: true,
    };
  }
}

export interface RemoteSandboxRunnerOptions {
  readonly baseUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export class RemoteSandboxRunner implements SandboxRunner {
  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly fetchImpl: typeof fetch;
  private sessionId: string | undefined;

  constructor(options: RemoteSandboxRunnerOptions) {
    this.baseUrl = options.baseUrl.endsWith("/")
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  private requireSessionId(): string {
    if (this.sessionId === undefined) {
      throw new SandboxNotReadyError("Call setup() before using the sandbox.");
    }
    return this.sessionId;
  }

  async setup(): Promise<void> {
    const res = await this.fetchImpl(new URL("sessions", this.baseUrl), {
      method: "POST",
      headers: this.headers,
    });
    if (!res.ok) {
      throw new SandboxExecError(
        `Failed to create a sandbox session: ${res.status}`,
      );
    }
    const body = (await res.json()) as { readonly sessionId: string };
    this.sessionId = body.sessionId;
  }

  async exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const id = this.requireSessionId();
    const res = await this.fetchImpl(
      new URL(`sessions/${id}/exec`, this.baseUrl),
      {
        method: "POST",
        headers: { ...this.headers, "content-type": "application/json" },
        body: JSON.stringify({
          command,
          ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options?.timeoutMs !== undefined
            ? { timeoutMs: options.timeoutMs }
            : {}),
        }),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      },
    );
    if (!res.ok) {
      throw new SandboxExecError(`Sandbox exec request failed: ${res.status}`);
    }
    const body = (await res.json()) as
      | {
          readonly stdout: string;
          readonly stderr: string;
          readonly exitCode: number;
        }
      | { readonly timedOut: true };
    if ("timedOut" in body) {
      const suffix =
        options?.timeoutMs !== undefined ? ` after ${options.timeoutMs}ms` : "";
      throw new SandboxTimeoutError(`Command timed out${suffix}: ${command}`);
    }
    return body;
  }

  async read(path: string): Promise<string> {
    const id = this.requireSessionId();
    const url = new URL(`sessions/${id}/files`, this.baseUrl);
    url.searchParams.set("path", path);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: this.headers,
    });
    if (res.status === 404) {
      throw new SandboxIoError(`File not found: ${path}`);
    }
    if (!res.ok) {
      throw new SandboxIoError(`Sandbox read request failed: ${res.status}`);
    }
    return await res.text();
  }

  async write(path: string, content: string): Promise<void> {
    const id = this.requireSessionId();
    const url = new URL(`sessions/${id}/files`, this.baseUrl);
    url.searchParams.set("path", path);
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers: this.headers,
      body: content,
    });
    if (!res.ok) {
      throw new SandboxIoError(`Sandbox write request failed: ${res.status}`);
    }
  }

  async aclose(): Promise<void> {
    if (this.sessionId === undefined) {
      return;
    }
    const id = this.sessionId;
    this.sessionId = undefined;
    await this.fetchImpl(new URL(`sessions/${id}`, this.baseUrl), {
      method: "DELETE",
      headers: this.headers,
    });
  }
}

export interface McpSandboxRunnerToolNames {
  readonly exec?: string;
  readonly read?: string;
  readonly write?: string;
}

export interface McpSandboxRunnerOptions {
  readonly toolset: McpToolset;
  readonly toolNames?: McpSandboxRunnerToolNames;
}

interface ResolvedToolNames {
  readonly exec: string;
  readonly read: string;
  readonly write: string;
}

function parseExecResponse(content: string): SandboxExecResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SandboxExecError(
      `The MCP exec tool returned a non-JSON response: ${content}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { stdout?: unknown }).stdout !== "string" ||
    typeof (parsed as { stderr?: unknown }).stderr !== "string" ||
    typeof (parsed as { exitCode?: unknown }).exitCode !== "number"
  ) {
    throw new SandboxExecError(
      `The MCP exec tool returned an unexpected shape: ${content}`,
    );
  }
  return parsed as SandboxExecResult;
}

export class McpSandboxRunner implements SandboxRunner {
  private readonly toolset: McpToolset;
  private readonly toolNames: ResolvedToolNames;

  constructor(options: McpSandboxRunnerOptions) {
    this.toolset = options.toolset;
    this.toolNames = {
      exec: options.toolNames?.exec ?? "exec",
      read: options.toolNames?.read ?? "read",
      write: options.toolNames?.write ?? "write",
    };
  }

  async setup(): Promise<void> {
    // The toolset is already connected by the time it is passed in.
  }

  private async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    return this.toolset.execute(
      { id: "sandbox-mcp-call", name, arguments: args },
      signal === undefined ? {} : { signal },
    );
  }

  async exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const result = await this.callTool(
      this.toolNames.exec,
      {
        command,
        ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
      },
      options?.signal,
    );
    if (result.isError === true) {
      throw new SandboxExecError(result.content);
    }
    return parseExecResponse(result.content);
  }

  async read(path: string): Promise<string> {
    const result = await this.callTool(this.toolNames.read, { path });
    if (result.isError === true) {
      throw new SandboxIoError(result.content);
    }
    return result.content;
  }

  async write(path: string, content: string): Promise<void> {
    const result = await this.callTool(this.toolNames.write, {
      path,
      content,
    });
    if (result.isError === true) {
      throw new SandboxIoError(result.content);
    }
  }

  async aclose(): Promise<void> {
    await this.toolset.close();
  }
}
