import { describe, expect, it } from "vitest";
import { HostedProviderError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import type { LlmDelta, LlmResponse } from "../src/provider.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import type { Event } from "../src/types.js";
import {
  type FixtureResponse,
  startGeminiHttpFixture,
} from "./support/gemini-http-fixture.js";

async function collect(events: AsyncGenerator<Event, void, void>) {
  const collected: Event[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function jsonResponse(body: unknown, status = 200): FixtureResponse {
  return { type: "json", body, status };
}

function sseResponse(events: readonly string[]): FixtureResponse {
  return { type: "sse", events };
}

const textCandidate = (text: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] } }],
});

describe("GeminiProvider chat", () => {
  it("maps a text response", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse(textCandidate("hello")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(response).toEqual({ text: "hello" });
    } finally {
      await fixture.close();
    }
  });

  it("maps a functionCall response with a synthetic id and unparsed args", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ functionCall: { name: "add", args: { a: 1, b: 2 } } }],
            },
          },
        ],
      }),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const response = await provider.chat({
        messages: [{ role: "user", content: "add" }],
      });
      expect(response.text).toBe("");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0]).toMatchObject({
        name: "add",
        arguments: { a: 1, b: 2 },
      });
      expect(typeof response.toolCalls?.[0]?.id).toBe("string");
    } finally {
      await fixture.close();
    }
  });

  it("echoes a thinking model's thoughtSignature back unchanged on the next turn", async () => {
    // Caught against the real API (gemini-3.6-flash): a functionCall part
    // can carry a sibling `thoughtSignature` field. Resending the call
    // without it is rejected outright — "Function call is missing a
    // thought_signature". There is no field for this on the
    // vendor-agnostic ToolCall type, so GeminiProvider smuggles it inside
    // the synthetic id it already assigns (Gemini gives no id of its own)
    // and must round-trip it exactly, untouched, on the next request.
    const fixture = await startGeminiHttpFixture([
      jsonResponse({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "add", args: { a: 1, b: 2 } },
                  thoughtSignature: "sig-abc123",
                },
              ],
            },
          },
        ],
      }),
      jsonResponse(textCandidate("ok")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-3.6-flash",
        baseUrl: fixture.url,
      });
      const first = await provider.chat({
        messages: [{ role: "user", content: "add" }],
      });
      const call = first.toolCalls?.[0];
      if (call === undefined) {
        throw new Error("Expected a tool call in the first response.");
      }

      await provider.chat({
        messages: [
          { role: "user", content: "add" },
          {
            role: "assistant",
            content: "",
            toolCalls: [call],
          },
          { role: "tool", callId: call.id, content: "3" },
        ],
      });

      const secondRequest = fixture.requests[1]?.body as {
        contents: readonly { role: string; parts: readonly unknown[] }[];
      };
      const assistantTurn = secondRequest.contents[1];
      expect(assistantTurn?.parts).toEqual([
        {
          functionCall: { name: "add", args: { a: 1, b: 2 } },
          thoughtSignature: "sig-abc123",
        },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("keeps functionResponse parts in call order, correlated by name not id", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse(textCandidate("ok")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      await provider.chat({
        messages: [
          { role: "user", content: "add twice" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "add", arguments: { a: 1, b: 1 } },
              { id: "call-2", name: "add", arguments: { a: 2, b: 2 } },
            ],
          },
          // Results pushed in a different order than they settled — the
          // loop always appends in call order (Phase 11), so this is the
          // realistic shape: call-1's result, then call-2's.
          { role: "tool", callId: "call-1", content: "2" },
          { role: "tool", callId: "call-2", content: "4" },
        ],
      });
      const body = fixture.requests[0]?.body as {
        contents: readonly { role: string; parts: readonly unknown[] }[];
      };
      const toolTurn = body.contents.at(-1);
      expect(toolTurn?.role).toBe("user");
      expect(toolTurn?.parts).toEqual([
        { functionResponse: { name: "add", response: { content: "2" } } },
        { functionResponse: { name: "add", response: { content: "4" } } },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("maps the full transcript: system to systemInstruction, roles, grouped tool results", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse(textCandidate("ok")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      await provider.chat({
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "add 1 and 2" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "add", arguments: { a: 1, b: 2 } },
            ],
          },
          { role: "tool", callId: "call-1", content: "3" },
        ],
      });
      const body = fixture.requests[0]?.body as {
        systemInstruction: unknown;
        contents: readonly unknown[];
      };
      expect(body.systemInstruction).toEqual({ parts: [{ text: "be terse" }] });
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "add 1 and 2" }] },
        {
          role: "model",
          parts: [{ functionCall: { name: "add", args: { a: 1, b: 2 } } }],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "add", response: { content: "3" } } },
          ],
        },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("maps request.tools into one functionDeclarations entry, omitted when absent", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse(textCandidate("ok")),
      jsonResponse(textCandidate("ok")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      await provider.chat({
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "add",
            description: "Add two numbers.",
            parameters: { type: "object", properties: {} },
          },
        ],
      });
      await provider.chat({ messages: [{ role: "user", content: "hi" }] });

      const withTools = fixture.requests[0]?.body as { tools?: unknown };
      const withoutTools = fixture.requests[1]?.body as { tools?: unknown };
      expect(withTools.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "add",
              description: "Add two numbers.",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      ]);
      expect("tools" in withoutTools).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("throws immediately on a non-retryable status", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse({ error: { message: "invalid api key" } }, 400),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-bad",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      await expect(
        provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(HostedProviderError);
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("retries a 500 once, then succeeds", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse(textCandidate("recovered")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
        retryDelayMs: 1,
      });
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(response.text).toBe("recovered");
      expect(fixture.requests).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("throws after exhausting the retry budget", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse({ error: { message: "boom" } }, 500),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
        maxRetries: 2,
        retryDelayMs: 1,
      });
      await expect(
        provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(HostedProviderError);
      expect(fixture.requests).toHaveLength(3);
    } finally {
      await fixture.close();
    }
  });

  it("times out a request that never responds", async () => {
    const fixture = await startGeminiHttpFixture([
      { type: "hang", delayMs: 2_000 },
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
        timeoutMs: 50,
        maxRetries: 0,
      });
      await expect(
        provider.chat({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(HostedProviderError);
    } finally {
      await fixture.close();
    }
  });

  it("sends the api key and custom headers on every request", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse(textCandidate("ok")),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
        headers: { "x-org": "acme" },
      });
      await provider.chat({ messages: [{ role: "user", content: "hi" }] });
      expect(fixture.requests[0]?.headers["x-goog-api-key"]).toBe("ai-test");
      expect(fixture.requests[0]?.headers["x-org"]).toBe("acme");
    } finally {
      await fixture.close();
    }
  });
});

