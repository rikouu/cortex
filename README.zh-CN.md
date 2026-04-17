<p align="center">
  <img src="https://raw.githubusercontent.com/rikouu/cortex/main/.github/assets/logo.png" width="80" alt="Cortex Logo" />
</p>

<h1 align="center">Cortex</h1>
<p align="center"><strong>你的 AI 会遗忘，Cortex 不会。</strong></p>
<p align="center"><sub>会生长、会学习、会回忆的记忆系统。</sub></p>

<p align="center">
  <a href="https://github.com/rikouu/cortex/releases"><img src="https://img.shields.io/github/v/release/rikouu/cortex?style=flat-square&color=6366f1" alt="Release" /></a>
  <a href="https://github.com/rikouu/cortex/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rikouu/cortex?style=flat-square" alt="License" /></a>
  <a href="https://hub.docker.com/r/rikouu/cortex"><img src="https://img.shields.io/docker/pulls/rikouu/cortex?style=flat-square" alt="Docker Pulls" /></a>
  <a href="https://www.npmjs.com/package/@cortexmem/mcp"><img src="https://img.shields.io/npm/v/@cortexmem/mcp?style=flat-square&label=MCP" alt="npm MCP" /></a>
</p>

<p align="center">
  <a href="#工作原理">工作原理</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#接入你的-ai">接入方式</a> •
  <a href="#核心特性">特性</a> •
  <a href="#api-参考">API</a> •
  <a href="./README.md">English</a>
</p>

---

你有没有这种经历——跟 AI 聊了半天，结果第二天它全忘了？

> "我上周开始戒咖啡了。"
>
> *……两天后……*
>
> "要不要我推荐几款浓缩咖啡？"

**你的 AI 没有记忆。** 每次对话都是从零开始。不管你解释过多少次你的偏好、你的项目、你的约束——关掉窗口，全没了。

**Cortex 改变这一切。** 它在你的 AI 旁边默默运行，从每次对话中学习。它记得你的名字、你的偏好、你正在做的项目、你做过的决定——并在需要的时候精准地提供上下文。

```
周一：   "我对虾过敏，刚搬到东京。"

周三：   "帮我找个好吃的餐厅？"
  AI：    搜索东京附近的餐厅，
          自动排除海鲜为主的选项。
          （Cortex 回忆起了：过敏 + 所在地）
```

不用手动标记，不用说"记住这个"。它就是能记住。

## 为什么选 Cortex？

| | Cortex | Mem0 | Zep | LangMem |
|---|---|---|---|---|
| **记忆生命周期** | ✅ 三层自动升降级/衰退/归档 | ❌ 扁平存储 | 部分 | ❌ |
| **知识图谱** | ✅ Neo4j + 多跳推理 | ✅ 基础 | ❌ | ❌ |
| **自部署** | ✅ 一个 Docker 容器 | 云优先 | 云优先 | 框架绑定 |
| **数据主权** | ✅ 你的 SQLite + Neo4j | 他们的云 | 他们的云 | 不一定 |
| **管理面板** | ✅ 完整 UI | ❌ | 部分 | ❌ |
| **MCP 支持** | ✅ 原生 | ❌ | ❌ | ❌ |
| **多 Agent** | ✅ 隔离命名空间 | ✅ | ✅ | ❌ |
| **成本** | ~¥4/月 | $99+/月 | $49+/月 | 不等 |

## 核心特性

### 🧬 三层记忆生命周期

记忆不只是存储——它们**活着**。

```
工作记忆 (48h) ──升级──→ 核心记忆 ──衰退──→ 归档
       ↑                       ↑                │
       │                  读取刷新衰退计数      压缩
       │                                   回到核心
       └──────────── 没有任何记忆会真正丢失 ──────────┘
```

- **工作 → 核心**：高频访问或高价值的记忆自动升级
- **核心 → 归档**：长期未用的记忆衰退、压缩归档
- **归档 → 核心**：压缩后的记忆在需要时回归
- 时间衰退 + 读取刷新 + 访问频率 = 有机的记忆行为

### 🔍 混合搜索 + 多级排序

```
查询 → BM25 (关键词) + 向量 (语义) → RRF 融合
    → 查询扩展 (LLM 变体)
    → LLM 重排序 (可选)
    → 优先注入 (约束和人设优先)
```

