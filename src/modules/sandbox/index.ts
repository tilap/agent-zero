import { exec as execCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { BaseToolset } from "../../toolset.js";
import type { ToolContext, ToolSchema } from "../../toolset.js";
import type { ToolCall, ToolResult } from "../../types.js";
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
