# Changelog

## v0.9.4

### Features
- **Multi-agent tool isolation**: Bridge tools (`cortex_recall`, `cortex_remember`, `cortex_ingest`) now accept an optional `agent_id` parameter, enabling per-request agent switching in multi-agent orchestrators.
- **Dynamic agent ID in MCP client**: `CORTEX_AGENT_ID` env var is re-read per request, supporting dynamic agent switching without restart.
- **Per-session agent resolution in bridge**: `ctx.agentId` is resolved per session and cached, preventing race conditions in concurrent multi-agent scenarios.

### Improvements
- **Selective engine rebuild on config change**: `reloadProviders` now only reconstructs engines whose configuration actually changed, instead of rebuilding all engines on any config update.
- **Settings key preservation**: Switching providers in the dashboard Settings no longer loses previously configured API keys on the first switch; existing keys are tracked from initial config load.

### Fixes
- Fixed version display endpoint to return correct version string.

## v0.9.2

- Use `config.storage.dbPath` instead of non-existent `config.dataDir` in `backupDb()`.

## v0.9.1

- Bump `@cortexmem/mcp` to 0.1.2 with auth-token support.

## v0.9.0

- Broaden fast channel coverage for diverse users.
- Comprehensive fast channel and prompt audit.
