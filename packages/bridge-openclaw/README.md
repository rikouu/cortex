# @cortexmem/bridge-openclaw

Bridge plugin that connects [OpenClaw](https://github.com/openclaw) agents to [Cortex](https://github.com/rikouu/cortex) memory service.

## Install

```bash
openclaw plugins install @cortexmem/bridge-openclaw
```

## Configure

Set environment variables or configure via `openclaw.json`:

```bash
CORTEX_URL=http://localhost:21100   # Cortex server URL
CORTEX_DEBUG=true                    # Optional: enable debug logging
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORTEX_URL` | `http://localhost:21100` | Cortex server URL |
| `CORTEX_DEBUG` | — | Enable debug logging |

## Hooks

The plugin provides three automatic hooks:

- **`onBeforeResponse`** — Recalls relevant memories and injects them as context before the agent responds.
- **`onAfterResponse`** — Extracts memories from conversations after the agent responds (fire-and-forget).
- **`onBeforeCompaction`** — Emergency flush of key information before context window compression.

## API

### `healthCheck()`

Verify the Cortex server is reachable.

```typescript
import { healthCheck } from '@cortexmem/bridge-openclaw';

const status = await healthCheck();
// { ok: true, latency_ms: 12 }
```

### Individual Hooks

You can also import hooks individually:

```typescript
import { onBeforeResponse, onAfterResponse, onBeforeCompaction } from '@cortexmem/bridge-openclaw';
```

## License

MIT
