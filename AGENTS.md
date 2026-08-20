# AGENTS

Start at [docs/INDEX.md](docs/INDEX.md); open only the docs that answer
your question.

## Wording

English identifiers, English docs. One word per concept — the module
table in the worklog docs is the glossary; do not invent synonyms.

## Git

- Branch: `<type>/<kebab-description>` (conventional).
- Commits: conventional, English, one logical change, no tool
  attribution.
- `main` is written only through a pull request. No local commits on
  `main` for feature work.
- Merge with a merge commit (`--no-ff`), never squash. Delete the branch
  after merge.
- Hooks: `pre-commit` runs Biome; `pre-push` runs `tsc --noEmit` and the
  test suite. See [docs/worklog/00-bootstrap.md](docs/worklog/00-bootstrap.md).

## When docs must move in the same change

A change updates docs in the same commit/PR when it does any of the
following — otherwise no doc edit is needed:

- User-visible behaviour (CLI, public API, events) → `CHANGELOG.md`
  `[Unreleased]` and the worklog file that covers it
- A doc is added, moved, or retired → `docs/INDEX.md`
- A new public type or invariant ships → the phase's framing doc
- A new setup command, script, or env var ships → the bootstrap or
  relevant development doc
- A new domain word enters the glossary → the glossary, once one exists

Never bump a "last verified" date without reading the doc against the
code it describes.

## Tooling

- Biome is the only linter and the only formatter — no ESLint, no
  Prettier.
- pnpm, Node pinned via `.nvmrc` and `engines.node`.
