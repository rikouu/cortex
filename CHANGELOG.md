# Changelog

## v0.10.2 — 2026-03-21

### Features
- **Recall timeout**: Configurable total recall timeout (`recallTimeoutMs`, default 5000ms) — if expansion + search + rerank exceeds budget, returns partial results instead of blocking
- **Dashboard recall timeout setting**: New field in Gate section with variant-count recommendations (1→3s, 3→5s, 6→8s, 10+→12s)

### Performance
- **Reranker instant failover**: Auth errors (401/403) skip immediately instead of waiting for timeout
- **Parallel variant embedding**: Query expansion variants embedded in a single batch API call instead of sequential
- **Budget-aware timeouts**: Reranker and expansion respect remaining recall budget

### Fixes
- **Timer leak**: Recall timeout timer properly cleaned up in try/finally
- **Reranker/expansion honor recallTimeoutMs**: No longer use hardcoded timeouts that can overshoot the total budget

## v0.10.1 — 2026-03-21

### Fixes
- **Reindex auto-rebuilds vec table on dimension change**: When embedding dimensions change (e.g. switching from `text-embedding-3-small` 1536d to `text-embedding-3-large` 3072d), the vec0 virtual table is now automatically dropped and recreated with the correct dimensions on startup
- **Reindex reports upsert errors**: Vector upsert failures during reindex are now caught and counted in the `errors` field instead of being silently swallowed

## v0.10.0 — 2026-03-21

### Features
- **Memory Self-Improvement System**: Feedback-driven importance auto-adjustment
  - Feedback API: `POST /api/v1/memories/:id/feedback` (+1/0/-1 scoring)
  - Implicit feedback via recall usage tracking (`POST /api/v1/recall/:recallId/usage`)
  - Lifecycle Phase 6c: automatic importance adjustment with stability safeguards
  - Configurable: window size, min feedbacks, max delta, implicit/explicit weights
  - Full audit trail in `importance_adjustments` table for rollback
- **Dashboard UX/UI Redesign**: Modern Linear/Vercel-inspired aesthetic
  - New CSS design system with layered backgrounds, 4-level text hierarchy
  - Redesigned sidebar with section dividers and refined navigation
  - Stats page with improved charts and trend indicators
  - Memory browser with category-colored cards and inline feedback buttons
  - Settings page with self-improvement configuration panel
  - All pages polished: Agents, ExtractionLogs, SystemLogs, LifecycleMonitor, SearchDebug

### Security
- Rate limiting on feedback API endpoints
- Input validation: maxLength on comments, maxItems on memory_ids arrays
- Recall session map size cap (10K) with TTL cleanup

### Improvements
- Self-improvement settings section in Dashboard
- i18n: 24 new strings in both English and Chinese
- Focus-visible CSS styles for keyboard accessibility

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
