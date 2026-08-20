# 20 — Samples

## What this ships

Five runnable apps under `samples/`, each a receipt that the public
API (`src/index.ts`, built to `dist/`) works end to end — not a
prerequisite for the phases that came before it, proof they compose.
Scope widened from the coarse plan's original two apps (skills,
coding) to five, folding in formalized versions of the manual scripts
used to validate Phases 18–19 (`tmp/try*.mjs`, gitignored, never
public):

- `samples/basic` — `Agent` + `ScriptedProvider`, one tool-calling
  round. The smallest possible "it works" demo.
- `samples/openai` — `Agent` + `OpenAiProvider` (Phase 18).
- `samples/gemini` — `Agent` + `GeminiProvider` (Phase 19).
- `samples/skills` — `SkillRegistry` + `SkillToolset` wired by hand
  (Phase 6).
- `samples/coding` — `Runner` + `LocalDirRunner`/`SandboxToolset`
  (Phase 15) + an `ApprovalPolicy` gating `write`/`exec` (Phase 14).

## Public surface

None. `samples/` is not part of `package.json`'s `"files"` field and
ships nothing under `src/`.

## Behaviour

**Shared shape.** Every `samples/<name>/run.mjs` exports:

```js
export async function run(overrides = {}) {
  const provider = overrides.provider ?? defaultProvider();
  // build the sample's Agent/Runner, run one fixed interaction,
  // log every event, return the collected events
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
```

`run` accepting a `provider` override is what makes a sample testable
by direct function call — no subprocess spawning, no fixture logic
duplicated between a sample and its test.

**Imports from `dist/`, not `src/`.** Same convention `tmp/try*.mjs`
already used. The whole point of this phase is proving the *published*
surface works; importing `src/` would test something a real consumer
of the package never touches.

**`samples/openai` / `samples/gemini`.** `defaultProvider()`: with
`OPENAI_API_KEY` (resp. `GEMINI_API_KEY`) set, the real provider;
otherwise a tiny embedded offline HTTP fixture — one canned
tool-call-then-text exchange, intentionally small, not shared with
`tests/support/*-http-fixture.ts` (different purpose: one illustrative
demo vs. an exhaustive test harness). Either way the same provider
class is genuinely exercised, only the backend differs — this merges
what used to be two separate manual scripts
(`tmp/try-*-local.mjs`/`tmp/try-*-real.mjs`) into one.

**`samples/skills`.** `SkillRegistry.fromDirectory("samples/skills/skills")`
(one bundled example skill, `summarize`), wired into
`toolsets: [new SkillToolset(registry)]` and
`systemPrompt: registry.prelude()` by hand — the exact shape Phase 6's
core/modules refactor settled on (`AgentOptions.skills` does not
exist).

**`samples/coding`.** The one sample built on `Runner` directly, not
`Agent` — approval (Phase 14) needs the live handle `Agent` never
hands back. `LocalDirRunner` (ephemeral) + `SandboxToolset`, an
`ApprovalPolicy` gating `write`/`exec` but not `read`. A `ScriptedProvider`
drives write → (paused for approval, auto-approved by the sample,
logging the pause) → read-back → final text — one demo touching
Phases 12, 14, and 15 together, closer to "the public API composes"
than three isolated toy examples would be.

**`pnpm run build` is now a hard prerequisite for the full test
suite** — the five sample tests import `dist/`. `.githooks/pre-push`
builds before `typecheck`/`test` so every push still gets the
guarantee it always got, just via an extra step. A local ad-hoc
`pnpm test` without a prior build still runs everything else; only the
five sample tests fail with a clear "Cannot find module" until
`dist/` exists — not hidden behind a skip-if-missing hedge, since that
would mask a genuinely broken sample the same way.

## Non-goals

- No CLI framework or argument parsing beyond reading a couple of env
  vars — each sample runs one fixed, hardcoded interaction.
- No new public exports, no change to `src/`.
- Not a configurable "try any provider" playground.
- The `openai`/`gemini` samples' offline fixtures do not replace
  `tests/openai-provider.test.ts`/`gemini-provider.test.ts` — those
  remain the exhaustive mapping/retry/streaming suites; the sample
  fixture only supports its one fixed demo exchange.