- **双通道**：关键词精确匹配 + 语义理解
- **查询扩展**：LLM 生成搜索变体，多命中加权
- **重排序**：LLM、Cohere、Voyage AI、Jina AI 或 SiliconFlow 二次评分
- **智能注入**：约束和人设始终优先注入，永远不会被截断

### 🕸️ 知识图谱 (Neo4j)

记忆之间自动形成关联。Cortex 构建知识图谱。

```
小明 ──使用──→ Rust ──关联──→ 后端开发
  │                              │
  └──就职于──→ Acme ──部署在──→ AWS
```

- 每次对话自动提取实体关系
- **多跳推理**：recall 时进行 2 跳图遍历
- 关系与记忆一起注入，提供更丰富的上下文
- 实体归一化 + 置信度评分

### 🛡️ 智能提取 (SIEVE)

```
对话 ──→ 快通道 (正则, 0ms) ──→ 合并 ──→ 四级去重 ──→ 存储
     ──→ 深通道 (LLM, 2-5s) ──┘        │ 完全重复 → 跳过
                                        │ 近似重复 → 替换
                                        │ 语义重叠 → LLM 判断
                                        └ 新信息 → 插入
```

- **20 种记忆分类**：身份、偏好、约束、目标、技能、关系……
- **批量去重**：防止 "我喜欢咖啡" 变成 50 条记忆
- **智能更新**：偏好变更是更新，不是新增
- **实体关系**：自动提取知识图谱边

### 🔄 自我改进

Cortex 从你与记忆的互动中学习：

- **显式反馈**：在面板或 API 中标记记忆为"有帮助""没帮助"或"错误/过时"
- **隐式信号**：在召回中被使用的记忆自动获得使用加成
- **自动调优**：重要性分数在生命周期循环中根据积累的反馈自动调整
- 在面板 → 设置 → 自我改进中配置窗口大小、最少反馈数、最大变化量、信号权重

### 📊 全功能管理面板

每条记忆可搜索，每次提取可审计。

- 记忆浏览器：搜索、按分类/状态/Agent 过滤
- 搜索调试器：查看每次查询的 BM25/向量/融合分数
- 提取日志：提取了什么、为什么、置信度
- 生命周期预览：升级/衰退操作的预演
- 关系图谱：交互式知识图谱可视化 (sigma.js)
- 多 Agent 管理 + 独立配置
- 一键更新 + 版本检测

### 🔌 接入一切

| 集成方式 | 接入 |
|---|---|
| **OpenClaw** | `openclaw plugins install @cortexmem/openclaw` |
| **Claude Desktop** | 添加 MCP 配置 → 重启 |
| **Cursor / Windsurf** | 在设置中添加 MCP 服务器 |
| **Claude Code** | `claude mcp add cortex -- npx @cortexmem/mcp` |
| **任何应用** | REST API: `/api/v1/recall` + `/api/v1/ingest` |

---

## 工作原理

### 写入路径 — 每轮对话自动执行
```
对话 ──→ 快通道 (正则) + 深通道 (LLM)
                   ↓
          提取的记忆（自动分为 20 种类型）
                   ↓
          四级去重 (完全重复 → 跳过 / 近似 → 替换 / 语义重叠 → LLM 判断 / 新信息 → 写入)
                   ↓
          存为工作记忆 (48h) 或核心记忆
                   ↓
          提取实体关系 → Neo4j 知识图谱
```

### 读取路径 — 每轮对话自动执行
```
用户消息 ──→ 查询扩展 (LLM 生成 2-3 个搜索变体)
                   ↓
          BM25 (关键词) + 向量 (语义) → RRF 融合
                   ↓
          多命中加权（被多个变体命中的记忆排名更高）
                   ↓
          LLM 重排序（可选，二次评分）
                   ↓
          Neo4j 多跳遍历（发现间接关联）
                   ↓
          优先注入 → AI 上下文
          (约束和人设优先，然后按相关度)
```

### 生命周期 — 每日自动调度
```
工作记忆 (48h) ──升级──→ 核心记忆 ──衰退──→ 归档 ──压缩──→ 回到核心
                                ↑
                       读取刷新衰退计数
                       (没有任何记忆会真正丢失)
```

