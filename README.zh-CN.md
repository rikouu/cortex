# 🧠 Cortex — 给你的 AI 一个真正的记忆

[English](./README.md) | **中文**

你的 AI 每次对话结束就全忘了。明天问它今天说过的事——一脸茫然。

**Cortex 解决这个问题。** 它是一个记忆服务，静默运行在任何 AI Agent 旁边，默默学习你是谁、你在乎什么、你怎么工作。它记住你的名字、偏好、决策、项目——在需要时精准召回相关上下文。

> 把你的 AI 从金鱼升级成真正的私人助理。

```
"我叫小明，做后端开发，喜欢用 Rust 不喜欢 Go。"
                    ↓  Cortex 提取 & 存储
          [identity] 小明，后端开发
          [preference] 偏好 Rust 而非 Go

    ... 3 周后，新对话 ...

"这个新服务该用什么语言？"
                    ↓  Cortex 召回
    "你之前提到过做后端更偏好 Rust。"
```

---

## 工作原理

```
┌────────────────────────────────────────────────────────────┐
│                    写入路径（每轮对话）                       │
│                                                            │
│  对话 ──→ Fast Channel (正则, 0ms)                         │
│           + Deep Channel (LLM, 2-5s)                       │
│                          ↓                                 │
│                    提取的记忆                                │
│                          ↓                                 │
│              ┌─ 四层去重 ────────────────┐                 │
│              │ 完全重复 → 跳过           │                 │
│              │ 近似重复 → 自动替换       │                 │
│              │ 语义重叠 → LLM 判断       │                 │
│              │ 全新信息 → 插入           │                 │
│              └──────────────────────────┘                 │
│                          ↓                                 │
│              工作层 (48h) 或 核心层 (永久)                   │
├────────────────────────────────────────────────────────────┤
│                    读取路径（每轮对话）                       │
│                                                            │
│  用户消息 ──→ 查询扩展（可选）                               │
│                          ↓                                 │
│              BM25 + 向量 → RRF 融合                        │
│                          ↓                                 │
│              LLM 重排序（可选）                              │
│                          ↓                                 │
│              优先注入 → AI 上下文                            │
│              （约束和人设优先）                               │
├────────────────────────────────────────────────────────────┤
│                    生命周期（每天）                           │
│                                                            │
│  工作层 → 升级 → 核心层 → 衰减 → 归档层 → 压缩              │
│                                      ↓                     │
│                              回流核心层（永不丢失）           │
└────────────────────────────────────────────────────────────┘
```

---

## 特性

- **三层记忆** — 工作层（48h）→ 核心层（永久）→ 归档层（压缩回流核心层）
- **双通道提取** — 快速正则 + 深度 LLM，批量智能去重
- **20 种记忆分类** — 身份、偏好、约束、Agent 人设等
- **混合搜索** — BM25 + 向量，Reciprocal Rank Fusion 融合
- **查询扩展** — LLM 生成搜索变体，提高召回率
- **LLM 重排序** — 对搜索结果精排，提高相关性
- **实体关系** — 自动提取知识图谱
- **提取反馈** — 标记记忆好/坏/纠正，追踪提取质量
- **多提供商** — OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Ollama
- **多智能体** — 每个智能体独立配置，隔离的记忆命名空间
- **管理面板** — 完整管理 UI，含搜索调试、生命周期预览、提取日志
- **约 ¥4/月** — 使用 gpt-4o-mini + text-embedding-3-small，每天 50 次对话

---

## 30 秒上手

```bash
# 克隆并启动（Docker）
git clone https://github.com/rikouu/cortex.git
cd cortex
docker compose up -d
```

打开 **http://localhost:21100** → 管理面板 → **Settings** → 选择 LLM/Embedding 提供商，输入 API Key。

搞定。不需要 `.env` 文件，不需要环境变量。

<details>
<summary>或者从源码运行（不用 Docker）</summary>

```bash
git clone https://github.com/rikouu/cortex.git
cd cortex && pnpm install
pnpm dev    # http://localhost:21100
```

</details>

---

## 连接你的 AI

### 方式 A：OpenClaw 🔥

