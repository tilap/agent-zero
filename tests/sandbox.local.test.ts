import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SandboxExecError,
  SandboxIoError,
  SandboxNotReadyError,
  SandboxPathEscapeError,
  SandboxTimeoutError,
} from "../src/modules/sandbox/errors.js";
import { LocalDirRunner } from "../src/modules/sandbox/index.js";

describe("LocalDirRunner", () => {
  it("creates and removes an ephemeral root", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const result = await runner.exec("echo hi");
    expect(result).toEqual({ stdout: "hi\n", stderr: "", exitCode: 0 });
    await runner.aclose();
  });

  it("leaves an explicit root directory in place after aclose", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-test-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      await runner.aclose();
      expect(existsSync(rootDir)).toBe(true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("round-trips a write then a read, and the file exists on disk", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-test-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      await runner.write("notes.txt", "hi");
      expect(await runner.read("notes.txt")).toBe("hi");
      expect(await readFile(join(rootDir, "notes.txt"), "utf8")).toBe("hi");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("creates parent directories for a nested write", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-test-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      await runner.write("nested/dir/file.txt", "x");
      expect(await runner.read("nested/dir/file.txt")).toBe("x");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects reading a missing file with SandboxIoError", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    await expect(runner.read("nope.txt")).rejects.toThrow(SandboxIoError);
    await runner.aclose();
  });

  it("rejects a path that escapes the root, without touching the filesystem", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-test-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      await expect(runner.write("../evil.txt", "x")).rejects.toThrow(
        SandboxPathEscapeError,
      );
      expect(existsSync(join(rootDir, "..", "evil.txt"))).toBe(false);

      const absoluteTarget = join(tmpdir(), "agent-zero-sandbox-absolute.txt");
      await expect(runner.write(absoluteTarget, "x")).rejects.toThrow(
        SandboxPathEscapeError,
      );
      expect(existsSync(absoluteTarget)).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects a cwd that escapes the root for exec", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-zero-sandbox-test-"));
    try {
      const runner = new LocalDirRunner({ rootDir });
      await runner.setup();
      await expect(runner.exec("pwd", { cwd: "../" })).rejects.toThrow(
        SandboxPathEscapeError,
      );
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("resolves with a nonzero exit code rather than throwing", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const result = await runner.exec("exit 3");
    expect(result.exitCode).toBe(3);
    await runner.aclose();
  });

  it("rejects a command that exceeds its timeout", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    await expect(runner.exec("sleep 2", { timeoutMs: 50 })).rejects.toThrow(
      SandboxTimeoutError,
    );
    await runner.aclose();
  });

  it("stops the child process when the signal aborts", async () => {
    const runner = new LocalDirRunner();
    await runner.setup();
    const controller = new AbortController();
    const pending = runner.exec("sleep 2", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(SandboxExecError);
    await runner.aclose();
  });

  it("rejects exec/read/write before setup() with SandboxNotReadyError", async () => {
    const runner = new LocalDirRunner();
    await expect(runner.exec("echo hi")).rejects.toThrow(SandboxNotReadyError);
    await expect(runner.read("x")).rejects.toThrow(SandboxNotReadyError);
    await expect(runner.write("x", "y")).rejects.toThrow(SandboxNotReadyError);
  });

  it("tolerates aclose() without a prior setup(), as a no-op", async () => {
    const runner = new LocalDirRunner();
    await expect(runner.aclose()).resolves.toBeUndefined();
  });
});
