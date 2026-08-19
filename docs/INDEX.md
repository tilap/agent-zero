# Documentation index

Load this index first, then open only the rows that match your question.
Do not read the whole `docs/` tree.

| Doc | Answers |
| --- | --- |
| [architecture/00-bootstrap.md](architecture/00-bootstrap.md) | How do I set up and run this project? What do the git hooks check? |
| [architecture/01-conversation-contract.md](architecture/01-conversation-contract.md) | What is a `Message`? How does a scripted `LlmProvider` behave? |
| [architecture/02-text-only-loop.md](architecture/02-text-only-loop.md) | What events does one loop round emit? What does `stream: true` do today? |
| [architecture/03-tools.md](architecture/03-tools.md) | How does a tool round work? What happens when a tool throws or is unknown? |
| [architecture/04-loop-bounds.md](architecture/04-loop-bounds.md) | What happens at `maxRounds`? How does cancellation work? |
| [architecture/05-agent-facade.md](architecture/05-agent-facade.md) | How do I use `Agent`? What is `RunResult`? How does the workspace lifecycle work? |
| [architecture/06-skills.md](architecture/06-skills.md) | What is a `SKILL.md`? How does a model discover and load a skill? |
| [architecture/07-mcp.md](architecture/07-mcp.md) | How does an MCP server become a toolset? How are tool names prefixed? |