[OpenClaw](https://github.com/openclaw/openclaw) 是一个开源 AI Agent 框架，内置工具调用、记忆和多渠道支持。Cortex 有专门的桥接插件，无缝集成。

```bash
# 1. 安装桥接插件
openclaw plugins install @cortexmem/cortex-bridge

# 2. 设置 Cortex URL
echo 'CORTEX_URL=http://localhost:21100' >> .env
```

**完成。** 你的 Agent 现在会在每次回复前自动召回记忆，每轮对话后自动保存重要信息。

桥接插件挂接 OpenClaw 生命周期：

| 钩子 | 触发时机 | 功能 |
|------|---------|------|
| `onBeforeResponse` | AI 回复前 | 召回 & 注入相关记忆 |
| `onAfterResponse` | AI 回复后 | 提取 & 保存关键信息 |
| `onBeforeCompaction` | 上下文压缩前 | 紧急保存即将丢失的信息 |

另有 `cortex_recall` 和 `cortex_remember` 工具供按需使用。

完整指南：**[OpenClaw 快速开始](#openclaw-快速开始)**。

### 方式 B：Claude Desktop（MCP）

打开 **Settings** → **Developer** → **Edit Config**，粘贴后重启：

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-mcp", "--server-url", "http://localhost:21100"]
    }
  }
}
```

### 方式 C：Cursor / Claude Code / 其他 MCP 客户端

<details>
<summary>Cursor</summary>

**Settings** → **MCP** → **+ Add new global MCP server**：

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-mcp"],
      "env": { "CORTEX_URL": "http://localhost:21100" }
    }
  }
}
```

</details>

<details>
<summary>Claude Code</summary>

```bash
claude mcp add cortex -- npx cortex-mcp --server-url http://localhost:21100
```

</details>

<details>
<summary>Windsurf / Cline / 其他</summary>

添加到你的 MCP 客户端配置：

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-mcp", "--server-url", "http://localhost:21100"],
      "env": { "CORTEX_AGENT_ID": "default" }
    }
  }
}
```

</details>

### 方式 D：任意应用（REST API）

```bash
# 存储记忆
curl -X POST http://localhost:21100/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{"user_message":"我喜欢吃寿司","assistant_message":"记住了！","agent_id":"default"}'

# 召回记忆
curl -X POST http://localhost:21100/api/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"我喜欢吃什么？","agent_id":"default"}'
```

### 验证是否生效

告诉你的 AI 一些事情（例如 *"我最喜欢的颜色是蓝色"*）。开一个**新对话**，问 *"我最喜欢什么颜色？"*。如果回答正确，Cortex 就在正常工作了。

## OpenClaw 快速开始

一份面向新手的完整教程，让你的 OpenClaw 智能体拥有持久记忆。

### 你将获得什么

完成以下步骤后，你的 OpenClaw 智能体将：
- 每次回复前自动**召回**相关记忆
- 对话结束后自动**保存**重要信息
- 上下文压缩前**紧急保存**关键信息
- 可随时使用 `cortex_recall` 和 `cortex_remember` 工具

### 第 1 步：启动 Cortex

如果还没有运行 Cortex，先启动它：

```bash
# 方式 A：从源码运行
git clone https://github.com/rikouu/cortex.git
cd cortex && pnpm install
cp .env.example .env     # 填入你的 OPENAI_API_KEY
pnpm dev

# 方式 B：Docker（一行命令）
OPENAI_API_KEY=sk-xxx docker compose up -d
```

验证是否在运行：
```bash
curl http://localhost:21100/api/v1/health
# 应返回：{"status":"ok", ...}
```

### 第 2 步：安装插件

```bash
openclaw plugins install @cortexmem/cortex-bridge
```

就这样，不需要配置文件，不需要手动设置。

### 第 3 步：告诉插件 Cortex 在哪里

以下两种方式选**其一**：

**方式 A — `.env` 文件（推荐）**

把这行加到你项目的 `.env` 文件中：

```
CORTEX_URL=http://localhost:21100
```

**方式 B — Shell 配置文件**

```bash
echo 'export CORTEX_URL=http://localhost:21100' >> ~/.zshrc
source ~/.zshrc
```

### 第 4 步：测试一下

1. 和你的智能体聊天，告诉它一些值得记住的信息：
   > *"我最喜欢的编程语言是 Rust，我在 Acme 公司工作。"*

2. 开一个**新对话**，问：
   > *"你知道关于我的什么？"*

3. 如果智能体提到了 Rust 和 Acme，一切就绑好了！

你也可以在 OpenClaw 里输入 `/cortex-status` 检查连接状态。

### 背后发生了什么

插件通过 OpenClaw 的 `register(api)` 接口自动注册：

| Hook | 触发时机 | 功能 |
|------|---------|------|
| `onBeforeResponse` | AI 回复前 | 召回相关记忆，注入为上下文 |
| `onAfterResponse` | AI 回复后 | 提取并保存重要信息（即发即忘） |
| `onBeforeCompaction` | 上下文压缩前 | 紧急保存关键信息，防止丢失 |

还注册了两个工具：

| 工具 | 功能 |
|------|------|
| `cortex_recall` | 智能体可以按需搜索记忆 |
| `cortex_remember` | 智能体可以主动存储重要事实 |

### 生产环境部署

让 Cortex 和 OpenClaw 智能体持久运行：

```bash
# 1. 用 Docker 运行 Cortex（自动重启，数据持久化）
OPENAI_API_KEY=sk-xxx docker compose up -d

