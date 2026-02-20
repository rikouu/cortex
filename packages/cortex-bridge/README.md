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

## Tools (Primary Interface)

These tools are always available and work reliably:

| Tool | Description |
|------|-------------|
| `cortex_recall` | Search long-term memory for relevant past conversations, facts, and preferences |
| `cortex_remember` | Store a fact, preference, or decision (supports category: fact, preference, skill, identity, etc.) |
| `cortex_ingest` | Send a conversation pair for automatic LLM memory extraction |
| `cortex_health` | Check if the Cortex memory server is reachable (optional) |

### Slash Command

- `/cortex-status` — Quick check if Cortex server is online

## Hooks (Best-effort)

The plugin also registers lifecycle hooks. These are best-effort and may not fire in all OpenClaw configurations:

- **`before_agent_start`** — Recalls relevant memories and injects as context
- **`agent_end`** — Ingests the last conversation pair
- **`before_compaction`** — Emergency flush before context compression

> **Note:** In current OpenClaw versions, lifecycle hooks may not be dispatched to `kind: "tool"` plugins. The tools above provide the same functionality and are the recommended way to use this plugin.

## License

MIT
