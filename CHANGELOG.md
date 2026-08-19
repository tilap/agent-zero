# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `SkillRegistry`, `SkillToolset`, and `parseSkill`: discover `SKILL.md`
  files, expose their catalog to a model, and load a skill's body or
  resource files on demand.
- `AgentOptions.skills`: wires a `SkillRegistry` into an `Agent`'s system
  prompt and toolsets automatically.
- `McpToolset` and `McpToolset.connectStdio`: an MCP server, wrapped as a
  toolset, over a hand-rolled stdio JSON-RPC client. Tool names are
  prefixed per server; `${VAR}` in `env` is substituted from
  `process.env` before spawning.
- `McpToolset.connectSse` and `.connectHttp`: the same toolset over a
  hand-rolled SSE or Streamable HTTP connection, with `${VAR}`
  substitution over `headers` instead of `env`.

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