---

## 架构

<p align="center">
  <img src="https://raw.githubusercontent.com/rikouu/cortex/main/.github/assets/architecture-zh.png" alt="Cortex 架构图" width="800" />
</p>

```
┌─ 客户端 ───────────────────────────────────────────────────────────┐
│  OpenClaw (Bridge)  │  Claude Desktop (MCP)  │  Cursor  │  REST   │
└─────────────────────┴────────────────────────┴──────────┴─────────┘
                              │
                              ▼
┌─ Cortex 服务端 (:21100) ───────────────────────────────────────────┐
│                                                                     │
│  ┌─ Memory Gate ─────────┐    ┌─ Memory Sieve ──────────────────┐  │
│  │ 查询扩展               │    │ 快通道 (正则)                    │  │
│  │ BM25 + 向量搜索        │    │ 深通道 (LLM)                    │  │
│  │ RRF 融合               │    │ 四级去重                        │  │
│  │ LLM 重排序             │    │ 实体关系提取                    │  │
│  │ Neo4j 图遍历           │    │ 分类识别 (×20)                  │  │
│  │ 优先注入               │    │ 智能更新检测                    │  │
│  └───────────────────────┘    └─────────────────────────────────┘  │
│                                                                     │
│  ┌─ 生命周期引擎 ────────┐    ┌─ 存储 ─────────────────────────┐  │
│  │ 升级 / 衰退            │    │ SQLite + FTS5 (记忆)           │  │
│  │ 归档 / 压缩            │    │ sqlite-vec (向量)              │  │
│  │ 读取刷新               │    │ Neo4j 5 (知识图谱)             │  │
│  │ 定时调度               │    │                                 │  │
│  └───────────────────────┘    └─────────────────────────────────┘  │
│                                                                     │
│  ┌─ 管理面板 (React SPA) ───────────────────────────────────────┐  │
│  │ 记忆浏览 │ 搜索调试 │ 提取日志 │ 关系图谱                     │  │
│  │ 生命周期预览 │ Agent 配置 │ 一键更新                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

```bash
git clone https://github.com/rikouu/cortex.git
cd cortex
docker compose up -d
```

打开 **http://localhost:21100** → 管理面板 → **设置** → 选择 LLM 提供商，填入 API Key。搞定。

> 本地使用不需要 `.env` 文件。所有 LLM 配置都在面板里完成。

默认情况下，面板和 API **没有访问密码** —— 任何能访问 21100 端口的人都可以完全操作。本地使用没问题，但**对外开放前请务必阅读下方安全配置。**

<details>
<summary><b>不用 Docker</b></summary>

**生产模式**（推荐）：

```bash
git clone https://github.com/rikouu/cortex.git
cd cortex
pnpm install
pnpm build        # 构建服务器 + 控制台
pnpm dev          # → http://localhost:21100
```

**开发模式**（开发者/贡献者）：

```bash
pnpm dev           # 仅 API → http://localhost:21100
# 控制台需要单独启动：
cd packages/dashboard && pnpm dev  # → http://localhost:5173
```

> ⚠️ 开发模式下，浏览器访问 `http://localhost:21100` 会显示 404 —— 这是正常的。控制台开发服务器运行在单独的端口。

**依赖：** Node.js ≥ 20, pnpm ≥ 8

</details>

---

## 配置

### 环境变量

