# 🧠 Cortex — Universal AI Agent Memory Service

**English** | [中文](./README.zh-CN.md)

Cortex gives your AI agent **persistent memory**. It runs alongside your agent as a sidecar, automatically remembering conversations, extracting key facts, and recalling relevant context when needed.

> **Your AI remembers what you told it last week, last month, or last year — across sessions, across devices.**

---

## 30-Second Setup

**Prerequisites**: Node.js ≥ 20, an OpenAI API key (for LLM + embedding)

```bash
git clone https://github.com/rikouu/cortex.git
cd cortex && pnpm install
cp .env.example .env        # add your OPENAI_API_KEY
pnpm dev                     # running at http://localhost:21100
```

Or with Docker (one line):

```bash
OPENAI_API_KEY=sk-xxx docker compose up -d
```

Open http://localhost:21100 — you'll see the management dashboard.

---

## Connect Your AI

Choose your setup. Each takes under 2 minutes.

### Option A: Claude Desktop

1. Open Claude Desktop → **Settings** → **Developer** → **Edit Config**
2. Paste this, save, then **fully quit and restart** Claude Desktop:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-mcp", "--server-url", "http://localhost:21100"],
      "env": {
        "CORTEX_AGENT_ID": "default"
      }
    }
  }
}
```

3. Start a new conversation and say: *"What do you remember about me?"*

### Option B: Cursor

1. Open Cursor → **Settings** → **MCP** → **+ Add new global MCP server**
2. Paste this and save:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-mcp"],
      "env": {
        "CORTEX_URL": "http://localhost:21100",
        "CORTEX_AGENT_ID": "default"
      }
    }
  }
}
```

### Option C: Claude Code

Run this in your terminal:

```bash
claude mcp add cortex -- npx cortex-mcp --server-url http://localhost:21100
```

### Option D: OpenClaw

```bash
openclaw plugins install @cortexmem/bridge-openclaw
```

Add to your `.env`:

```
CORTEX_URL=http://localhost:21100
```

That's it. The plugin automatically recalls memories before responses and saves new ones after — zero code needed.

### Option E: Any App (REST API)

```bash
# Store a memory
curl -X POST http://localhost:21100/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"user_message":"I love sushi","assistant_message":"Got it!","agent_id":"default"}'

# Recall memories
curl -X POST http://localhost:21100/api/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"What food do I like?","agent_id":"default"}'
```

### Verify It Works

Tell your AI something memorable (e.g., *"My favorite color is blue"*). Then start a **new conversation** and ask *"What's my favorite color?"*. If it answers correctly, Cortex is working.

---

## How It Works

Cortex uses a three-layer memory model inspired by how human memory works:

```
Conversations → [Working Memory] → [Core Memory] → [Archive]
                   48 hours          permanent       90 days
                                                  ↓ compressed
                                              back to Core
```

| Layer | TTL | What it stores | Analogy |
|-------|-----|----------------|---------|
| **Working** | 48h | Recent conversation context | Short-term memory |
| **Core** | Permanent | Key facts, preferences, decisions | Long-term memory |
| **Archive** | 90d → compressed to Core | Low-frequency items | Distant memory |

**Nothing is ever truly lost.** Archived memories are compressed into summaries that live permanently in Core.

### Memory Lifecycle

The lifecycle engine runs automatically (configurable schedule) and handles:

- **Promotion**: Important working memories → Core
- **Merging**: Duplicate/similar Core memories → single enriched entry
- **Archival**: Decayed Core memories → Archive
- **Compression**: Old Archive entries → compressed Core summaries

---

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

### Search

Cortex uses **hybrid search** — combining BM25 full-text search (exact keyword matching) with vector semantic search (conceptual similarity). Results are fused using Reciprocal Rank Fusion (RRF) and weighted by layer priority, recency, and access frequency.

### MCP Tools

When connected via MCP, the AI automatically gets these tools:

| Tool | What it does |
|------|-------------|
| `cortex_recall` | Search memories for relevant context |
| `cortex_remember` | Store an important fact or decision |
| `cortex_forget` | Remove or correct a memory |
| `cortex_search_debug` | Debug search scoring details |
| `cortex_stats` | Get memory statistics |

### OpenClaw Bridge Hooks

The [`@cortexmem/bridge-openclaw`](https://www.npmjs.com/package/@cortexmem/bridge-openclaw) plugin provides three automatic hooks:

| Hook | When | What it does |
|------|------|-------------|
| `onBeforeResponse` | Before AI responds | Recalls relevant memories, injects as context |
| `onAfterResponse` | After AI responds | Extracts and saves memories (fire-and-forget) |
| `onBeforeCompaction` | Before context compression | Emergency saves key info before it's lost |

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/recall` | Search memories and get injection context |
| `POST` | `/api/v1/ingest` | Ingest conversation for memory extraction |
| `POST` | `/api/v1/flush` | Emergency flush before compaction |
| `POST` | `/api/v1/search` | Hybrid search with debug info |
| `GET/POST/PATCH/DELETE` | `/api/v1/memories` | Memory CRUD |
| `GET/POST/DELETE` | `/api/v1/relations` | Entity relation CRUD |
| `GET/POST/PATCH/DELETE` | `/api/v1/agents` | Agent management |
| `GET` | `/api/v1/agents/:id/config` | Agent merged configuration |
| `POST` | `/api/v1/lifecycle/run` | Trigger lifecycle engine |
| `GET` | `/api/v1/lifecycle/preview` | Dry-run preview |
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/stats` | Memory statistics |
| `GET/PATCH` | `/api/v1/config` | Configuration |

---

## Configuration

Cortex works out of the box with just an `OPENAI_API_KEY`. For advanced setups:

| Option | Description |
|--------|-------------|
| **LLM Provider** | OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama (local) |
| **Embedding Provider** | OpenAI, Google, Voyage AI, Ollama (local) |
| **Vector Backend** | SQLite vec0 (default), Qdrant, Milvus |
| **Per-Agent Config** | Each agent can override global LLM/embedding settings |
| **Offline Mode** | Use Ollama for fully local, no-API-key setup |

See `DESIGN.md` for full configuration options.

---

## Project Structure

```
cortex/
├── packages/
│   ├── server/          # Core service (Fastify + SQLite)
│   ├── mcp-client/      # MCP stdio adapter (npm: @cortex/mcp-client)
│   ├── bridge-openclaw/ # OpenClaw plugin (npm: @cortexmem/bridge-openclaw)
│   └── dashboard/       # React management SPA
├── docker-compose.yml
└── DESIGN.md            # Full technical design document
```

## Cost

With default settings (gpt-4o-mini + text-embedding-3-small):
- ~$0.55/month at 50 conversations/day
- Scales linearly; even 3x usage stays under $2/month

## License

MIT
