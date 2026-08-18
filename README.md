# agent-zero

The smallest agent runtime that is still useful.

An agent run is a bounded loop: send messages (and optional tool
schemas) to a model; the model replies with text (stop) or tool calls
(execute, append results, loop); stop on text, cancel, or max rounds.

Setup and development commands: see [docs/INDEX.md](docs/INDEX.md).