在项目根目录创建 `.env` 文件（或在 `docker-compose.yml` 的 `environment` 中设置）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CORTEX_PORT` | `21100` | 服务端口 |
| `CORTEX_HOST` | `127.0.0.1` | 绑定地址（`0.0.0.0` 开放局域网） |
| `CORTEX_AUTH_TOKEN` | *(空)* | **访问令牌** — 保护面板和 API |
| `CORTEX_DB_PATH` | `cortex/brain.db` | SQLite 数据库路径 |
| `OPENAI_API_KEY` | — | OpenAI API Key（LLM + 向量） |
| `ANTHROPIC_API_KEY` | — | Anthropic API Key |
| `OLLAMA_BASE_URL` | — | Ollama 地址（本地模型） |
| `TZ` | `UTC` | 时区（如 `Asia/Tokyo`、`Asia/Shanghai`） |
| `LOG_LEVEL` | `info` | 日志级别（`debug`/`info`/`warn`/`error`） |
| `NEO4J_URI` | — | Neo4j 连接地址（可选） |
| `NEO4J_USER` | — | Neo4j 用户名 |
| `NEO4J_PASSWORD` | — | Neo4j 密码 |

> 💡 **LLM 和向量模型**也可以在面板 → 设置中配置，通常更方便。环境变量主要用于 `CORTEX_AUTH_TOKEN`、`CORTEX_HOST` 和 `TZ`。

### 访问令牌说明

设置了 `CORTEX_AUTH_TOKEN` 后：

1. **面板**首次访问需要输入令牌（浏览器会保存）
2. **所有 API** 调用需要 `Authorization: Bearer <令牌>` 请求头
3. **MCP 客户端**和 **Bridge 插件**需要在配置中填入令牌

没有设置 `CORTEX_AUTH_TOKEN` 时（默认）：
- 无需认证 — 完全开放
- 适合 `localhost` / 个人使用
- ⚠️ 如果端口暴露到网络上则**非常危险**

**令牌在哪里找？** 就是你自己设的 `CORTEX_AUTH_TOKEN` 值。没有自动生成的令牌——你设什么就是什么，在所有客户端配置中填相同的值即可。

### 🔒 安全清单

如果你要把 Cortex 暴露到局域网、VPN 或公网：

- [ ] **设置 `CORTEX_AUTH_TOKEN`** — 使用强随机字符串（32位以上）
- [ ] **启用 HTTPS/SSL** — 在前面放反向代理（Caddy、Nginx、Traefik）配置 TLS
- [ ] **限制 `CORTEX_HOST`** — 绑定到 `127.0.0.1` 或 Tailscale/VPN IP，不要用 `0.0.0.0`
- [ ] **防火墙** — 只允许可信 IP 访问端口
- [ ] **保持更新** — 面板会自动检测新版本

```bash
# 生成一个强随机令牌
openssl rand -hex 24
# → 例如 3a7f2b...（把这个设为 CORTEX_AUTH_TOKEN）
```

> ⚠️ **没有 HTTPS 的话，令牌是明文传输的。** 非本地部署务必配置 TLS。

<details>
<summary><b>启用知识图谱 (Neo4j)</b></summary>

使用附带的 overlay 文件：

```bash
# 在 .env 中设置 Neo4j 密码
echo "NEO4J_PASSWORD=your-secure-password" >> .env

# 连同 Neo4j 一起启动
docker compose -f docker-compose.yml -f docker-compose.neo4j.yml up -d
```

或手动设置 Cortex 环境变量：
```
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
```
</details>

---

## 接入你的 AI

> 💡 如果设置了 `CORTEX_AUTH_TOKEN`，需要在下面每个客户端配置中加上令牌。示例同时展示了有/无认证的写法。

### OpenClaw（推荐）

```bash
openclaw plugins install @cortexmem/openclaw
```

在 OpenClaw 插件设置中配置（Dashboard 或 `openclaw.json`）：

```json
{
  "cortexUrl": "http://localhost:21100",
  "authToken": "你的令牌",
  "agentId": "my-agent"
}
```

> 不用认证：省略 `authToken`。不需要自定义 agent：省略 `agentId`（默认 `"openclaw"`）。

插件自动接入 OpenClaw 生命周期：

| Hook | 时机 | 做什么 |
|---|---|---|
| `before_agent_start` | AI 回复前 | 回忆并注入相关记忆 |
| `agent_end` | AI 回复后 | 提取并保存关键信息 |
| `before_compaction` | 上下文压缩前 | 紧急保存即将丢失的信息 |

另有 `cortex_recall` 和 `cortex_remember` 工具供按需使用。

### Claude Desktop (MCP)

设置 → 开发者 → 编辑配置：

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["@cortexmem/mcp", "--server-url", "http://localhost:21100"],
      "env": {
        "CORTEX_AUTH_TOKEN": "你的令牌",
        "CORTEX_AGENT_ID": "my-agent"
      }
    }
  }
}
```

