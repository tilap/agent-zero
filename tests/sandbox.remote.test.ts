import { describe, expect, it } from "vitest";
import {
  SandboxIoError,
  SandboxNotReadyError,
  SandboxTimeoutError,
} from "../src/modules/sandbox/errors.js";
import { RemoteSandboxRunner } from "../src/modules/sandbox/index.js";
import { startSandboxHttpFixture } from "./support/sandbox-http-fixture.js";

describe("RemoteSandboxRunner", () => {
  it("execs against the fixture and returns the configured result", async () => {
    const fixture = await startSandboxHttpFixture({
      execResults: { "echo hi": { stdout: "hi\n", stderr: "", exitCode: 0 } },
    });
    try {
      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await runner.setup();
      const result = await runner.exec("echo hi");
      expect(result).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
      await runner.aclose();
    } finally {
      await fixture.close();
    }
  });

  it("rejects with SandboxTimeoutError when the fixture reports timedOut", async () => {
    const fixture = await startSandboxHttpFixture({
      execResults: { "sleep 10": { timedOut: true } },
    });
    try {
      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await runner.setup();
      await expect(runner.exec("sleep 10")).rejects.toThrow(
        SandboxTimeoutError,
      );
    } finally {
      await fixture.close();
    }
  });

  it("round-trips a write then a read against the fixture's file map", async () => {
    const fixture = await startSandboxHttpFixture();
    try {
      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await runner.setup();
      await runner.write("notes.txt", "hi");
      expect(await runner.read("notes.txt")).toBe("hi");
    } finally {
      await fixture.close();
    }
  });

  it("rejects reading a path the fixture does not have", async () => {
    const fixture = await startSandboxHttpFixture();
    try {
      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await runner.setup();
      await expect(runner.read("nope.txt")).rejects.toThrow(SandboxIoError);
    } finally {
      await fixture.close();
    }
  });

  it("sends configured headers on every request", async () => {
    const fixture = await startSandboxHttpFixture();
    try {
      const runner = new RemoteSandboxRunner({
        baseUrl: fixture.url,
        headers: { authorization: "Bearer secret" },
      });
      await runner.setup();
      await runner.write("a.txt", "x");
      expect(fixture.requests.length).toBeGreaterThan(0);
      for (const request of fixture.requests) {
        expect(request.headers.authorization).toBe("Bearer secret");
      }
    } finally {
      await fixture.close();
    }
  });

  it("aclose() is a no-op without a prior setup(), and sends DELETE otherwise", async () => {
    const fixture = await startSandboxHttpFixture();
    try {
      const runnerNeverSetup = new RemoteSandboxRunner({
        baseUrl: fixture.url,
      });
      await expect(runnerNeverSetup.aclose()).resolves.toBeUndefined();
      expect(fixture.requests).toHaveLength(0);

      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await runner.setup();
      await runner.aclose();
      expect(
        fixture.requests.some((request) => request.method === "DELETE"),
      ).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("rejects exec/read/write before setup() with SandboxNotReadyError", async () => {
    const fixture = await startSandboxHttpFixture();
    try {
      const runner = new RemoteSandboxRunner({ baseUrl: fixture.url });
      await expect(runner.exec("echo hi")).rejects.toThrow(
        SandboxNotReadyError,
      );
      await expect(runner.read("x")).rejects.toThrow(SandboxNotReadyError);
      await expect(runner.write("x", "y")).rejects.toThrow(
        SandboxNotReadyError,
      );
      expect(fixture.requests).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });
});
