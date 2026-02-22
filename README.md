# 🧠 Cortex — Universal AI Agent Memory Service

**English** | [中文](./README.zh-CN.md)

Cortex gives your AI agent **persistent memory**. It runs alongside your agent as a sidecar, automatically remembering conversations, extracting key facts, and recalling relevant context when needed.

> **Your AI remembers what you told it last week, last month, or last year — across sessions, across devices.**

---

## Features

- **Three-layer memory** — Working (48h) → Core (permanent) → Archive (90d, compressed back to Core)
- **Dual-channel extraction** — Fast regex + deep LLM extraction run in parallel
- **20 memory categories** — Identity, preferences, constraints, agent persona, and more
- **Hybrid search** — BM25 keyword + vector semantic search with RRF fusion
- **Query expansion** — LLM-generated search variants for better recall (optional)
- **LLM reranker** — Re-score results with LLM for improved relevance (optional)
- **Entity relations** — Auto-extracted knowledge graph (who uses what, who knows whom)
- **Smart dedup** — Three-tier matching prevents duplicate memories
- **Multi-provider** — OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Ollama
- **Multi-agent** — Per-agent config overrides, isolated memory namespaces
- **Dashboard** — Full management UI with search debug, lifecycle preview, extraction logs
- **Zero config** — Works out of the box with just an OpenAI API key

---

## 30-Second Setup