> 不用认证：删除 `env` 中的 `CORTEX_AUTH_TOKEN` 行。

### 其他 MCP 客户端

<details>
<summary><b>Cursor</b></summary>

设置 → MCP → 添加全局 MCP 服务器：

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["@cortexmem/mcp"],
      "env": {
        "CORTEX_URL": "http://localhost:21100",
        "CORTEX_AUTH_TOKEN": "你的令牌",
        "CORTEX_AGENT_ID": "my-agent"
      }
    }
  }
}
```
</details>

<details>
<summary><b>Claude Code</b></summary>

```bash
# 不用认证
claude mcp add cortex -- npx @cortexmem/mcp --server-url http://localhost:21100

# 带认证 + agent ID
CORTEX_AUTH_TOKEN=你的令牌 CORTEX_AGENT_ID=my-agent \
  claude mcp add cortex -- npx @cortexmem/mcp --server-url http://localhost:21100
```
</details>

<details>
<summary><b>Windsurf / Cline / 其他</b></summary>

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["@cortexmem/mcp", "--server-url", "http://localhost:21100"],
      "env": {
        "CORTEX_AGENT_ID": "my-agent",
        "CORTEX_AUTH_TOKEN": "你的令牌"
      }
    }
  }
}
```
</details>

#### Pairing Code — 多实例隔离

如果你运行了**多个 OpenClaw 实例**（例如 Harry 的 Mac mini + Sarah 的笔记本），并且都使用相同的默认 `agent_id`（如 `"main"`），它们的记忆会混在一起。`pairing_code` 可以解决这个问题。

为每个实例设置唯一的 `CORTEX_PAIRING_CODE` 环境变量：

```json
{
  "cortexUrl": "http://localhost:21100",
  "pairingCode": "harry-mac-mini-2026"
}
```

或通过环境变量：
```
CORTEX_PAIRING_CODE=harry-mac-mini-2026
```

- 带有 pairing code 的请求只能看到带有相同 code 的记忆
- 不带 pairing code 的请求使用原来的 `agent_id` 行为（向后兼容）
- 每个 OpenClaw 实例应使用唯一的 code

### REST API

```bash
# 不用认证
curl -X POST http://localhost:21100/api/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"我喜欢什么食物？","agent_id":"default"}'

# 带认证
curl -X POST http://localhost:21100/api/v1/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的令牌" \
  -d '{"user_message":"我喜欢寿司","assistant_message":"记住了！","agent_id":"default"}'

# 带 pairing_code
curl -X POST http://localhost:21100/api/v1/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"偏好","agent_id":"main","pairing_code":"harry-mac-mini-2026"}'
```

---

## MCP 工具

| 工具 | 说明 |
|---|---|
| `cortex_recall` | 搜索记忆，优先注入约束和人设 |
| `cortex_remember` | 存储一条特定记忆 |
| `cortex_relations` | 列出记忆中的实体关系 |
| `cortex_forget` | 删除或修正记忆 |
| `cortex_search_debug` | 调试搜索评分 |
| `cortex_stats` | 记忆统计 |

---

## 支持的提供商

### LLM（用于提取和重排序）

| 提供商 | 推荐模型 | 备注 |
|---|---|---|
| **OpenAI** | gpt-4o-mini, gpt-4.1-nano | 默认，性价比最优 |
| **Anthropic** | claude-haiku-4-5, claude-sonnet-4-5 | 提取质量最高 |
| **Google Gemini** | gemini-2.5-flash | AI Studio 有免费额度 |
| **DeepSeek** | deepseek-chat | 最便宜 |
| **Ollama** | qwen2.5, llama3.2 | 完全本地，零成本 |
| **OpenRouter** | 100+ 模型 | 统一网关 |

现在每个提取 / 生命周期 LLM 都支持配置主提供商、可选回退提供商、重试参数（`retry.maxRetries`、`retry.baseDelayMs`）以及每个提供商独立的 `timeoutMs`。

```json
{
  "llm": {
    "extraction": {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "timeoutMs": 30000,
      "retry": { "maxRetries": 2, "baseDelayMs": 200 },
      "fallback": {
        "provider": "openrouter",
        "model": "anthropic/claude-haiku-4-5",
        "timeoutMs": 30000
      }
    }
  }
}
```

