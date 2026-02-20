# 🧠 Cortex — Universal AI Agent Memory Service

**English** | [中文](./README.zh-CN.md)

Cortex is a standalone memory service for AI agents. It runs as a sidecar process and provides persistent, searchable, lifecycle-managed memory via REST API, MCP, and framework-specific bridge plugins.

## Features

- **Three-layer memory model**: Working (48h) → Core (permanent) → Archive (90d, compressed back to Core)
- **Hybrid search**: BM25 full-text (FTS5) + vector semantic search, with layer weighting and decay scoring
- **High-signal detection**: Regex patterns for Chinese/English/Japanese — no LLM needed for key facts
- **LLM-powered extraction**: Automatic summarization and entity extraction (gpt-4o-mini by default)
- **Lifecycle engine**: Automatic promotion, merging, archival, and compression — memories never truly disappear
- **Multiple access methods**: REST API, MCP (Claude Desktop), OpenClaw Bridge Plugin
- **Pluggable vector backends**: SQLite vec0 (default, zero-config) → Qdrant → Milvus
- **Management dashboard**: React SPA for browsing, editing, searching, and monitoring memories
- **Markdown export**: Auto-generates MEMORY.md compatible with OpenClaw's bootstrap

## Quick Start

```bash
# Clone
git clone https://github.com/rikouu/cortex.git
cd cortex

# Install
pnpm install

# Configure (requires OpenAI API key for LLM + embedding)
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Run
pnpm dev
# Server starts at http://localhost:21100
```

### Docker

```bash
OPENAI_API_KEY=sk-xxx docker compose up -d
```

## Architecture

```
┌─ Client Layer ─────────────────────────────────────────┐
│  OpenClaw (Bridge) │ Claude Desktop (MCP) │ Any (REST)  │
└────────────────────┼──────────────────────┼─────────────┘
                     ▼                      ▼
┌─ Cortex Server (:21100) ───────────────────────────────┐
│  REST API │ MCP Server │ Dashboard                      │
│  Memory Gate (recall) │ Memory Sieve (ingest)           │
│  Memory Flush+ │ Lifecycle Engine                       │
│  SQLite + FTS5 │ Vector Backend │ Markdown Exporter     │
└─────────────────────────────────────────────────────────┘
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/recall` | Search memories and get injection context |
| `POST` | `/api/v1/ingest` | Ingest conversation for memory extraction |
| `POST` | `/api/v1/flush` | Emergency flush before compaction |
| `POST` | `/api/v1/search` | Hybrid search with debug info |
| `GET/POST/PATCH/DELETE` | `/api/v1/memories` | Memory CRUD |
| `GET/POST/DELETE` | `/api/v1/relations` | Entity relation CRUD |
| `POST` | `/api/v1/lifecycle/run` | Trigger lifecycle engine |
| `GET` | `/api/v1/lifecycle/preview` | Dry-run preview |
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/stats` | Memory statistics |
| `GET/PATCH` | `/api/v1/config` | Configuration |

## MCP (Claude Desktop / Cursor)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["tsx", "/path/to/cortex/packages/mcp-client/src/index.ts"]
    }
  }
}
```

Available tools: `cortex_recall`, `cortex_remember`, `cortex_forget`, `cortex_search_debug`, `cortex_stats`

## OpenClaw Bridge Plugin

The bridge plugin (~130 lines) transparently integrates Cortex with OpenClaw:

- **Before response**: Searches relevant memories, injects as context
- **After response**: Fire-and-forget ingestion for memory extraction
- **Before compaction**: Emergency flush to preserve context

Set `CORTEX_URL=http://localhost:21100` in your OpenClaw environment.

## Configuration

Minimal (just needs `OPENAI_API_KEY`):
```json
{ "cortex": { "enabled": true } }
```

See `DESIGN.md` for full configuration options including offline mode, Qdrant/Milvus backends, and custom LLM providers.

## Memory Model

| Layer | TTL | Purpose | Analogy |
|-------|-----|---------|---------|
| **Working** | 48h | Recent conversation context | Short-term memory |
| **Core** | Permanent | Key facts, preferences, decisions | Long-term memory |
| **Archive** | 90d → compressed to Core | Low-frequency items | Distant memory |

Memories flow: Working → (promote) → Core → (demote) → Archive → (compress) → Core summary

**Nothing is ever truly lost.** Archive memories are compressed into summaries that live permanently in Core.

## Project Structure

```
cortex/
├── packages/
│   ├── server/          # Core service (Fastify + SQLite)
│   ├── bridge-openclaw/ # OpenClaw bridge plugin
│   ├── dashboard/       # React management SPA
│   └── mcp-client/      # MCP stdio adapter
├── docker-compose.yml
└── DESIGN.md            # Full technical design document
```

## Cost

With default settings (gpt-4o-mini + text-embedding-3-small):
- ~$0.55/month at 50 conversations/day
- Scales linearly; even 3x usage stays under $2/month

## License

MIT
