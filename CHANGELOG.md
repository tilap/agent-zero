# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `Runner`, `RunnerOptions`, `RunnerRunOptions`: exported from the
  package entry point. `Runner` already backed `Agent` internally; a
  caller can now construct and hold one directly to get a live handle
  on a run in progress.
- `Runner.sendSteering(text)`: queue a line of text that is injected
  as a `user` message before the run's next round, plus the
  `steering_injected` event and `NoActiveRunError` for calling it
  outside an active run.
- `RunnerOptions.approvalPolicy`, `Runner.approve`/`Runner.deny`: pause
  a tool call for an external yes/no decision before it runs. A denied
  call becomes a model-visible `isError` tool result instead of
  running; cancelling the run while a decision is pending ends the run
  in `cancelled`. `UnknownApprovalRequestError` covers deciding an id
  that is not currently pending.
- `SandboxRunner`, `LocalDirRunner`, `SandboxToolset`: a scoped
  filesystem and shell (`exec`/`read`/`write`) a caller can add to
  `toolsets`. `LocalDirRunner` confines paths to a root directory
  (ephemeral by default, or an explicit path kept after the run,
  mirroring `WorkspaceOptions`) and rejects any path that would escape
  it. Not a security boundary around `exec` itself — see
  `docs/worklog/15-sandbox-local.md`.
- `RemoteSandboxRunner` and `McpSandboxRunner`: two more
  `SandboxRunner` implementations behind the same protocol —
  `RemoteSandboxRunner` over a small HTTP contract this repo defines
  itself, `McpSandboxRunner` adapting an already-connected
  `McpToolset` (any transport). `SandboxToolset` needed no change to
  support either.
- `LlmDelta`, `LlmProvider.chatStream` (optional): stream partial text
  through a new `llm_delta` event while a round is in progress.
  `ScriptedProvider` implements it. `RunRequest.stream` now only
  throws `UnsupportedOptionError` when the configured provider does
  not implement `chatStream`, instead of unconditionally. Tool calls
  are never streamed — they still arrive whole on the round's final
  response.
- `OpenAiProvider`, `HostedProviderError`: an `LlmProvider` over
  OpenAI's chat completions HTTP API (hand-rolled `fetch`, no SDK
  dependency), including `chatStream`. A small retry budget on
  `429`/`5xx` and connection failures/timeout, a fixed delay between
  attempts, no retry once a streamed response has started emitting
  content.
- `GeminiProvider`: a second `LlmProvider`, over Google's Generative
  Language API — a genuinely different wire shape from OpenAI (system
  prompt as a top-level field, no `tool` role, tool calls with no id
  correlated by name and position instead, no stream terminator).
  Same retry/timeout policy and `HostedProviderError` as
  `OpenAiProvider`, no shared code between the two.
- `SkillRegistry`, `SkillToolset`, and `parseSkill`: discover `SKILL.md`
  files, expose their catalog to a model, and load a skill's body or
  resource files on demand. Callers pass `registry.prelude()` as the
  system prompt and `new SkillToolset(registry)` in `toolsets`.
- `McpToolset` and `McpToolset.connectStdio`: an MCP server, wrapped as a
  toolset, over a hand-rolled stdio JSON-RPC client. Tool names are
  prefixed per server; `${VAR}` in `env` is substituted from
  `process.env` before spawning.
- `McpToolset.connectSse` and `.connectHttp`: the same toolset over a
  hand-rolled SSE or Streamable HTTP connection, with `${VAR}`
  substitution over `headers` instead of `env`.
- `Hooks` (`beforeModel`, `afterModel`, `beforeTool`, `afterTool`) and
  `AgentOptions.hooks`: splice into a round to short-circuit or replace
  a model response or a tool result, without writing a toolset.
- `RunRequest.priorMessages`: prior conversation history, composed as
  `[system?, ...priorMessages, user]` and validated as one transcript,
  including a new tool-call/tool-result pairing invariant.
- `ContextCompactor` and `TruncatingCompactor`, wired through
  `AgentOptions.contextCompactor` (and `RunnerOptions`/`AgentLoop`):
  opt-in truncation of the working transcript, run once per round, that
  never splits a tool-call/tool-result pair. Emits a new
  `context_compacted` event when it actually shrinks the transcript.
- A fixed cap (`MAX_TOOL_RESULT_CHARS`) on tool result content, applied
  unconditionally so one oversized tool result cannot blow up the next
  round's request.

### Changed

- Tool calls within one model turn now execute concurrently instead of
  one at a time. `tool_call` events for a turn are emitted together, in
  call order, before any `tool_result`; results are appended to the
  transcript in call order regardless of which call settles first. A
  throwing `beforeTool`/`afterTool` hook anywhere in the batch reports
  the earliest-by-call-order rejection and discards every result in
  that batch. Cancellation is checked once before a batch is dispatched
  and once after the whole batch settles, rather than between each
  call.

## [0.1.0] - 2026-08-18

### Added

- Project toolchain: pnpm, TypeScript, Vitest, Biome, git hooks.
- `Agent`: `run` (event stream) and `runSync` (`RunResult`) over a
  bounded, tool-calling loop.
- `LlmProvider` contract, tool calling (`BaseToolset`, `ToolsetRouter`),
  `maxRounds` enforcement, and cancellation through an `AbortSignal`.
- Per-run workspace: ephemeral by default, or an explicit path that is
  never removed by the library.
- Public entry point (`src/index.ts`).
