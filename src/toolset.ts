import { DuplicateToolNameError } from "./errors.js";
import type { ToolCall, ToolResult } from "./types.js";

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolContext {
  readonly signal?: AbortSignal;
}

export abstract class BaseToolset {
  abstract listTools(): Promise<readonly ToolSchema[]>;
  abstract execute(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}

export class ToolsetRouter {
  private readonly toolsets: readonly BaseToolset[];

  constructor(toolsets: readonly BaseToolset[]) {
    this.toolsets = toolsets;
  }

  async listTools(): Promise<readonly ToolSchema[]> {
    const owners = new Map<string, BaseToolset>();
    const merged: ToolSchema[] = [];

    for (const toolset of this.toolsets) {
      const schemas = await toolset.listTools();
      for (const schema of schemas) {
        const owner = owners.get(schema.name);
        if (owner !== undefined) {
          throw new DuplicateToolNameError(
            `Duplicate tool name: "${schema.name}".`,
          );
        }
        owners.set(schema.name, toolset);
        merged.push(schema);
      }
    }

    return merged;
  }

  async execute(
    call: ToolCall,
    context: ToolContext = {},
  ): Promise<ToolResult> {
    const owner = await this.findOwner(call.name);
    if (owner === undefined) {
      const names = (await this.listTools()).map((tool) => tool.name);
      return {
        callId: call.id,
        content: `Unknown tool: ${call.name}. Available: ${names.join(", ")}`,
        isError: true,
      };
    }

    try {
      return await owner.execute(call, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: call.id, content: message, isError: true };
    }
  }

  private async findOwner(name: string): Promise<BaseToolset | undefined> {
    for (const toolset of this.toolsets) {
      const schemas = await toolset.listTools();
      if (schemas.some((schema) => schema.name === name)) {
        return toolset;
      }
    }
    return undefined;
  }
}
