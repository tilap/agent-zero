import type { LlmRequest, LlmResponse } from "./provider.js";
import type { ToolCall, ToolResult } from "./types.js";

export interface BeforeModelContext {
  readonly request: LlmRequest;
}

export interface AfterModelContext {
  readonly request: LlmRequest;
  readonly response: LlmResponse;
}

export interface BeforeToolContext {
  readonly call: ToolCall;
}

export interface AfterToolContext {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

export type BeforeModelHook = (
  context: BeforeModelContext,
) => LlmResponse | undefined | Promise<LlmResponse | undefined>;

export type AfterModelHook = (
  context: AfterModelContext,
) => LlmResponse | undefined | Promise<LlmResponse | undefined>;

export type BeforeToolHook = (
  context: BeforeToolContext,
) => ToolResult | undefined | Promise<ToolResult | undefined>;

export type AfterToolHook = (
  context: AfterToolContext,
) => ToolResult | undefined | Promise<ToolResult | undefined>;

export interface Hooks {
  readonly beforeModel?: BeforeModelHook;
  readonly afterModel?: AfterModelHook;
  readonly beforeTool?: BeforeToolHook;
  readonly afterTool?: AfterToolHook;
}
