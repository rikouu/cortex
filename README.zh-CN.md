# 🧠 Cortex — 通用 AI Agent 记忆服务

[English](./README.md) | **中文**

Cortex 让你的 AI 拥有**持久记忆**。它以 Sidecar 进程运行在 Agent 旁边，自动记住对话内容、提取关键事实，并在需要时召回相关上下文。

> **你的 AI 能记住你上周、上个月、甚至去年告诉它的事情 — 跨会话、跨设备。**

---

## 30 秒上手

**前提条件**：Node.js ≥ 20，一个 OpenAI API Key（用于 LLM + Embedding）

```bash
git clone https://github.com/rikouu/cortex.git
cd cortex && pnpm install
cp .env.example .env        # 填入你的 OPENAI_API_KEY
pnpm dev                     # 运行在 http://localhost:21100
```

或者用 Docker（一行命令）：

```bash
OPENAI_API_KEY=sk-xxx docker compose up -d
```

打开 http://localhost:21100 — 你会看到管理面板。

---

## 连接你的 AI

选择你的方式，每种都不超过 2 分钟。

### 方式 A：Claude Desktop

1. 打开 Claude Desktop → **设置** → **开发者** → **编辑配置**
2. 粘贴以下内容，保存，然后**从菜单栏完全退出并重启** Claude Desktop：

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

3. 开始新对话，对 AI 说：*"你还记得关于我的什么？"*

### 方式 B：Cursor

1. 打开 Cursor → **设置** → **MCP** → **+ 添加新的全局 MCP 服务器**
2. 粘贴以下内容并保存：

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

### 方式 C：Claude Code

在终端运行：

```bash
claude mcp add cortex -- npx cortex-mcp --server-url http://localhost:21100
```

### 方式 D：OpenClaw

```bash
openclaw plugins install @cortexmem/bridge-openclaw
```

在 `.env` 中添加：

```
CORTEX_URL=http://localhost:21100
```

搞定。插件会自动在回复前召回记忆、回复后保存新记忆 — 不需要写任何代码。

### 方式 E：任意应用（REST API）

```bash
# 存储记忆
curl -X POST http://localhost:21100/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"user_message":"我喜欢吃寿司","assistant_message":"记住了！","agent_id":"default"}'

# 检索记忆
curl -X POST http://localhost:21100/api/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"我喜欢吃什么？","agent_id":"default"}'
```

### 验证是否生效

告诉你的 AI 一些值得记住的信息（比如 *"我最喜欢的颜色是蓝色"*）。然后开一个**新对话**，问 *"我最喜欢什么颜色？"*。如果回答正确，说明 Cortex 已经在工作了。

---

## 工作原理

Cortex 使用三层记忆模型，灵感来源于人类记忆的运作方式：

```
对话 → [工作记忆] → [核心记忆] → [归档记忆]
          48 小时       永久        90 天
                                  ↓ 压缩
                              回流到核心层
```

| 层级 | 存活时间 | 存储内容 | 类比 |
|------|---------|---------|------|
| **Working** | 48小时 | 近期对话上下文 | 短期记忆 |
| **Core** | 永久 | 关键事实、偏好、决策 | 长期记忆 |
| **Archive** | 90天 → 压缩回流至 Core | 低频访问条目 | 远期记忆 |

**记忆永不真正丢失。** 归档记忆会被压缩为摘要，永久保留在核心层中。

### 记忆生命周期

生命周期引擎自动运行（可配置调度计划），负责：

- **晋升**：重要的工作记忆 → 核心层
- **合并**：重复/相似的核心记忆 → 合并为一条丰富条目
- **归档**：衰减的核心记忆 → 归档层
- **压缩**：过期的归档条目 → 压缩为核心层摘要

---

## 架构

