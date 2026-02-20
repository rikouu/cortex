# 🧠 Cortex — 通用 AI Agent 记忆服务

[English](./README.md) | **中文**

Cortex 是一个独立的 AI Agent 记忆服务。它以 Sidecar 进程运行，通过 REST API、MCP 和框架专用桥接插件，为任何 Agent 提供持久化、可检索、有生命周期的记忆能力。

## 特性

- **三层记忆模型**：Working（48小时）→ Core（永久）→ Archive（90天，压缩回流至 Core）
- **混合搜索**：BM25 全文检索（FTS5）+ 向量语义搜索，支持层级权重和衰减评分
- **高信号检测**：中/英/日三语正则模式匹配——关键信息无需 LLM 即可捕获
- **LLM 智能提取**：自动摘要和实体提取（默认 gpt-4o-mini）
- **生命周期引擎**：自动晋升、合并、降级、压缩——记忆永不真正丢失
- **多种接入方式**：REST API、MCP（Claude Desktop）、OpenClaw 桥接插件
- **向量后端可插拔**：SQLite vec0（默认，零配置）→ Qdrant → Milvus
- **管理面板**：React SPA，可视化浏览、编辑、搜索和监控记忆
- **Markdown 导出**：自动生成兼容 OpenClaw Bootstrap 的 MEMORY.md

## 快速开始

```bash
# 克隆
git clone https://github.com/rikouu/cortex.git
cd cortex

# 安装依赖
pnpm install

# 配置（需要 OpenAI API Key 用于 LLM + Embedding）
cp .env.example .env
# 编辑 .env，添加你的 OPENAI_API_KEY

# 启动
pnpm dev
# 服务运行在 http://localhost:21100
```

### Docker 部署

```bash
OPENAI_API_KEY=sk-xxx docker compose up -d
```

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

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/recall` | 搜索相关记忆，返回注入上下文 |
| `POST` | `/api/v1/ingest` | 摄入对话，自动提取记忆 |
| `POST` | `/api/v1/flush` | 紧急刷新（Compaction 前保护上下文） |
| `POST` | `/api/v1/search` | 混合搜索（支持调试信息） |
| `GET/POST/PATCH/DELETE` | `/api/v1/memories` | 记忆 CRUD |
| `GET/POST/DELETE` | `/api/v1/relations` | 实体关系 CRUD |
| `POST` | `/api/v1/lifecycle/run` | 手动触发生命周期引擎 |
| `GET` | `/api/v1/lifecycle/preview` | 预览（dry-run） |
| `GET` | `/api/v1/health` | 健康检查 |
| `GET` | `/api/v1/stats` | 记忆统计 |
| `GET/PATCH` | `/api/v1/config` | 配置管理 |

## MCP 接入（Claude Desktop / Cursor）

在 `claude_desktop_config.json` 中添加：

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

可用工具：`cortex_recall`（检索）、`cortex_remember`（记住）、`cortex_forget`（遗忘）、`cortex_search_debug`（搜索调试）、`cortex_stats`（统计）

## OpenClaw 桥接插件

通过 OpenClaw CLI 安装：

```bash
openclaw plugins install @cortexmem/bridge-openclaw
```

桥接插件透明集成 Cortex 与 OpenClaw：

- **响应前**：搜索相关记忆，注入为上下文
- **响应后**：异步摄入对话，提取记忆（不阻塞）
- **Compaction 前**：紧急刷新，保护即将被压缩的上下文

在 OpenClaw 环境变量中设置 `CORTEX_URL=http://localhost:21100`。

## 配置

最简配置（只需 `OPENAI_API_KEY`）：
```json
{ "cortex": { "enabled": true } }
```

完整配置选项（离线模式、Qdrant/Milvus 后端、自定义 LLM 等）请参考 `DESIGN.md`。

## 记忆模型

| 层级 | 存活时间 | 用途 | 类比 |
|------|---------|------|------|
| **Working** | 48小时 | 近期对话上下文 | 短期记忆 |
| **Core** | 永久 | 关键事实、偏好、决策 | 长期记忆 |
| **Archive** | 90天 → 压缩回流至 Core | 低频访问条目 | 远期记忆 |

记忆流转：Working →（晋升）→ Core →（降级）→ Archive →（压缩）→ Core 摘要

**记忆永不真正丢失。** Archive 过期后会被压缩为摘要，永久保留在 Core 中。

## 项目结构

```
cortex/
├── packages/
│   ├── server/          # 核心服务（Fastify + SQLite）
│   ├── bridge-openclaw/ # OpenClaw 桥接插件
│   ├── dashboard/       # React 管理面板
│   └── mcp-client/      # MCP stdio 适配器
├── docker-compose.yml
└── DESIGN.md            # 完整技术设计文档
```

## 成本

使用默认配置（gpt-4o-mini + text-embedding-3-small）：
- 每天50轮对话约 **$0.55/月**
- 线性增长，3倍使用量也不到 $2/月

## 开源协议

MIT
