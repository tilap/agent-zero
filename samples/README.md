# Samples

Six small, runnable apps proving the published package works end to
end. Each imports from `../../dist/index.js`, the same way a real
consumer of `agent-zero` would — build first:

```bash
pnpm build
```

Then run any sample directly:

```bash
node samples/basic/run.mjs      # Agent + ScriptedProvider, one tool call
node samples/openai/run.mjs     # Agent + OpenAiProvider (real API if OPENAI_API_KEY is set, offline fixture otherwise)
node samples/gemini/run.mjs     # Agent + GeminiProvider (real API if GEMINI_API_KEY is set, offline fixture otherwise)
node samples/skills/run.mjs     # SkillRegistry + SkillToolset, wired by hand
node samples/coding/run.mjs     # Runner + sandbox + approval on write/exec
node samples/repl/run.mjs       # Runner + readline REPL, streamed output, gated dumb tool with interactive approval
```

`samples/openai` and `samples/gemini` use the real API when a key is
in the environment (`OPENAI_API_KEY`/`GEMINI_API_KEY`, plus an
optional `OPENAI_MODEL`/`GEMINI_MODEL`), and fall back to a tiny
embedded offline HTTP fixture otherwise — the same provider class is
exercised either way, only the backend differs.

Each sample exports its logic as `run(overrides)`, which accepts a
`provider` override — that's what the offline tests under
`tests/samples.*.test.ts` use to drive them deterministically without
touching the network.

`samples/repl` additionally accepts an `input` override (an object with
`question(prompt)`/`close()`, defaulting to a real `readline/promises`
interface over stdin) so its tests can drive the REPL — including the
interactive approval prompt on its one gated tool — with a scripted queue
of answers instead of a real terminal. It does not support steering
(injecting a message mid-run would need a non-blocking stdin read while a
turn is already in flight); type `exit` to quit.
