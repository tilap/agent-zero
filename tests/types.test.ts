import { describe, expect, it } from "vitest";
import { InvalidTranscriptError } from "../src/errors.js";
import { validateMessages } from "../src/types.js";

describe("validateMessages", () => {
  it("rejects an empty transcript", () => {
    expect(() => validateMessages([])).toThrow(InvalidTranscriptError);
  });

  it("accepts a system message at index 0", () => {
    expect(() =>
      validateMessages([
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ]),
    ).not.toThrow();
  });

  it("rejects a system message at index 1", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "hi" },
        { role: "system", content: "be terse" },
      ]),
    ).toThrow(InvalidTranscriptError);
  });

  it("rejects two system messages", () => {
    expect(() =>
      validateMessages([
        { role: "system", content: "be terse" },
        { role: "system", content: "also be nice" },
        { role: "user", content: "hi" },
      ]),
    ).toThrow(InvalidTranscriptError);
  });
});