### Embedding（用于向量搜索）

| 提供商 | 推荐模型 | 备注 |
|---|---|---|
| **OpenAI** | text-embedding-3-small/large | 默认，最稳定 |
| **Google Gemini** | gemini-embedding-2, gemini-embedding-001 | AI Studio 免费 |
| **Voyage AI** | voyage-4-large, voyage-4-lite | 高质量（共享嵌入空间）|
| **DashScope** | text-embedding-v3 | 通义千问，中文友好 |
| **Ollama** | bge-m3, nomic-embed-text | 本地，零成本 |

> ⚠️ **更换 embedding 模型**后需要重建所有向量索引。在面板 → 设置 → 重建向量索引。

### 重排序（可选，提升搜索相关性）

| 提供商 | 推荐模型 | 免费额度 | 备注 |
|---|---|---|---|
| **LLM** | （使用提取模型）| — | 质量最高，延迟 ~2-3s |
| **Cohere** | rerank-v3.5 | 1000次/月 | 老牌稳定 |
| **Voyage AI** | rerank-2.5 | 2亿 token | 免费额度最大 |
| **Jina AI** | jina-reranker-v2-base-multilingual | 100万 token | 中文/多语言最佳 |
| **SiliconFlow** | BAAI/bge-reranker-v2-m3 | 有免费额度 | 开源模型，延迟低 |

> 💡 专用重排序比 LLM 重排序快 **10-50 倍**（~100ms vs ~2s）。在面板 → 设置 → 搜索中配置。

---

## API 参考

| 方法 | 端点 | 说明 |
|---|---|---|
| `POST` | `/api/v1/recall` | 搜索并注入记忆 |
| `POST` | `/api/v1/ingest` | 录入对话 |
| `POST` | `/api/v1/flush` | 紧急刷盘 |
| `POST` | `/api/v1/search` | 带调试信息的混合搜索 |
| `CRUD` | `/api/v1/memories` | 记忆管理 |
| `POST` | `/api/v1/memories/:id/rollback` | 回滚到历史版本 |
| `GET` | `/api/v1/memories/:id/chain` | 版本链 |
| `POST` | `/api/v1/memories/:id/feedback` | 提交记忆反馈 |
| `GET` | `/api/v1/memories/:id/feedback` | 获取记忆反馈 |
| `POST` | `/api/v1/recall/:id/usage` | 追踪召回使用 |
| `GET` | `/api/v1/feedback/overview` | 反馈概览统计 |
| `CRUD` | `/api/v1/relations` | 实体关系 |
| `GET` | `/api/v1/relations/traverse` | 多跳图遍历 |
| `GET` | `/api/v1/relations/path` | 实体间最短路径 |
| `GET` | `/api/v1/relations/stats` | 图统计 |
| `CRUD` | `/api/v1/agents` | Agent 管理 |
| `GET` | `/api/v1/agents/:id/config` | Agent 合并配置 |
| `GET` | `/api/v1/extraction-logs` | 提取审计日志 |
| `POST` | `/api/v1/lifecycle/run` | 触发生命周期 |
| `GET` | `/api/v1/lifecycle/preview` | 干跑预览 |
| `GET` | `/api/v1/lifecycle/log` | 生命周期事件历史 |
| `GET` | `/api/v1/health` | 健康检查 |
| `GET` | `/api/v1/health/components` | 组件级健康状态 |
| `POST` | `/api/v1/health/test` | 测试所有连接 |
| `GET` | `/api/v1/stats` | 统计信息 |
| `GET/PATCH` | `/api/v1/config` | 全局配置 |
| `POST` | `/api/v1/import` | 导入记忆 |
| `POST` | `/api/v1/export` | 导出记忆 |
| `POST` | `/api/v1/reindex` | 重建向量索引 |

## 成本

| 方案 | 月费 |
|---|---|
| gpt-4o-mini + text-embedding-3-small | ~¥4 |
| DeepSeek + Google Embedding | ~¥0.7 |
| Ollama（完全本地） | ¥0 |

*基于每天 50 次对话。线性增长。*

---

## 开源协议

MIT

---

<p align="center">
  <sub>用做记忆该有的方式，做记忆。</sub>
</p>
