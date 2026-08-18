# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