describe("GeminiProvider chatStream", () => {
  async function drainStream(
    stream: AsyncGenerator<LlmDelta, LlmResponse, void>,
  ) {
    const deltas: LlmDelta[] = [];
    let step = await stream.next();
    while (!step.done) {
      deltas.push(step.value);
      step = await stream.next();
    }
    return { deltas, response: step.value };
  }

  it("yields content deltas that concatenate to the full text", async () => {
    const fixture = await startGeminiHttpFixture([
      sseResponse([
        JSON.stringify({
          candidates: [
            { content: { role: "model", parts: [{ text: "Hello" }] } },
          ],
        }),
        JSON.stringify({
          candidates: [
            { content: { role: "model", parts: [{ text: " there" }] } },
          ],
        }),
      ]),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const { deltas, response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(deltas.map((delta) => delta.text).join("")).toBe("Hello there");
      expect(response).toEqual({ text: "Hello there" });
      expect(fixture.requests[0]?.path).toContain("alt=sse");
    } finally {
      await fixture.close();
    }
  });

  it("buffers a functionCall part arriving mid-stream, never as a delta", async () => {
    const fixture = await startGeminiHttpFixture([
      sseResponse([
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { functionCall: { name: "add", args: { a: 1, b: 2 } } },
                ],
              },
            },
          ],
        }),
      ]),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const { deltas, response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "add" }] }),
      );
      expect(deltas).toEqual([]);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0]).toMatchObject({
        name: "add",
        arguments: { a: 1, b: 2 },
      });
    } finally {
      await fixture.close();
    }
  });

  it("throws on a malformed data line", async () => {
    const fixture = await startGeminiHttpFixture([sseResponse(["not json"])]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      await expect(
        drainStream(
          provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
        ),
      ).rejects.toThrow(HostedProviderError);
    } finally {
      await fixture.close();
    }
  });

  it("resolves cleanly when the stream just ends, no terminal sentinel needed", async () => {
    const fixture = await startGeminiHttpFixture([
      sseResponse([
        JSON.stringify({
          candidates: [
            { content: { role: "model", parts: [{ text: "done" }] } },
          ],
        }),
      ]),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const { response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(response).toEqual({ text: "done" });
    } finally {
      await fixture.close();
    }
  });

  it("retries a connection failure before any SSE bytes are sent", async () => {
    const fixture = await startGeminiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      sseResponse([
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
      ]),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
        retryDelayMs: 1,
      });
      const { response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(response).toEqual({ text: "ok" });
      expect(fixture.requests).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("streams through a real AgentLoop round", async () => {
    const fixture = await startGeminiHttpFixture([
      sseResponse([
        JSON.stringify({
          candidates: [
            { content: { role: "model", parts: [{ text: "hi there" }] } },
          ],
        }),
      ]),
    ]);
    try {
      const provider = new GeminiProvider({
        apiKey: "ai-test",
        model: "gemini-2.5-flash",
        baseUrl: fixture.url,
      });
      const loop = new AgentLoop({ provider });
      const events = await collect(
        loop.run({ userMessage: "hi", stream: true }),
      );
      expect(events.some((event) => event.type === "llm_delta")).toBe(true);
      expect(events.at(-1)).toEqual({ type: "final_text", text: "hi there" });
    } finally {
      await fixture.close();
    }
  });
});
