# Cortex memory provider for Hermes Agent

A native [Hermes Agent](https://github.com/NousResearch/hermes-agent) `MemoryProvider`
that uses [Cortex](https://github.com/rikouu/cortex) as a self-hosted external memory
backend — a drop-in alternative to Mem0.

Unlike the generic MCP path (where the model must decide when to call `cortex_recall`),
this provider participates in Hermes' memory lifecycle directly:

- **Pre-turn recall** — relevant memories are fetched and injected automatically before each turn.
- **Post-turn ingestion** — completed turns are sent to Cortex for LLM fact extraction.
- **Explicit tools** — `cortex_search`, `cortex_remember`, `cortex_forget`.
- Appears in `hermes memory setup` and `hermes memory status`.
- Selectable via `memory.provider: cortex`.

> Reference implementation for [rikouu/cortex#23](https://github.com/rikouu/cortex/issues/23).
> Zero third-party dependencies — stdlib `urllib` only. Targets Hermes'
> `agent/memory_provider.py` ABC.

## Requirements

- A running Cortex server (default `http://127.0.0.1:21100`). See the
  [Cortex README](https://github.com/rikouu/cortex).
- Hermes Agent with the memory-provider plugin system.

## Install

**Option A — copy into the Hermes plugins directory:**

```bash
mkdir -p "$HERMES_HOME/plugins/memory/cortex"   # $HERMES_HOME defaults to ~/.hermes
cp __init__.py plugin.yaml "$HERMES_HOME/plugins/memory/cortex/"
```

**Option B — publish this directory as its own repo** and install with Hermes'
plugin manager (mirrors how `DenSul/mem0-oss` is distributed):

```bash
hermes plugins install <owner>/<repo>
```

## Configure

Set environment variables in `~/.hermes/.env`:

```env
CORTEX_URL=http://127.0.0.1:21100
CORTEX_AUTH_TOKEN=            # optional, if your Cortex server requires auth
CORTEX_AGENT_ID=hermes
CORTEX_PAIRING_CODE=          # optional, isolates this instance's namespace
```

Then activate it in `~/.hermes/config.yaml`:

```yaml
memory:
  provider: cortex
```

Or run the interactive wizard:

```bash
hermes memory setup
hermes memory status     # should show cortex as active and available
hermes gateway restart
```

## Scoping

Memories are scoped by `agent_id` plus an optional `pairing_code`. If no pairing
code is set, the provider falls back to Hermes' `user_id` (passed to `initialize`)
so memories stay isolated per user. Set `CORTEX_PAIRING_CODE` to pin a dedicated
namespace for an instance.

## Cortex API mapping

| Hermes provider behavior | Cortex endpoint |
|--------------------------|-----------------|
| Pre-turn recall / `cortex_search` | `POST /api/v1/recall` |
| Post-turn ingestion (`sync_turn`) | `POST /api/v1/ingest` |
| `cortex_remember`        | `POST /api/v1/memories` |
| `cortex_forget`          | `DELETE /api/v1/memories/:id` |
| `is_available` probe      | config check (no network, per ABC contract) |

## Notes

- The built-in Hermes memory and the existing Cortex **MCP** integration remain
  fully supported; this provider is an alternative external-backend path, not a
  replacement for either.
- Recall runs on the critical path with an 8s budget; ingestion runs on a
  background thread so it never blocks a turn.
