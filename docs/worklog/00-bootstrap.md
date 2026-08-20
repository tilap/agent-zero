# 00 — Bootstrap

## What this ships

The toolchain: package manifest, TypeScript config, test runner, linter,
and git hooks. No runtime code. `agent-zero` is a library — this
increment is what makes the rest of it testable and reviewable.

## Setup

```sh
nvm use          # or: fnm use — reads .nvmrc
corepack enable  # pins pnpm from package.json's "packageManager"
pnpm install     # runs the "prepare" script, wiring the git hooks
```

The node version is pinned in three places on purpose, one per reader:
`.nvmrc` (nvm/fnm, floating patch on `24`), `engines.node` in
`package.json` (`pnpm install` refuses an older node), and
`packageManager` in `package.json` (Corepack pins the exact pnpm version
the same way `.nvmrc` pins node).

## Running things

| Command           | Does                   |
| ----------------- | ---------------------- |
| `pnpm check`      | Biome lint, whole tree |
| `pnpm format`     | Biome, writes fixes    |
| `pnpm typecheck`  | `tsc --noEmit`         |
| `pnpm test`       | Vitest, single run     |
| `pnpm test:watch` | Vitest, watch mode     |
| `pnpm build`      | Emit `dist/` (`tsc -p tsconfig.build.json`) |

## Git hooks

Hooks live in `.githooks/` and are wired by `core.hooksPath`, set by the
`prepare` script — no dependency, the hooks are plain shell and reviewable
in the PR that adds them.

- `pre-commit` runs Biome on staged files. A formatting or lint violation
  blocks the commit.
- `pre-push` builds (`tsc -p tsconfig.build.json`), then runs `tsc --noEmit`,
  then the test suite. The build step exists because the sample tests
  under `tests/samples.*.test.ts` (Phase 20) import `dist/` directly —
  the same way a real consumer of the published package would — so
  `dist/` has to be fresh before those tests can pass. A type error, a
  build failure, or a failing test blocks the push.

Bypassing either with `--no-verify` is a choice you own, not a workaround
the repo endorses — use it only when you understand exactly what you are
skipping (e.g. pushing a deliberately red, tests-first commit mid-branch).

## Why TypeScript

Personal fit: this is where the author is fastest, not a claim that
TypeScript suits agent runtimes better than any other language. The model
is an HTTP endpoint either way; the loop is a `while` with a `switch`.
