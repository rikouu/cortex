# Changelog

## v0.9.5 — 2026-03-21

### Fixes
- **Timing leak in safeCompare**: Pad both strings to equal length before constant-time comparison, preventing length-based timing attacks.
- **Deep merge for env overrides in loadConfig**: Use `deepMerge` instead of shallow spread so env var overrides (e.g. `CORTEX_DB_PATH`) don't clobber nested file config.
- **PLUGIN_VERSION**: Corrected cortex-bridge version from 0.5.1 to 0.6.1.
- **README accuracy**: Fixed Node.js requirement (≥ 20), removed speculative model names, added `cortex_relations` to MCP tools table, fixed `pnpm start` → `pnpm dev`.
- **CHANGELOG**: Added missing v0.9.3 entry and dates.
- **LICENSE**: Added MIT license file.

## v0.9.4 — 2026-03-15

### Features
- **Multi-agent tool isolation**: Bridge tools (`cortex_recall`, `cortex_remember`, `cortex_ingest`) now accept an optional `agent_id` parameter, enabling per-request agent switching in multi-agent orchestrators.
- **Dynamic agent ID in MCP client**: `CORTEX_AGENT_ID` env var is re-read per request, supporting dynamic agent switching without restart.
- **Per-session agent resolution in bridge**: `ctx.agentId` is resolved per session and cached, preventing race conditions in concurrent multi-agent scenarios.

### Improvements
- **Selective engine rebuild on config change**: `reloadProviders` now only reconstructs engines whose configuration actually changed, instead of rebuilding all engines on any config update.
- **Settings key preservation**: Switching providers in the dashboard Settings no longer loses previously configured API keys on the first switch; existing keys are tracked from initial config load.

### Fixes
- Fixed version display endpoint to return correct version string.

## v0.9.3 — 2026-03-10

- Bump cortex-bridge to v0.6.1 for npm publish.

## v0.9.2 — 2026-03-08

- Use `config.storage.dbPath` instead of non-existent `config.dataDir` in `backupDb()`.

## v0.9.1 — 2026-03-05

- Bump `@cortexmem/mcp` to 0.1.2 with auth-token support.

## v0.9.0 — 2026-03-01

- Broaden fast channel coverage for diverse users.
- Comprehensive fast channel and prompt audit.
