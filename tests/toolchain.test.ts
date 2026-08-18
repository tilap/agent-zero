import { access, constants } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(command: string, args: string[]) {
  return spawnSync(command, args, { encoding: "utf8" });
}

describe("toolchain", () => {
  it("rejects badly formatted code", () => {
    const result = run("pnpm", [
      "exec",
      "biome",
      "check",
      "tests/fixtures/toolchain/bad-format.ts",
    ]);
    expect(result.status).not.toBe(0);
  });

  it("rejects a real type error", () => {
    const result = run("pnpm", [
      "exec",
      "tsc",
      "--noEmit",
      "-p",
      "tests/fixtures/toolchain/tsconfig.json",
    ]);
    expect(result.status).not.toBe(0);
  });

  it("accepts the repository as clean", () => {
    const result = run("pnpm", ["exec", "biome", "check", "."]);
    expect(result.status).toBe(0);
  });

  it("wires pre-commit and pre-push as executable hooks", async () => {
    await expect(
      access(".githooks/pre-commit", constants.X_OK),
    ).resolves.toBeUndefined();
    await expect(
      access(".githooks/pre-push", constants.X_OK),
    ).resolves.toBeUndefined();
  });
});
