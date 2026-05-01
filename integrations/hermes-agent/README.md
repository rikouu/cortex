# Hermes Agent Cortex Provider

Reference native memory provider for connecting Hermes Agent to Cortex through the Cortex REST API.

## What it does

- Enables `memory.provider: cortex` in Hermes Agent.
- Recalls Cortex memories before each turn through `POST /api/v1/recall`.
- Ingests completed turns after each response through `POST /api/v1/ingest`.
- Exposes explicit tools: `cortex_recall`, `cortex_remember`, `cortex_forget`, `cortex_search`, `cortex_relations`, and `cortex_stats`.

## Install into Hermes Agent

Copy the provider directory into your Hermes Agent checkout or Hermes plugin path:

```bash
mkdir -p ~/.hermes/hermes-agent/plugins/memory
cp -R integrations/hermes-agent/plugins/memory/cortex-provider-provider ~/.hermes/hermes-agent/plugins/memory/cortex
```

Set Hermes config:

```bash
hermes config set memory.provider cortex
```

Set environment variables for the Hermes process:

```bash
CORTEX_URL=http://127.0.0.1:21100
CORTEX_AUTH_TOKEN=***
CORTEX_AGENT_ID=hermes
CORTEX_PAIRING_CODE=***
```

Restart Hermes after changing config or environment.

Verify:

```bash
hermes memory status
```

Expected result: provider `cortex`, plugin installed, status available.

## Notes

- `CORTEX_URL` defaults to `http://127.0.0.1:21100`.
- Non-sensitive settings can also live in `$HERMES_HOME/cortex.json`.
- `CORTEX_AUTH_TOKEN` and `CORTEX_PAIRING_CODE` are read from environment variables.
- Subagents and non-primary contexts can recall memories, but cannot write or delete memories.
