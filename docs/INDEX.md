# Documentation index

Load this index first, then open only the rows that match your question.
Do not read the whole `docs/` tree.

| Doc | Answers |
| --- | --- |
| [worklog/00-bootstrap.md](worklog/00-bootstrap.md) | How do I set up and run this project? What do the git hooks check? |
| [worklog/01-conversation-contract.md](worklog/01-conversation-contract.md) | What is a `Message`? How does a scripted `LlmProvider` behave? |
| [worklog/02-text-only-loop.md](worklog/02-text-only-loop.md) | What events does one loop round emit? What does `stream: true` do today? |
| [worklog/03-tools.md](worklog/03-tools.md) | How does a tool round work? What happens when a tool throws or is unknown? |
| [worklog/04-loop-bounds.md](worklog/04-loop-bounds.md) | What happens at `maxRounds`? How does cancellation work? |
| [worklog/05-agent-facade.md](worklog/05-agent-facade.md) | How do I use `Agent`? What is `RunResult`? How does the workspace lifecycle work? |
| [worklog/06-skills.md](worklog/06-skills.md) | What is a `SKILL.md`? How does a model discover and load a skill? How do I wire skills into an `Agent`? |
| [worklog/07-mcp.md](worklog/07-mcp.md) | How does an MCP server become a toolset? How are tool names prefixed? |
| [worklog/08-mcp-transports.md](worklog/08-mcp-transports.md) | How does `McpToolset` connect over SSE or HTTP instead of stdio? |
| [worklog/09-hooks.md](worklog/09-hooks.md) | How do `beforeModel`/`afterModel`/`beforeTool`/`afterTool` hooks work? |
| [worklog/10-history.md](worklog/10-history.md) | How does `priorMessages` compose? How does `ContextCompactor` work? What happens to an oversized tool result? |
| [worklog/11-parallel-tools.md](worklog/11-parallel-tools.md) | How do several tool calls in one turn run? What happens if one hook throws while others are in flight? |
| [worklog/12-public-runner.md](worklog/12-public-runner.md) | How is `Runner` different from `Agent`? When would I use it directly? |
| [worklog/13-steering.md](worklog/13-steering.md) | How do I inject a line of text into a run already in progress? |
| [worklog/14-approval.md](worklog/14-approval.md) | How do I pause a tool call for a human decision? What does a denied call look like to the model? |
| [worklog/15-sandbox-local.md](worklog/15-sandbox-local.md) | How do I give a model a scoped filesystem and shell? Is it actually sandboxed? |
| [worklog/16-sandbox-remote.md](worklog/16-sandbox-remote.md) | How do I run the sandbox against a remote service or an MCP exec server instead of the local filesystem? |
| [worklog/17-token-streaming.md](worklog/17-token-streaming.md) | How do I stream a response? What happens to tool calls when streaming is on? |
| [worklog/18-hosted-provider.md](worklog/18-hosted-provider.md) | How do I use a real OpenAI-shaped model? What happens on a flaky request or a rate limit? |
| [worklog/19-second-hosted-provider.md](worklog/19-second-hosted-provider.md) | How does Gemini's wire shape differ from OpenAI's? How are tool calls without ids handled? |
| [worklog/20-samples.md](worklog/20-samples.md) | What runnable examples ship with this kit? Why does `pnpm run build` matter for the test suite now? |
