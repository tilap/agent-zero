import { describe, expect, it } from "vitest";
import { HostedProviderError } from "../src/errors.js";
import { AgentLoop } from "../src/loop.js";
import { OpenAiProvider } from "../src/providers/openai.js";
import type { Event } from "../src/types.js";
import {
  type FixtureResponse,
  startOpenAiHttpFixture,
} from "./support/openai-http-fixture.js";

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

const textChoice = (content: string) => ({
  choices: [{ message: { role: "assistant", content } }],
});

describe("OpenAiProvider chat", () => {
  it("maps a text response", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("hello")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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

  it("maps a tool_calls response with parsed arguments", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "add", arguments: '{"a":1,"b":2}' },
                },
              ],
            },
          },
        ],
      }),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      const response = await provider.chat({
        messages: [{ role: "user", content: "add" }],
      });
      expect(response).toEqual({
        text: "",
        toolCalls: [{ id: "call_1", name: "add", arguments: { a: 1, b: 2 } }],
      });
    } finally {
      await fixture.close();
    }
  });

  it("maps the full message transcript to the OpenAI wire shape", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("ok")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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
              { id: "call_1", name: "add", arguments: { a: 1, b: 2 } },
            ],
          },
          { role: "tool", callId: "call_1", content: "3" },
        ],
      });
      expect(fixture.requests[0]?.body).toEqual({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "add 1 and 2" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "add", arguments: '{"a":1,"b":2}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "3" },
        ],
      });
    } finally {
      await fixture.close();
    }
  });

  it("maps request.generationParams to temperature/max_tokens/top_p", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("ok")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      await provider.chat({
        messages: [{ role: "user", content: "hi" }],
        generationParams: { temperature: 0.2, maxTokens: 64, topP: 0.9 },
      });
      expect(fixture.requests[0]?.body).toMatchObject({
        temperature: 0.2,
        max_tokens: 64,
        top_p: 0.9,
      });
    } finally {
      await fixture.close();
    }
  });

  it("omits generation params from the body entirely when absent", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("ok")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      await provider.chat({ messages: [{ role: "user", content: "hi" }] });
      const body = fixture.requests[0]?.body as Record<string, unknown>;
      expect("temperature" in body).toBe(false);
      expect("max_tokens" in body).toBe(false);
      expect("top_p" in body).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it.each(["o1", "o1-mini", "o3", "o3-mini"])(
    'remaps the system message to role "developer" for reasoning model %s',
    async (model) => {
      const fixture = await startOpenAiHttpFixture([
        jsonResponse(textChoice("ok")),
      ]);
      try {
        const provider = new OpenAiProvider({
          apiKey: "sk-test",
          model,
          baseUrl: fixture.url,
        });
        await provider.chat({
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hi" },
          ],
        });
        expect(fixture.requests[0]?.body).toEqual({
          model,
          messages: [
            { role: "developer", content: "be terse" },
            { role: "user", content: "hi" },
          ],
        });
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(["gpt-4o", "gpt-4.1", "gpt-3.5-turbo"])(
    'keeps the system message as role "system" for mainstream model %s',
    async (model) => {
      const fixture = await startOpenAiHttpFixture([
        jsonResponse(textChoice("ok")),
      ]);
      try {
        const provider = new OpenAiProvider({
          apiKey: "sk-test",
          model,
          baseUrl: fixture.url,
        });
        await provider.chat({
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hi" },
          ],
        });
        expect(fixture.requests[0]?.body).toEqual({
          model,
          messages: [
            { role: "system", content: "be terse" },
            { role: "user", content: "hi" },
          ],
        });
      } finally {
        await fixture.close();
      }
    },
  );

  it("maps request.tools, omitting the field entirely when absent", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("ok")),
      jsonResponse(textChoice("ok")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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
          type: "function",
          function: {
            name: "add",
            description: "Add two numbers.",
            parameters: { type: "object", properties: {} },
          },
        },
      ]);
      expect("tools" in withoutTools).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("throws immediately on a non-retryable status", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse({ error: { message: "invalid api key" } }, 401),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-bad",
        model: "gpt-4o",
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
    const fixture = await startOpenAiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse(textChoice("recovered")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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
    const fixture = await startOpenAiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse({ error: { message: "boom" } }, 500),
      jsonResponse({ error: { message: "boom" } }, 500),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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

  it("waits for a Retry-After delta-seconds value before retrying", async () => {
    const fixture = await startOpenAiHttpFixture([
      {
        type: "json",
        status: 429,
        body: { error: { message: "rate limited" } },
        headers: { "retry-after": "1" },
      },
      jsonResponse(textChoice("recovered")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
        retryDelayMs: 1,
      });
      const start = Date.now();
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      const elapsedMs = Date.now() - start;
      expect(response.text).toBe("recovered");
      expect(elapsedMs).toBeGreaterThanOrEqual(950);
    } finally {
      await fixture.close();
    }
  });

  it("waits for a Retry-After HTTP-date value before retrying", async () => {
    // toUTCString() truncates to whole seconds, so a 2s horizon keeps the
    // asserted floor safely below the worst-case ~1s rounding loss.
    const retryAt = new Date(Date.now() + 2_000);
    const fixture = await startOpenAiHttpFixture([
      {
        type: "json",
        status: 429,
        body: { error: { message: "rate limited" } },
        headers: { "retry-after": retryAt.toUTCString() },
      },
      jsonResponse(textChoice("recovered")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
        retryDelayMs: 1,
      });
      const start = Date.now();
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      const elapsedMs = Date.now() - start;
      expect(response.text).toBe("recovered");
      expect(elapsedMs).toBeGreaterThanOrEqual(900);
    } finally {
      await fixture.close();
    }
  });

  it("clamps a Retry-After value that exceeds maxRetryDelayMs", async () => {
    const fixture = await startOpenAiHttpFixture([
      {
        type: "json",
        status: 429,
        body: { error: { message: "rate limited" } },
        headers: { "retry-after": "3600" },
      },
      jsonResponse(textChoice("recovered")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
        retryDelayMs: 1,
        maxRetryDelayMs: 50,
      });
      const start = Date.now();
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      const elapsedMs = Date.now() - start;
      expect(response.text).toBe("recovered");
      expect(elapsedMs).toBeLessThan(3_000);
    } finally {
      await fixture.close();
    }
  });

  it("falls back to retryDelayMs when Retry-After is absent or invalid", async () => {
    const fixture = await startOpenAiHttpFixture([
      {
        type: "json",
        status: 429,
        body: { error: { message: "rate limited" } },
        headers: { "retry-after": "not-a-valid-value" },
      },
      jsonResponse(textChoice("recovered")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
        retryDelayMs: 1,
      });
      const start = Date.now();
      const response = await provider.chat({
        messages: [{ role: "user", content: "hi" }],
      });
      const elapsedMs = Date.now() - start;
      expect(response.text).toBe("recovered");
      expect(elapsedMs).toBeLessThan(500);
    } finally {
      await fixture.close();
    }
  });

  it("times out a request that never responds", async () => {
    const fixture = await startOpenAiHttpFixture([
      { type: "hang", delayMs: 2_000 },
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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
    const fixture = await startOpenAiHttpFixture([
      jsonResponse(textChoice("ok")),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
        headers: { "x-org": "acme" },
      });
      await provider.chat({ messages: [{ role: "user", content: "hi" }] });
      expect(fixture.requests[0]?.headers.authorization).toBe("Bearer sk-test");
      expect(fixture.requests[0]?.headers["x-org"]).toBe("acme");
    } finally {
      await fixture.close();
    }
  });
});

describe("OpenAiProvider chatStream", () => {
  async function drainStream(
    stream: AsyncGenerator<{ text: string }, unknown, void>,
  ) {
    const deltas: { text: string }[] = [];
    let step = await stream.next();
    while (!step.done) {
      deltas.push(step.value);
      step = await stream.next();
    }
    return { deltas, response: step.value };
  }

  it("yields content deltas that concatenate to the full text", async () => {
    const fixture = await startOpenAiHttpFixture([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " there" } }] }),
        "[DONE]",
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      const { deltas, response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(deltas.map((delta) => delta.text).join("")).toBe("Hello there");
      expect(response).toEqual({ text: "Hello there" });
      expect(fixture.requests[0]?.body).toMatchObject({ stream: true });
    } finally {
      await fixture.close();
    }
  });

  it("ignores an explicit content: null delta instead of yielding or crashing", async () => {
    // Real OpenAI responses sometimes send an explicit `"content": null`
    // delta (not just an absent field) — e.g. alongside role-only or
    // finish-reason chunks. Caught against the real API: an earlier version
    // only checked `!== undefined`, so `null` slipped through and got
    // concatenated into the text (`text += null` coerces to the string
    // "null") and yielded as a delta with a null `text` field.
    const fixture = await startOpenAiHttpFixture([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { role: "assistant", content: null } }],
        }),
        JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "[DONE]",
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      const { deltas, response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "hi" }] }),
      );
      expect(deltas).toEqual([{ text: "hi" }]);
      expect(response).toEqual({ text: "hi" });
    } finally {
      await fixture.close();
    }
  });

  it("assembles a tool call fragmented across chunks, id/name only on the first", async () => {
    const fixture = await startOpenAiHttpFixture([
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "add", arguments: "" },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"a":' } }],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '1,"b":2}' } }],
              },
            },
          ],
        }),
        "[DONE]",
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      const { deltas, response } = await drainStream(
        provider.chatStream({ messages: [{ role: "user", content: "add" }] }),
      );
      expect(deltas).toEqual([]);
      expect(response).toEqual({
        text: "",
        toolCalls: [{ id: "call_1", name: "add", arguments: { a: 1, b: 2 } }],
      });
    } finally {
      await fixture.close();
    }
  });

  it("throws on a malformed data line", async () => {
    const fixture = await startOpenAiHttpFixture([
      sseResponse(["not json", "[DONE]"]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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

  it("throws when the stream ends without [DONE]", async () => {
    const fixture = await startOpenAiHttpFixture([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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

  it("retries a connection failure before any SSE bytes are sent", async () => {
    const fixture = await startOpenAiHttpFixture([
      jsonResponse({ error: { message: "boom" } }, 500),
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "ok" } }] }),
        "[DONE]",
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
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
    const fixture = await startOpenAiHttpFixture([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "hi there" } }] }),
        "[DONE]",
      ]),
    ]);
    try {
      const provider = new OpenAiProvider({
        apiKey: "sk-test",
        model: "gpt-4o",
        baseUrl: fixture.url,
      });
      const loop = new AgentLoop({ provider });
      const events = await collect(
        loop.run({ userMessage: "hi", stream: true }),
      );
      expect(events.some((event) => event.type === "llm_delta")).toBe(true);
      expect(events.at(-1)).toEqual({
        type: "final_text",
        text: "hi there",
      });
    } finally {
      await fixture.close();
    }
  });
});