```
┌─ 客户端层 ─────────────────────────────────────────────┐
│  OpenClaw（桥接）│ Claude Desktop（MCP）│ 任意客户端（REST）│
└──────────────────┼──────────────────────┼───────────────┘
                   ▼                      ▼
┌─ Cortex Server (:21100) ───────────────────────────────┐
│  REST API │ MCP Server │ 管理面板                       │
│  Memory Gate（检索）│ Memory Sieve（提取）               │
│  Memory Flush+（刷新）│ Lifecycle Engine（生命周期）     │
│  SQLite + FTS5 │ 向量后端 │ Markdown 导出器             │
└─────────────────────────────────────────────────────────┘
```

### 搜索

Cortex 使用**混合搜索** — 将 BM25 全文检索（精确关键词匹配）与向量语义搜索（概念相似性）结合。结果通过 RRF（倒排排名融合）融合，并按层级优先级、新近度和访问频率加权。

### MCP 工具

通过 MCP 连接后，AI 自动获得这些工具：

| 工具 | 功能 |
|------|------|
| `cortex_recall` | 搜索相关记忆上下文 |
| `cortex_remember` | 存储重要事实或决策 |
| `cortex_forget` | 删除或修正记忆 |
| `cortex_search_debug` | 调试搜索评分详情 |
| `cortex_stats` | 获取记忆统计 |

### OpenClaw 桥接 Hook

[`@cortexmem/bridge-openclaw`](https://www.npmjs.com/package/@cortexmem/bridge-openclaw) 插件提供三个自动 Hook：

| Hook | 触发时机 | 功能 |
|------|---------|------|
| `onBeforeResponse` | AI 回复前 | 召回相关记忆，注入为上下文 |
| `onAfterResponse` | AI 回复后 | 提取并保存记忆（即发即忘） |
| `onBeforeCompaction` | 上下文压缩前 | 紧急保存关键信息，防止丢失 |

---

## API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/recall` | 搜索相关记忆，返回注入上下文 |
| `POST` | `/api/v1/ingest` | 摄入对话，自动提取记忆 |
| `POST` | `/api/v1/flush` | 紧急刷新（Compaction 前保护上下文） |
| `POST` | `/api/v1/search` | 混合搜索（支持调试信息） |
| `GET/POST/PATCH/DELETE` | `/api/v1/memories` | 记忆 CRUD |
| `GET/POST/DELETE` | `/api/v1/relations` | 实体关系 CRUD |
| `GET/POST/PATCH/DELETE` | `/api/v1/agents` | 智能体管理 |
| `GET` | `/api/v1/agents/:id/config` | 智能体合并配置 |
| `POST` | `/api/v1/lifecycle/run` | 手动触发生命周期引擎 |
| `GET` | `/api/v1/lifecycle/preview` | 预览（dry-run） |
| `GET` | `/api/v1/health` | 健康检查 |
| `GET` | `/api/v1/stats` | 记忆统计 |
| `GET/PATCH` | `/api/v1/config` | 配置管理 |

---

## 配置

Cortex 只需一个 `OPENAI_API_KEY` 即可开箱即用。进阶配置：

| 选项 | 说明 |
|------|------|
| **LLM 提供商** | OpenAI、Anthropic、Google Gemini、OpenRouter、Ollama（本地） |
| **Embedding 提供商** | OpenAI、Google、Voyage AI、Ollama（本地） |
| **向量后端** | SQLite vec0（默认）、Qdrant、Milvus |
| **智能体独立配置** | 每个智能体可覆盖全局 LLM/Embedding 设置 |
| **离线模式** | 使用 Ollama 实现完全本地化，无需 API Key |

完整配置选项请参考 `DESIGN.md`。

---

## 项目结构

```
cortex/
├── packages/
│   ├── server/          # 核心服务（Fastify + SQLite）
│   ├── mcp-client/      # MCP stdio 适配器（npm: @cortex/mcp-client）
│   ├── bridge-openclaw/ # OpenClaw 插件（npm: @cortexmem/bridge-openclaw）
│   └── dashboard/       # React 管理面板
├── docker-compose.yml
└── DESIGN.md            # 完整技术设计文档
```

## 成本

使用默认配置（gpt-4o-mini + text-embedding-3-small）：
- 每天 50 轮对话约 **$0.55/月**
- 线性增长，3 倍使用量也不到 $2/月

## 开源协议

MIT
