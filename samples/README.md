# Samples

Five small, runnable apps proving the published package works end to
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