**Prerequisites**: Node.js ≥ 20, an OpenAI API key (or any [supported provider](#supported-providers))

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

### Option A: Claude Desktop (MCP)

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

### Option B: Cursor (MCP)

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

### Option C: Claude Code (MCP)

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

See the full step-by-step guide: **[OpenClaw Quick Start](#openclaw-quick-start)**.

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

## OpenClaw Quick Start

A complete beginner-friendly guide for adding persistent memory to your OpenClaw agent.

### What You'll Get

After following these steps, your OpenClaw agent will:
- Automatically **recall** relevant memories before every response
- Automatically **save** important facts from conversations
- **Emergency save** key info before context compression
- Have `cortex_recall` and `cortex_remember` tools available for on-demand use

### Step 1: Start Cortex

If you haven't already, get Cortex running first:

```bash
# Option A: From source
git clone https://github.com/rikouu/cortex.git
cd cortex && pnpm install
cp .env.example .env     # add your OPENAI_API_KEY
pnpm dev

# Option B: Docker (one line)
OPENAI_API_KEY=sk-xxx docker compose up -d
```

Verify it's running:
```bash
curl http://localhost:21100/api/v1/health
# Should return: {"status":"ok", ...}
```

### Step 2: Install the Plugin

```bash
openclaw plugins install @cortexmem/cortex-bridge
```

That's it — no config files, no manual setup.

### Step 3: Tell the Plugin Where Cortex Is

Pick **one** of the two methods:

**Method A — `.env` file (recommended)**

Add this line to your project's `.env` file:

```
CORTEX_URL=http://localhost:21100
```

**Method B — Shell profile**

```bash
echo 'export CORTEX_URL=http://localhost:21100' >> ~/.zshrc
source ~/.zshrc
```

### Step 4: Test It

1. Start a conversation with your agent and say something memorable:
   > *"My favorite programming language is Rust and I work at Acme Corp."*

2. Start a **new conversation** and ask:
   > *"What do you know about me?"*

3. If the agent mentions Rust and Acme Corp, everything is working!

You can also type `/cortex-status` in OpenClaw to check the connection.

### What Happens Under the Hood

The plugin uses OpenClaw's `register(api)` interface to automatically set up:

| Hook | When | What it does |
|------|------|-------------|
| `onBeforeResponse` | Before AI responds | Recalls relevant memories and injects them as context |
| `onAfterResponse` | After AI responds | Extracts and saves important information (fire-and-forget) |
| `onBeforeCompaction` | Before context compression | Emergency saves key info before it's lost |

Two tools are also registered:

| Tool | What it does |
|------|-------------|
| `cortex_recall` | Agent can search memories on demand |
| `cortex_remember` | Agent can store important facts explicitly |

### Deploying for Production

For a persistent setup (server + OpenClaw agent always running):

```bash
# 1. Run Cortex with Docker (auto-restarts, data persisted)
OPENAI_API_KEY=sk-xxx docker compose up -d

# 2. Optional: set auth token for security
echo 'CORTEX_AUTH_TOKEN=your-secret-token' >> .env
docker compose up -d  # restart to apply

# 3. In your OpenClaw project, set the URL
echo 'CORTEX_URL=http://your-server-ip:21100' >> .env
```

> **Tip:** If running Cortex and OpenClaw on the same machine, use `http://localhost:21100`. If on different machines, replace with your server's IP or domain.

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Agent doesn't recall memories | Check `curl http://localhost:21100/api/v1/health` returns OK |
| Plugin not loading | Run `openclaw plugins list` to verify `@cortexmem/cortex-bridge` is installed |
| Memories not saving after responses | Known upstream issue in streaming mode — see [Known Issues](#known-issues) |
| Connection refused | Make sure `CORTEX_URL` is set and Cortex is running |

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

**Query Expansion** (optional): Before searching, the LLM generates 2-3 variant queries using synonyms and rephrasings. Each variant is searched separately, and results are merged by highest score. This significantly improves recall for vague or loosely-worded queries. Enable in Dashboard → Gate → Query Expansion.

**LLM Reranker** (optional): After initial search, results are re-scored by the LLM for query-specific relevance. Supports two providers: `llm` (uses the extraction model) and `cohere` (Cohere Rerank API). Enable in Dashboard → Search → Reranker.

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

---

## Supported Providers

### LLM Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | gpt-4o-mini, gpt-4.1-nano/mini, gpt-4o, o3/o4-mini | Default. Best cost-performance ratio |
| **Anthropic** | claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-5 | Highest extraction quality |
| **Google Gemini** | gemini-2.5-flash/pro, gemini-2.0-flash | Free tier available on AI Studio |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | Cheapest. OpenAI-compatible API |
| **OpenRouter** | 100+ models from all providers | Unified gateway |
| **Ollama** | qwen2.5, llama3.2, mistral, deepseek-r1, etc. | Fully local, no API key |

### Embedding Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | text-embedding-3-small/large | Default (1536d). Most reliable |
| **Google Gemini** | gemini-embedding-001, text-embedding-004 | Free on AI Studio |
| **Voyage AI** | voyage-3, voyage-3-lite, voyage-code-3 | High quality |
| **Ollama** | bge-m3, nomic-embed-text, mxbai-embed-large | Local, zero cost |

All providers are configurable via the Dashboard UI or `cortex.json`. See `cortex-provider-reference.md` for detailed model comparisons and pricing.

> **Warning: Changing embedding models**
>
> Each embedding model produces vectors of a specific dimension. If you switch to a model with different dimensions, **all existing vectors become incompatible**. After changing the embedding model or dimensions:
> 1. Go to Dashboard → Settings → Data Management → **Reindex Vectors**
> 2. This regenerates all vectors using the new model (requires API calls for every stored memory)
> 3. Until reindexed, vector search (recall, dedup, smart update) will not work correctly

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
| **LLM Provider** | OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Ollama |
| **Embedding Provider** | OpenAI, Google, Voyage AI, Ollama |
| **Vector Backend** | SQLite vec0 (default), Qdrant, Milvus |
| **Per-Agent Config** | Each agent can override global LLM/embedding settings |
| **Offline Mode** | Use Ollama for fully local, no-API-key setup |

See `DESIGN.md` for full configuration options and `cortex-provider-reference.md` for provider selection guide.

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
├── DESIGN.md            # Full technical design document
└── cortex-provider-reference.md  # LLM/Embedding provider guide
```

## Cost

With default settings (gpt-4o-mini + text-embedding-3-small):
- ~$0.55/month at 50 conversations/day
- Scales linearly; even 3x usage stays under $2/month
- With DeepSeek + Google Embedding: as low as ~$0.10/month

## Known Issues

### ~~OpenClaw: `agent_end` hook not firing in streaming mode~~ (Fixed)

~~**Upstream bug:** [openclaw/openclaw#21863](https://github.com/openclaw/openclaw/issues/21863)~~

**Resolved** — Fixed upstream in commit `72d1d36`. The `agent_end` hook now fires correctly in streaming mode. Automatic memory extraction works in all modes.

## License

MIT
