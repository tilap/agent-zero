import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../src/provider.js";
import { ScriptedProvider } from "../src/provider.js";
import { WorkspaceProbeToolset } from "./support/workspace-probe.js";

describe("Agent workspace lifecycle", () => {
  it("exists during tool execution", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "1", name: "probe", arguments: {} }],
      },
      { text: "done" },
    ]);
    const probe = new WorkspaceProbeToolset();
    const agent = new Agent({ provider, toolsets: [probe] });
    await agent.runSync("go");
    expect(probe.observedExistence[0]).toBe(true);
    expect(typeof probe.observedWorkspaces[0]).toBe("string");
  });

  it("is removed after a completed run", async () => {
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "probe", arguments: {} }] },
      { text: "done" },
    ]);
    const probe = new WorkspaceProbeToolset();
    const agent = new Agent({ provider, toolsets: [probe] });
    await agent.runSync("go");
    const path = probe.observedWorkspaces[0];
    expect(path).toBeDefined();
    expect(existsSync(path as string)).toBe(false);
  });

  it("is removed after a cancelled run", async () => {
    const controller = new AbortController();
    const probe = new WorkspaceProbeToolset(controller);
    const provider = new ScriptedProvider([
      { text: "", toolCalls: [{ id: "1", name: "probe", arguments: {} }] },
      { text: "unreachable" },
    ]);
    const agent = new Agent({ provider, toolsets: [probe] });
    const result = await agent.runSync("go", { signal: controller.signal });
    expect(result.stopReason).toBe("cancelled");
    const path = probe.observedWorkspaces[0];
    expect(path).toBeDefined();
    expect(existsSync(path as string)).toBe(false);
  });

  it("is removed after an errored run", async () => {
    const probe = new WorkspaceProbeToolset();
    let calls = 0;
    const provider: LlmProvider = {
      async chat(request: LlmRequest): Promise<LlmResponse> {
        calls += 1;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "1", name: "probe", arguments: {} }],
          };
        }
        void request;
        throw new Error("boom");
      },
    };
    const agent = new Agent({ provider, toolsets: [probe] });
    const result = await agent.runSync("go");
    expect(result.stopReason).toBe("error");
    const path = probe.observedWorkspaces[0];
    expect(path).toBeDefined();
    expect(existsSync(path as string)).toBe(false);
  });

  it("keeps an explicitly-pathed workspace after the run", async () => {
    const explicitPath = mkdtempSync(join(tmpdir(), "agent-zero-explicit-"));
    try {
      const provider = new ScriptedProvider([{ text: "done" }]);
      const agent = new Agent({
        provider,
        workspace: { path: explicitPath },
      });
      await agent.runSync("go");
      expect(existsSync(explicitPath)).toBe(true);
    } finally {
      rmSync(explicitPath, { recursive: true, force: true });
    }
  });
});
