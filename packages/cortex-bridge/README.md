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

## What It Does

### Automatic Hooks

- **`before_agent_start`** — Recalls relevant memories from Cortex and injects them as context (`prependContext`) before the agent responds.
- **`agent_end`** — Extracts the last user/assistant pair and sends it to Cortex for memory ingestion (fire-and-forget).
- **`before_compaction`** — Emergency flush of all session messages to Cortex before context window compression.

### Registered Tools

| Tool | Description |
|------|-------------|
| `cortex_recall` | Search Cortex for relevant memories about a topic |
| `cortex_remember` | Store an important fact or piece of information |
| `cortex_health` | Check if the Cortex memory server is reachable (optional) |

### Slash Command

- `/cortex-status` — Quick check if Cortex server is online

### Background Service

The plugin registers a background service that performs periodic health checks (every 60s) and logs warnings if the Cortex server becomes unreachable.

## License

MIT