# 2. 可选：设置 auth token 增强安全性
echo 'CORTEX_AUTH_TOKEN=your-secret-token' >> .env
docker compose up -d  # 重启使其生效

# 3. 在你的 OpenClaw 项目中设置 URL
echo 'CORTEX_URL=http://your-server-ip:21100' >> .env
```

> **提示：** 如果 Cortex 和 OpenClaw 在同一台机器上，使用 `http://localhost:21100`。如果在不同机器上，替换为你的服务器 IP 或域名。

### 常见问题排查

| 问题 | 解决方案 |
|------|---------|
| 智能体不召回记忆 | 检查 `curl http://localhost:21100/api/v1/health` 是否返回 OK |
| 插件没有加载 | 运行 `openclaw plugins list` 确认 `@cortexmem/cortex-bridge` 已安装 |
| 回复后不保存记忆 | streaming 模式下的已知上游问题 — 见[已知问题](#已知问题) |
| 连接被拒绝 | 确认 `CORTEX_URL` 已设置且 Cortex 正在运行 |

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

### 搜索（召回流程）

AI 收到消息时的完整召回流程：

```
用户消息
  │
  ▼
清理查询（去除系统标签、metadata）
  │
  ▼
闲聊检测 ──是──→ 跳过（不搜索）
  │否
  ▼
┌─ 查询扩展（1次LLM调用）──────────────┐
│  "服务器怎么部署的"                    │
│   → 变体1: "服务器部署流程和配置步骤"   │
│   → 变体2: "后端服务上线方式"          │
└──────────────────────────────────────┘
  │
  ▼  每个变体独立搜索（无LLM）
┌────────┐    ┌──────────┐
│BM25全文 │    │ 向量语义  │
│关键词匹配│    │embedding │
└───┬────┘    └────┬─────┘
    └── RRF 融合 ──┘
  层级权重 × 时间衰减 × 访问频率 = finalScore
  │
  ▼
┌─ 合并去重 ──────────────────────────┐
│  同一记忆被多变体命中：               │
│   → 保留最高 finalScore 为基础分      │
│   → 多命中对数加分: +8% × ln(命中数)  │
│     2次+5.5% / 3次+8.8%             │
│  结果：所有变体的并集（约30+条）       │
└──────────────────────────────────────┘
  │
  ▼
┌─ LLM 重排序（1次LLM调用）────────────┐
│  全部合并结果 → LLM 逐条打分 0~1     │
│  最终分 = reranker分 × w             │
│         + 原始分   × (1-w)           │
│  w 默认 0.5，可在管理面板调节         │
│  输出：top 15 条                     │
└──────────────────────────────────────┘
  │
  ▼
优先注入 constraint/persona
→ 填充剩余预算 → 注入 AI 上下文

共 2 次 LLM 调用，延迟约 5-7 秒
```

**查询扩展**（可选）：LLM 将查询改写为 2-3 个变体（同义词、不同表述），分别搜索以扩大候选池。被多个变体命中的记忆获得对数加分（递减收益）。在管理面板 → Gate → Query Expansion 开启。

**LLM 重排序**（可选）：合并所有变体结果后，LLM 统一重新打分。最终分数融合 reranker 分和原始分，权重可配置（默认 50:50），保留层级、时间、访问频率等信号。支持 `llm`（复用提取模型）和 `cohere`（Cohere Rerank API）。在管理面板 → Search → Reranker 开启。

**优先注入**：格式化注入上下文时，`constraint`（硬约束）和 `agent_persona`（人设）记忆优先注入，确保关键规则和人设不会被 token 预算截断。

### MCP 工具

通过 MCP 连接后，AI 自动获得这些工具：

| 工具 | 功能 |
|------|------|
| `cortex_recall` | 搜索记忆上下文（约束和人设优先注入） |
| `cortex_remember` | 存储记忆：用户事实、约束、策略或 Agent 自我观察 |
| `cortex_forget` | 删除或修正记忆 |
| `cortex_search_debug` | 调试搜索评分详情 |
| `cortex_stats` | 获取记忆统计 |

---

## 支持的提供商

### LLM 提供商

| 提供商 | 模型 | 备注 |
|--------|------|------|
| **OpenAI** | gpt-4o-mini, gpt-4.1-nano/mini, gpt-4o, o3/o4-mini | 默认选择，最佳性价比 |
| **Anthropic** | claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-5 | 提取质量最高 |
| **Google Gemini** | gemini-2.5-flash/pro, gemini-2.0-flash | AI Studio 有免费额度 |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | 最便宜，OpenAI 兼容 API |
| **OpenRouter** | 100+ 来自所有提供商的模型 | 统一网关 |
| **Ollama** | qwen2.5, llama3.2, mistral, deepseek-r1 等 | 完全本地，无需 API Key |

### Embedding 提供商

| 提供商 | 模型 | 备注 |
|--------|------|------|
| **OpenAI** | text-embedding-3-small/large | 默认（1536维），最稳定 |
| **Google Gemini** | gemini-embedding-001, text-embedding-004 | AI Studio 免费 |
| **Voyage AI** | voyage-3, voyage-3-lite, voyage-code-3 | 高质量 |
| **Ollama** | bge-m3, nomic-embed-text, mxbai-embed-large | 本地运行，零成本 |

所有提供商都可通过管理面板 UI 或 `cortex.json` 配置。详细的模型对比和定价请参考 `cortex-provider-reference.md`。

> **注意：更换 Embedding 模型**
>
> 每个 Embedding 模型生成特定维度的向量。如果切换到维度不同的模型，**所有已有向量将不兼容**。更换 Embedding 模型或维度后：
> 1. 进入管理面板 → 设置 → 数据管理 → **重建向量索引**
> 2. 系统会使用新模型重新生成所有向量（每条记忆都需要调用 API）
> 3. 未重建前，向量搜索（召回、去重、智能更新）将无法正常工作

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
| `GET` | `/api/v1/extraction-logs` | 提取质量审查日志 |
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
| **LLM 提供商** | OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Ollama |
| **Embedding 提供商** | OpenAI、Google、Voyage AI、Ollama |
| **向量后端** | SQLite vec0（默认）、Qdrant、Milvus |
| **智能体独立配置** | 每个智能体可覆盖全局 LLM/Embedding 设置 |
| **离线模式** | 使用 Ollama 实现完全本地化，无需 API Key |

完整配置选项请参考 `DESIGN.md`，提供商选择指南请参考 `cortex-provider-reference.md`。

---

## 项目结构

```
cortex/
├── packages/
│   ├── server/          # 核心服务（Fastify + SQLite）
│   ├── mcp-client/      # MCP stdio 适配器（npm: @cortex/mcp-client）
│   ├── cortex-bridge/   # OpenClaw 插件（npm: @cortexmem/cortex-bridge）
│   └── dashboard/       # React 管理面板
├── docker-compose.yml
├── DESIGN.md            # 完整技术设计文档
└── cortex-provider-reference.md  # LLM/Embedding 提供商选择指南
```

## 成本

使用默认配置（gpt-4o-mini + text-embedding-3-small）：
- 每天 50 轮对话约 **$0.55/月**
- 线性增长，3 倍使用量也不到 $2/月
- 使用 DeepSeek + Google Embedding：低至 **~$0.10/月**

## 已知问题

### ~~OpenClaw：streaming 模式下 `agent_end` hook 不触发~~ （已修复）

~~**上游 bug：** [openclaw/openclaw#21863](https://github.com/openclaw/openclaw/issues/21863)~~

**已解决** — 上游已在 commit `72d1d36` 中修复。`agent_end` hook 现在在 streaming 模式下也能正常触发，自动记忆提取在所有模式下均可正常工作。

## 开源协议

MIT
