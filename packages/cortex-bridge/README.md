# @cortexmem/cortex-bridge

Bridge plugin that connects [OpenClaw](https://github.com/openclaw) agents to [Cortex](https://github.com/rikouu/cortex) memory service.

Uses OpenClaw's standard `register(api)` plugin interface.

## Install

```bash
openclaw plugins install @cortexmem/cortex-bridge
```

## Configure

Plugin config via OpenClaw settings or environment variables:

| Config Key | Env Variable | Default | Description |
|------------|-------------|---------|-------------|
| `cortexUrl` | `CORTEX_URL` | `http://localhost:21100` | Cortex server URL |
| `agentId` | — | `openclaw` | Agent identifier for memory isolation |
| `debug` | `CORTEX_DEBUG` | `false` | Enable debug logging |

## Tools

These tools are always available and work reliably:

| Tool | Description |
|------|-------------|
| `cortex_recall` | Search long-term memory for relevant past conversations, facts, and preferences |
| `cortex_remember` | Store a fact, preference, or decision (supports category: fact, preference, skill, identity, etc.) |
| `cortex_ingest` | Send a conversation pair for automatic LLM memory extraction |
| `cortex_health` | Check if the Cortex memory server is reachable (optional) |

### Slash Command

- `/cortex-status` — Quick check if Cortex server is online

## Hooks

The plugin registers lifecycle hooks for automatic memory management:

| Hook | Status | Description |
|------|--------|-------------|
| `before_agent_start` | **Working** | Recalls relevant memories and injects as context before each response |
| `agent_end` | **Not working** | Should auto-ingest conversations after each response (see Known Issues) |
| `before_compaction` | Best-effort | Emergency flush before context compression |

## Known Issues

### `agent_end` hook not firing in streaming mode

**Status:** Upstream bug — [openclaw/openclaw#21863](https://github.com/openclaw/openclaw/issues/21863)

In streaming mode (used by Telegram and other gateway channels), the `agent_end` hook is not dispatched to plugins. The `handleAgentEnd()` function in OpenClaw's streaming event handler does not call `hookRunner.runAgentEnd()`.

This means **automatic conversation ingestion does not work** in streaming mode. Memory recall (`before_agent_start`) works correctly.

**Workarounds:**

1. **Use `cortex_ingest` tool** — Instruct your Agent (via system prompt) to call `cortex_ingest` after meaningful conversations. Example system prompt addition:
   ```
   After each conversation, use the cortex_ingest tool to save the exchange
   for long-term memory. Pass the user's message and your response.
   ```

2. **Use non-streaming mode** — If your setup supports it, use a non-streaming channel where `agent_end` fires correctly.

3. **Use `cortex_remember` tool** — For specific facts or preferences, the Agent can call `cortex_remember` directly during conversation.

## License

MIT
