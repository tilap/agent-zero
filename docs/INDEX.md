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
| [architecture/06-skills.md](architecture/06-skills.md) | What is a `SKILL.md`? How does a model discover and load a skill? How do I wire skills into an `Agent`? |
| [architecture/07-mcp.md](architecture/07-mcp.md) | How does an MCP server become a toolset? How are tool names prefixed? |
| [architecture/08-mcp-transports.md](architecture/08-mcp-transports.md) | How does `McpToolset` connect over SSE or HTTP instead of stdio? |
| [architecture/09-hooks.md](architecture/09-hooks.md) | How do `beforeModel`/`afterModel`/`beforeTool`/`afterTool` hooks work? |
| [architecture/10-history.md](architecture/10-history.md) | How does `priorMessages` compose? How does `ContextCompactor` work? What happens to an oversized tool result? |
| [architecture/11-parallel-tools.md](architecture/11-parallel-tools.md) | How do several tool calls in one turn run? What happens if one hook throws while others are in flight? |
| [architecture/12-public-runner.md](architecture/12-public-runner.md) | How is `Runner` different from `Agent`? When would I use it directly? |
| [architecture/13-steering.md](architecture/13-steering.md) | How do I inject a line of text into a run already in progress? |
| [architecture/14-approval.md](architecture/14-approval.md) | How do I pause a tool call for a human decision? What does a denied call look like to the model? |
| [architecture/15-sandbox-local.md](architecture/15-sandbox-local.md) | How do I give a model a scoped filesystem and shell? Is it actually sandboxed? |
| [architecture/16-sandbox-remote.md](architecture/16-sandbox-remote.md) | How do I run the sandbox against a remote service or an MCP exec server instead of the local filesystem? |
| [architecture/17-token-streaming.md](architecture/17-token-streaming.md) | How do I stream a response? What happens to tool calls when streaming is on? |
| [architecture/18-hosted-provider.md](architecture/18-hosted-provider.md) | How do I use a real OpenAI-shaped model? What happens on a flaky request or a rate limit? |
| [architecture/19-second-hosted-provider.md](architecture/19-second-hosted-provider.md) | How does Gemini's wire shape differ from OpenAI's? How are tool calls without ids handled? |
