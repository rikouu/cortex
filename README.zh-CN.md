# 🧠 Cortex — 通用 AI Agent 记忆服务

[English](./README.md) | **中文**

Cortex 让你的 AI 拥有**持久记忆**。它以 Sidecar 进程运行在 Agent 旁边，自动记住对话内容、提取关键事实，并在需要时召回相关上下文。

> **你的 AI 能记住你上周、上个月、甚至去年告诉它的事情 — 跨会话、跨设备。**

---

## 特性

- **三层记忆** — 工作层（48h）→ 核心层（永久）→ 归档层（90天，压缩回流核心层）
- **双通道提取** — 快速正则 + 深度 LLM 提取并行运行
- **20 种记忆分类** — 身份、偏好、约束、Agent 人设等
- **混合搜索** — BM25 关键词 + 向量语义搜索，RRF 融合
- **实体关系** — 自动提取知识图谱（谁用什么、谁认识谁）
- **智能去重** — 三级匹配防止重复记忆
- **多提供商** — OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Ollama
- **多智能体** — 每个智能体独立配置覆盖，隔离的记忆命名空间
- **管理面板** — 完整管理 UI，含搜索调试、生命周期预览、提取日志
- **零配置** — 只需一个 OpenAI API Key 即可开箱即用

---

## 30 秒上手

**前提条件**：Node.js ≥ 20，一个 OpenAI API Key（或任何[支持的提供商](#支持的提供商)）

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

### 方式 A：Claude Desktop（MCP）

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

### 方式 B：Cursor（MCP）

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

### 方式 C：Claude Code（MCP）

在终端运行：

```bash
claude mcp add cortex -- npx cortex-mcp --server-url http://localhost:21100
```

### 方式 D：其他 MCP 客户端

任何兼容 MCP 的应用（Windsurf、Cline 等），将以下配置添加到客户端的 MCP 配置文件中：

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

具体配置文件位置因客户端而异，请查阅你所用客户端的文档。

### 方式 E：OpenClaw

查看完整的手把手教程：**[OpenClaw 快速上手](#openclaw-快速上手)**。

### 方式 F：任意应用（REST API）

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

## OpenClaw 快速上手

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

### 记忆分类

Cortex 将记忆分为 20 个类别，按三轨归属组织，每个类别有独立的重要性和衰减率：

**用户记忆** — 关于用户的事实：

| 类别 | 说明 | 重要性 |
|------|------|--------|
| `identity` | 姓名、职业、角色、所在地 | 0.9-1.0 |
| `preference` | 工具、工作流、风格、习惯 | 0.8-0.9 |
| `correction` | 对已知信息的修正更新 | 0.9-1.0 |
| `skill` | 专长、熟练度、技术栈 | 0.8-0.9 |
| `relationship` | 同事、朋友、组织关系 | 0.8-0.9 |
| `goal` | 目标、计划、里程碑 | 0.7-0.9 |
| `decision` | 已做出的具体决策 | 0.8-0.9 |
| `entity` | 工具、项目、组织等命名实体 | 0.6-0.8 |
| `project_state` | 项目进度、状态变更 | 0.5-0.7 |
| `insight` | 经验教训、洞察 | 0.5-0.7 |
| `fact` | 用户相关的事实信息 | 0.5-0.8 |
| `todo` | 待办事项、跟进任务 | 0.6-0.8 |

**操作级** — 规则与策略：

| 类别 | 说明 | 重要性 |
|------|------|--------|
| `constraint` | 不可违反的硬约束（"禁止 X"、"never do Y"） | 0.9-1.0 |
| `policy` | 执行策略/默认行为规范（"优先用 X 再 Y"） | 0.7-0.9 |

**Agent 成长** — Agent 自身的学习与观察：

| 类别 | 说明 | 重要性 |
|------|------|--------|
| `agent_persona` | Agent 人设/风格：语气、角色定位、个性特征 | 0.8-1.0 |
| `agent_relationship` | 与用户的相处模式：互动默契、信任边界 | 0.8-0.9 |
| `agent_user_habit` | 对用户习惯的观察：沟通风格、工作节奏 | 0.7-0.9 |
| `agent_self_improvement` | Agent 行为改进：错误模式、更好的处理方式 | 0.7-0.9 |

**系统内部**：

| 类别 | 说明 | 重要性 |
|------|------|--------|
| `context` | 会话上下文 | 0.2 |
| `summary` | 压缩摘要 | 0.4 |

### 记忆提取（Memory Sieve）

Memory Sieve 使用**双通道提取**管线，结合**三轨归属**：

1. **快速通道** — 基于正则表达式的模式匹配（中/英/日三语），零 LLM 延迟检测高信号信息
2. **深度通道** — LLM 驱动的结构化 JSON 提取，输出带有分类、重要性评分、推理依据和来源归属的记忆

**三轨归属**将记忆路由到正确的分类：
- **用户轨** — 用户自述的事实、偏好、决策
- **操作轨** — 用户或系统设定的约束和策略
- **Agent 轨** — Agent 自身的反思、观察和人设

两个通道并行运行，结果通过向量相似度交叉去重。重要性 ≥ 0.8 的记忆直接写入核心层，较低重要性的写入工作记忆（带 TTL）。

Sieve 还支持**用户画像注入** — 从核心记忆自动合成用户画像，注入到提取 prompt 中，帮助 LLM 避免重复提取已知事实，更好地识别增量新信息。

### 记忆生命周期

生命周期引擎自动运行（可配置调度计划），负责：

- **晋升**：重要的工作记忆 → 核心层
- **合并**：重复/相似的核心记忆 → 合并为一条丰富条目
- **归档**：衰减的核心记忆 → 归档层
- **压缩**：过期的归档条目 → 压缩为核心层摘要
- **画像合成**：从核心记忆自动生成用户画像

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

### OpenClaw：streaming 模式下 `agent_end` hook 不触发

**上游 bug：** [openclaw/openclaw#21863](https://github.com/openclaw/openclaw/issues/21863)

OpenClaw 的 streaming 模式（Telegram 等网关频道使用）下，`agent_end` hook 不会分发给插件。这意味着 Cortex bridge 插件**无法在 streaming 模式下自动保存对话记忆**。记忆召回（`before_agent_start`）工作正常。

**临时解决方案：**
- 在 Agent 的 system prompt 中添加指令，让 Agent 在有意义的对话后主动调用 `cortex_ingest` 工具
- 使用 `cortex_remember` 工具让 Agent 在对话中直接保存重要事实
- 使用非 streaming 频道（该模式下 hook 正常触发）

## 开源协议

MIT
