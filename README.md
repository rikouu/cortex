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

### Option D: Other MCP Clients

For any MCP-compatible app (Windsurf, Cline, etc.), add this to your client's MCP config file:

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

Check your client's documentation for the exact config file location.

### Option E: OpenClaw

```bash
openclaw plugins install @cortexmem/cortex-bridge
```

Then set the Cortex server address. Pick **one** of the two methods:

**Method A — `.env` file (recommended)**

Add this line to your project's `.env` file. The plugin reads it automatically on startup:

```
CORTEX_URL=http://localhost:21100
```

**Method B — Shell profile**

If you don't use `.env` files, add to your shell config instead:

```bash
echo 'export CORTEX_URL=http://localhost:21100' >> ~/.zshrc
```

Then restart your terminal or run `source ~/.zshrc` to apply.

The plugin automatically recalls memories before each response. Auto-saving after responses has a known upstream issue in streaming mode — see [Known Issues](#known-issues) below.

### Option F: Any App (REST API)

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

### Memory Categories

Cortex classifies memories into 20 categories across three attribution tracks, each with a tuned importance and decay rate:

**User memories** — facts about the user:

| Category | Description | Importance |
|----------|-------------|------------|
| `identity` | Name, profession, role, location | 0.9-1.0 |
| `preference` | Tools, workflows, styles, habits | 0.8-0.9 |
| `correction` | Updates to previously known info | 0.9-1.0 |
| `skill` | Expertise, proficiency, tech stack | 0.8-0.9 |
| `relationship` | Colleagues, friends, organizations | 0.8-0.9 |
| `goal` | Objectives, plans, milestones | 0.7-0.9 |
| `decision` | Concrete choices committed to | 0.8-0.9 |
| `entity` | Named tools, projects, organizations | 0.6-0.8 |
| `project_state` | Project progress, status changes | 0.5-0.7 |
| `insight` | Lessons learned, experience-based wisdom | 0.5-0.7 |
| `fact` | Factual knowledge about the user | 0.5-0.8 |
| `todo` | Action items, follow-ups | 0.6-0.8 |

**Operational** — rules and strategies:

| Category | Description | Importance |
|----------|-------------|------------|
| `constraint` | Hard rules that must never be violated ("never do X") | 0.9-1.0 |
| `policy` | Default execution strategies ("prefer X before Y") | 0.7-0.9 |

**Agent growth** — the agent's own learning:

| Category | Description | Importance |
|----------|-------------|------------|
| `agent_persona` | Agent's own character, tone, personality | 0.8-1.0 |
| `agent_relationship` | Interaction dynamics, rapport, trust | 0.8-0.9 |
| `agent_user_habit` | Observations about user patterns and rhythms | 0.7-0.9 |
| `agent_self_improvement` | Behavioral improvements, mistakes noticed | 0.7-0.9 |

**System** (internal use):

| Category | Description | Importance |
|----------|-------------|------------|
| `context` | Session context | 0.2 |
| `summary` | Compressed summaries | 0.4 |

### Memory Sieve (Extraction)

The Memory Sieve uses a **dual-channel extraction** pipeline with **three-track attribution**:

1. **Fast Channel** — Regex-based pattern matching (Chinese/English/Japanese) detects high-signal information with zero LLM latency
2. **Deep Channel** — LLM-powered structured extraction outputs categorized JSON with importance scores, reasoning, and source attribution

**Three-track attribution** routes memories to the right category:
- **User track** — user-stated facts, preferences, decisions
- **Operational track** — constraints and policies set by the user or system
- **Agent track** — the agent's own reflections, observations, and persona

Both channels run in parallel. Results are cross-deduplicated using vector similarity. Memories with importance ≥ 0.8 go directly to Core; lower-importance items go to Working with a TTL.

The Sieve also supports **user profile injection** — a synthesized profile of the user's Core memories is injected into the extraction prompt, helping the LLM avoid re-extracting known facts and better identify incremental new information.

### Memory Lifecycle

The lifecycle engine runs automatically (configurable schedule) and handles:

- **Promotion**: Important working memories → Core
- **Merging**: Duplicate/similar Core memories → single enriched entry
- **Archival**: Decayed Core memories → Archive
- **Compression**: Old Archive entries → compressed Core summaries
- **Profile Synthesis**: Auto-generates user profiles from Core memories

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

**Priority injection**: When formatting results for context injection, `constraint` and `agent_persona` memories are injected first to ensure critical rules and persona are never truncated by the token budget.

### MCP Tools

When connected via MCP, the AI automatically gets these tools:

| Tool | What it does |
|------|-------------|
| `cortex_recall` | Search memories with priority injection (constraints and persona first) |
| `cortex_remember` | Store a memory: user facts, constraints, policies, or agent self-observations |
| `cortex_forget` | Remove or correct a memory |
| `cortex_search_debug` | Debug search scoring details |
| `cortex_stats` | Get memory statistics |

### OpenClaw Bridge Hooks

The [`@cortexmem/cortex-bridge`](https://www.npmjs.com/package/@cortexmem/cortex-bridge) plugin provides three automatic hooks:

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
| `GET` | `/api/v1/extraction-logs` | Extraction quality audit logs |
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
│   ├── cortex-bridge/   # OpenClaw plugin (npm: @cortexmem/cortex-bridge)
│   └── dashboard/       # React management SPA
├── docker-compose.yml
└── DESIGN.md            # Full technical design document
```

## Cost

With default settings (gpt-4o-mini + text-embedding-3-small):
- ~$0.55/month at 50 conversations/day
- Scales linearly; even 3x usage stays under $2/month

## Known Issues

### OpenClaw: `agent_end` hook not firing in streaming mode

**Upstream bug:** [openclaw/openclaw#21863](https://github.com/openclaw/openclaw/issues/21863)

In OpenClaw's streaming mode (used by Telegram and other gateway channels), the `agent_end` hook is not dispatched to plugins. This means the Cortex bridge plugin **cannot automatically save conversations** in streaming mode. Memory recall (`before_agent_start`) works correctly.

**Workarounds:**
- Add a system prompt instruction telling the Agent to call `cortex_ingest` after meaningful conversations
- Use `cortex_remember` tool for the Agent to save specific facts during conversation
- Use a non-streaming channel where the hook fires correctly

## License

MIT
