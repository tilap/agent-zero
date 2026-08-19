import { describe, expect, it } from "vitest";
import { InvalidTranscriptError } from "../src/errors.js";
import { validateMessages } from "../src/types.js";

describe("validateMessages — tool-pair invariant", () => {
  it("accepts an assistant tool call immediately followed by its matching tool result", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "add", arguments: {} }],
        },
        { role: "tool", callId: "1", content: "5" },
      ]),
    ).not.toThrow();
  });

  it("rejects a tool result with no preceding open tool call", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "go" },
        { role: "tool", callId: "1", content: "5" },
      ]),
    ).toThrow(InvalidTranscriptError);
  });

  it("rejects a tool result whose callId does not match the open call", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "add", arguments: {} }],
        },
        { role: "tool", callId: "2", content: "5" },
      ]),
    ).toThrow(InvalidTranscriptError);
  });

  it("rejects a non-tool message while a tool call is still unresolved", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "1", name: "add", arguments: {} },
            { id: "2", name: "add", arguments: {} },
          ],
        },
        { role: "tool", callId: "1", content: "2" },
        { role: "user", content: "next" },
      ]),
    ).toThrow(InvalidTranscriptError);
  });

  it("rejects a transcript that ends with unresolved tool calls", () => {
    expect(() =>
      validateMessages([
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "add", arguments: {} }],
        },
      ]),
    ).toThrow(InvalidTranscriptError);
  });
});
