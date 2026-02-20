# Cortex：通用 AI Agent 记忆服务 — 技术设计文档

**项目代号：** Cortex 🧠
**版本：** v0.2 Draft
**日期：** 2026-02-20
**作者：** Harry（基于深度技术调研）

---

## 0. 为什么需要这个项目

### 0.1 普遍问题：AI Agent 没有真正的记忆

几乎所有 AI Agent 框架都面临同样的问题——**对话结束，记忆消失**。即使有持久化方案，也普遍存在以下缺陷：

| 缺陷 | 影响的框架 | 后果 |
|------|-----------|------|
| 记忆只存在上下文窗口内 | OpenClaw, LangChain, 大部分自建 Agent | 长对话/Compaction 后 "失忆" |
| 无自动摘要/合并/遗忘 | Claude Projects, ChatGPT Memory | 记忆膨胀，噪声淹没信号 |
| 检索不精准 | Mem0, Zep, MemGPT | 注入无关记忆，浪费 token |
| 只支持单一 Agent | 各框架自带的记忆方案 | 无法跨 Agent 共享用户画像 |

### 0.2 以 OpenClaw 为例（首要接入目标）

OpenClaw 原生记忆系统有三个结构性缺陷：

| 缺陷 | 根因 | 后果 |
|------|------|------|
| Compaction 丢记忆 | 记忆只存在上下文窗口内 | 长对话后 Agent "失忆" |
| 只加载今天+昨天的日志 | Bootstrap 硬编码 | 3 天前的对话彻底消失 |
| MEMORY.md 只增不减 | 无自动摘要/合并/遗忘 | 文件膨胀，噪声淹没信号 |

现有 9+ 款社区插件各自解决了一个维度，但没有端到端方案。

### 0.3 Cortex 的定位

**Cortex 是一个通用的 AI Agent 记忆服务。** 它以独立 Sidecar 进程运行，通过标准化接口（REST API / MCP）为任何 Agent 提供持久化、检索精准、有生命周期的记忆能力。

```
┌─────────────────────────────────────────────┐
│                  Cortex                       │
│           (通用记忆服务)                      │
│                                               │
│  接入方式 1: REST API  ← 任何能发 HTTP 的     │
│  接入方式 2: MCP       ← Claude Desktop 等    │
│  接入方式 3: 插件桥接  ← OpenClaw 等框架      │
└─────────────────────────────────────────────┘
      ▲          ▲          ▲          ▲
      │          │          │          │
 OpenClaw    Claude     LangChain   自建
 (Bridge     Desktop    Agent       Agent
  Plugin)    (MCP)      (API)       (API)
```

**首要目标仍是 OpenClaw**（因为它最需要，也是你的主力工具），但架构设计从第一天就支持多 Agent 接入。

---

## 1. 设计原则

```
P1: SQLite 为主   — 结构化存储作为唯一真实来源，支持事务和原子操作
P2: Markdown 为镜 — 自动导出人类可读视图，可 Git 版本控制
P3: API 优先     — LLM 和 Embedding 默认走云端 API（快、稳、便宜）
P4: 向量可插拔   — 内置 SQLite vec0 够用；追求极致可外接 Qdrant/Milvus
P5: 渐进增强     — 基础功能零配置可用，高级功能按需开启
P6: 优雅降级     — API 挂了用本地，本地也挂了用纯正则+BM25，永不阻塞
P7: 记忆有生命   — 记忆不是永久的，要有衰减、合并、遗忘（但永不彻底丢失）
```

---

## 2. 核心架构：Sidecar 模式 + 多客户端接入

**产出形态：独立服务 + 多种接入方式 + Web 管理面板**

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Client Layer                                   │
│                                                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  OpenClaw    │  │   Claude    │  │ LangChain│  │  自建 Agent   │   │
│  │             │  │   Desktop   │  │  / any   │  │  / 脚本      │   │
│  │ Bridge      │  │             │  │  Agent   │  │              │   │
│  │ Plugin      │  │             │  │          │  │              │   │
│  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  └──────┬───────┘   │
│         │                │              │               │            │
│    REST API          MCP Server      REST API       REST API         │
│         │                │              │               │            │
└─────────┼────────────────┼──────────────┼───────────────┼────────────┘
          │                │              │               │
          ▼                ▼              ▼               ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      Cortex Sidecar Server                             │
│                      (独立 Node.js 进程)                               │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                     API / Protocol Layer                        │   │
│  │                                                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │   │
│  │  │  REST API     │  │  MCP Server  │  │  Dashboard Static   │ │   │
│  │  │  :21100/api   │  │  stdio/SSE   │  │  :21100/            │ │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘ │   │
│  │         └─────────────────┴─────────────────────┘             │   │
│  └────────────────────────────┬───────────────────────────────────┘   │
│                               ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                     Core Engine                                 │   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │   │
│  │  │ Memory   │  │ Memory   │  │ Memory   │  │  Lifecycle    │ │   │
│  │  │ Gate     │  │ Sieve    │  │ Flush+   │  │  Engine       │ │   │
│  │  │ (检索)   │  │ (提取)   │  │ (刷新)   │  │  (夜间维护)   │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────────┘ │   │
│  └────────────────────────────┬───────────────────────────────────┘   │
│                               ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                     Storage Layer                               │   │
│  │                                                                 │   │
│  │  SQLite (主存储)  +  FTS5 (全文)  +  Vector Backend (语义)     │   │
│  │  Markdown Exporter (导出)  +  LLM/Embedding Provider (API)     │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                  Management Dashboard (React SPA)               │   │
│  │  记忆浏览器 | 搜索调试 | 实体关系图 | 生命周期监控 | 配置管理    │   │
│  └────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.1 四个交付物

| 交付物 | 形态 | 职责 |
|--------|------|------|
| **Cortex Server** | 独立 Node.js 服务 | 核心引擎：存储、检索、提取、生命周期、REST API、MCP Server |
| **MCP Server** | 内嵌于 Cortex Server | 让 Claude Desktop / Cursor 等 MCP 客户端直接调用 Cortex |
| **Bridge Plugin** | OpenClaw 薄插件 (~200 行) | 桥接：转发 OpenClaw 消息到 Cortex REST API |
| **Dashboard** | React SPA (内嵌于 Server) | 管理面板：可视化、编辑、监控、调试 |

### 2.2 三种接入方式

#### 接入方式 1: REST API（通用，任何 Agent）

最基础的接入方式，任何能发 HTTP 的程序都能用：

```bash
# 摄入记忆
curl -X POST http://localhost:21100/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "my-agent",
    "user_message": "帮我看下品川区这个1LDK",
    "assistant_message": "表面利回5%，考虑管理费后实际利回约4.2%..."
  }'

# 检索记忆
curl -X POST http://localhost:21100/api/v1/recall \
  -d '{"agent_id": "my-agent", "query": "之前讨论的投资物件"}'
```

#### 接入方式 2: MCP（Claude Desktop / Cursor / Windsurf 等）

通过 Model Context Protocol，Claude Desktop 可以直接把 Cortex 当作一个工具使用：

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "cortex": {
      "command": "cortex-mcp",
      "args": ["--server-url", "http://localhost:21100"]
    }
  }
}
```

**MCP 暴露的 Tools：**

```typescript
// Cortex MCP Server 注册的工具
const tools = [
  {
    name: "cortex_recall",
    description: "Search your memory for relevant past conversations and facts",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        max_results: { type: "number", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "cortex_remember",
    description: "Store an important fact, preference, or decision in memory",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "What to remember" },
        category: {
          type: "string",
          enum: ["preference", "fact", "decision", "identity", "todo"],
        },
        importance: { type: "number", minimum: 0, maximum: 1, default: 0.7 },
      },
      required: ["content"],
    },
  },
  {
    name: "cortex_forget",
    description: "Remove or correct a memory",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "cortex_search_debug",
    description: "Debug search results with full scoring details",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
];
```

**MCP 使用体验：** Claude Desktop 里直接说"记住我偏好低风险投资"，Claude 会调用 `cortex_remember`。下次对话说"我之前的投资偏好是什么"，Claude 调用 `cortex_recall` 自动找到。

**MCP 的独特优势——Agent 主动使用记忆：**
与 REST API 被动注入不同，MCP 让 Agent 自己决定何时读写记忆。Claude 可以在对话中判断"这个信息值得记住"然后主动调 `cortex_remember`，比 Sieve 的自动提取更精准。

#### 接入方式 3: Bridge Plugin（OpenClaw 专用）

OpenClaw 侧的薄插件，自动在 hook 中调用 REST API，对用户透明：

```typescript
// openclaw-cortex-bridge/src/index.ts (~200 行)
// 详见 2.4 节
```

### 2.3 为什么选 Sidecar 而不是纯插件

| 维度 | 纯插件 | Sidecar |
|------|--------|---------|
| hook API 受限 | ❌ 受限于 OpenClaw 暴露的 hook | ✅ 完全自主 |
| 多 Agent 支持 | ❌ 仅 OpenClaw | ✅ 任何 Agent (REST/MCP) |
| Claude Desktop 接入 | ❌ 不可能 | ✅ MCP Server |
| 管理面板 | ❌ 无法提供 Web UI | ✅ 内嵌 Dashboard |
| 独立部署/更新 | ⚠️ 依赖 OpenClaw 插件机制 | ✅ 独立进程，独立版本 |
| 稳定性 | ⚠️ 插件崩溃可能影响 OpenClaw | ✅ 进程隔离 |
| 运维复杂度 | ✅ 单进程 | ⚠️ 多一个进程（但 Docker 一键启动）|

### 2.4 REST API 设计

```
Cortex Server API  (默认 localhost:21100)
─────────────────────────────────────────────────

# === Agent 调用（Bridge Plugin 使用）===

POST   /api/v1/recall          # Memory Gate：检索相关记忆
       Body: { query, agent_id, max_tokens?, layers? }
       Response: { context: string, memories: Memory[], meta }

POST   /api/v1/ingest          # Memory Sieve：摄入新对话
       Body: { user_message, assistant_message, agent_id, session_id }
       Response: { extracted: Memory[], high_signals: Signal[] }

POST   /api/v1/flush           # Memory Flush+：紧急刷新
       Body: { messages, agent_id, session_id, reason }
       Response: { flushed: Memory[] }

# === 搜索 ===

POST   /api/v1/search          # 混合搜索
       Body: { query, layers?, categories?, limit?, debug? }
       Response: { results: SearchResult[], debug?: SearchDebug }

# === 记忆 CRUD（Dashboard 使用）===

GET    /api/v1/memories         # 列表（支持分页、过滤、排序）
GET    /api/v1/memories/:id     # 详情
POST   /api/v1/memories         # 创建
PATCH  /api/v1/memories/:id     # 更新
DELETE /api/v1/memories/:id     # 删除（软删除，移入 Archive）

# === 实体关系 ===

GET    /api/v1/relations        # 关系图
POST   /api/v1/relations        # 创建关系
DELETE /api/v1/relations/:id    # 删除关系

# === 生命周期 ===

POST   /api/v1/lifecycle/run    # 手动触发生命周期
GET    /api/v1/lifecycle/log    # 查看历史报告
GET    /api/v1/lifecycle/preview # 预览（dry-run）下次会做什么

# === 系统 ===

GET    /api/v1/stats            # 统计（记忆总数、各层分布、搜索延迟等）
GET    /api/v1/config           # 当前配置
PATCH  /api/v1/config           # 热更新配置（部分字段）
POST   /api/v1/export           # 导出（SQLite dump / Markdown / JSON）
POST   /api/v1/import           # 导入（从旧 MEMORY.md / 其他格式迁移）
GET    /api/v1/health           # 健康检查

# === Dashboard ===

GET    /                        # React SPA 入口
GET    /assets/*                # 静态资源
```

### 2.5 Bridge Plugin（OpenClaw 侧薄插件）

整个插件约 200 行代码，职责极简——只做转发和注入：

```typescript
// openclaw-cortex-bridge/src/index.ts
import { Plugin, AgentContext } from '@openclaw/sdk';

const CORTEX_URL = process.env.CORTEX_URL || 'http://localhost:21100';

export default class CortexBridge extends Plugin {
  name = 'cortex-bridge';

  async onBeforeResponse(context: AgentContext) {
    try {
      // 1. 调 Sidecar 检索相关记忆
      const res = await fetch(`${CORTEX_URL}/api/v1/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: context.lastUserMessage,
          agent_id: context.agentId,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(3000), // 3秒超时，不拖慢 Agent
      });

      if (res.ok) {
        const { context: memoryContext } = await res.json();
        if (memoryContext) {
          return { prependContext: memoryContext };
        }
      }
    } catch (e) {
      // Sidecar 不可用时静默降级——Agent 正常工作，只是没有记忆增强
      console.warn('[cortex-bridge] Sidecar unreachable, skipping recall');
    }
    return null;
  }

  async onAfterResponse(context: AgentContext) {
    try {
      // 2. 异步发送对话到 Sidecar 提取记忆（不等待结果）
      fetch(`${CORTEX_URL}/api/v1/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message: context.lastUserMessage,
          assistant_message: context.lastAssistantMessage,
          agent_id: context.agentId,
          session_id: context.sessionId,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}); // fire-and-forget
    } catch (e) {
      // 静默失败
    }
  }

  async onBeforeCompaction(context: AgentContext) {
    try {
      await fetch(`${CORTEX_URL}/api/v1/flush`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: context.messages,
          agent_id: context.agentId,
          session_id: context.sessionId,
          reason: 'compaction',
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.warn('[cortex-bridge] Flush failed, some context may be lost');
    }
  }
}
```

**关键设计：Bridge 绝不阻塞 Agent。**
- `/recall` 有 3 秒硬超时，超时就跳过
- `/ingest` 用 fire-and-forget，不等结果
- Sidecar 挂了，Agent 照常工作，只是没有记忆增强

---

## 3. 三层记忆模型

灵感来源：人类记忆的工作记忆 → 长期记忆 → 遗忘曲线。

### 3.1 Working Memory（工作记忆）

**类比：** 人的工作记忆/短期记忆
**存储：** SQLite `memories` 表，`layer = 'working'`
**Markdown 镜像：** 自动导出到 `memory/working/YYYY-MM-DD.md`
**TTL：** 48 小时（`expires_at = created_at + 48h`）
**写入时机：** 每轮对话后自动追加

**SQLite 写入示例：**

```sql
INSERT INTO memories (id, layer, category, content, importance, confidence, expires_at, source)
VALUES (
  '019510a4-7e01-7000-8000-000000000001',
  'working',
  'context',
  '用户询问了东京品川区 1LDK 的投资回报率，提供了 5% 表面利回作为参考',
  0.5,
  0.9,
  datetime('now', '+48 hours'),
  'session:2026-02-20-001'
);
```

**自动导出的 Markdown 镜像：**

```markdown
---
exported_at: 2026-02-20T15:30:00Z
source: cortex SQLite
---

## 14:30 — 用户讨论房产投资

- 用户询问了东京品川区 1LDK 的投资回报率
- 提供了 5% 表面利回作为参考
- 用户偏好：低风险、稳定现金流
- [待确认] 用户预算范围

## 15:10 — 技术讨论

- 帮助配置了 Oracle Cloud ARM 实例的 iptables
- 用户的 VPS IP 被标记为 datacenter 类型
- [todo] 调研 ISP 类型 IP 的 VPS 提供商
```

### 3.2 Core Memory（核心记忆）

**类比：** 人的长期陈述性记忆
**存储：** SQLite `memories` 表，`layer = 'core'`
**Markdown 镜像：** 自动导出到 `MEMORY.md`（OpenClaw Bootstrap 直接加载）
**TTL：** 永久（`expires_at = NULL`）
**写入时机：** Lifecycle Engine 夜间晋升 + 高信号即时直写

**Core Memory 记录示例：**

```sql
-- 高信号即时直写：用户声明了身份
INSERT INTO memories (id, layer, category, content, importance, confidence)
VALUES (
  '019510a4-8f02-7000-8000-000000000010',
  'core',
  'identity',
  'Harry，东京居民，不动产投资者 + 技术评估专家，精通中日英三语',
  1.0,   -- identity 类型重要性最高
  0.95,  -- 用户显式声明，置信度高
  NULL   -- 永不过期
);

-- 修正链：新记忆覆盖旧记忆
INSERT INTO memories (id, layer, category, content, importance, superseded_by)
VALUES (
  '...new-id...',
  'core',
  'correction',
  '用户未确认具体预算（之前记录的5000万日元有误）',
  0.8,
  NULL  -- 这是最新的
);
UPDATE memories SET superseded_by = '...new-id...'
WHERE id = '...old-wrong-budget-id...';
```

**自动导出的 MEMORY.md（供 OpenClaw Bootstrap 加载）：**

```markdown
---
exported_at: 2026-02-20T03:00:00Z
total_entries: 47
source: cortex SQLite
---

## 用户画像

- Harry，东京居民，不动产投资者 + 技术评估专家
- 语言: 中文(母语) / 日文(流利) / 英文(流利)

## 偏好与习惯

- 投资风格: 低风险、稳定现金流、偏好东京都内
- 技术栈: Ubuntu Server, OpenClaw, Clash Verge, 1Panel
- 沟通偏好: 中文回答，直接高效，不要废话

## 关键决策记录

- [2026-02-15] 决定将 Chromebook 转换为 Ubuntu Server
- [2026-02-18] 选择 Oracle Cloud ARM 作为主要 VPS
- [2026-02-20] 开始研究 OpenClaw 记忆增强方案

## 实体关系

- Harry ──投资于──▶ 东京品川区物业
- Harry ──使用──▶ OpenClaw (个人部署)
- Harry ──管理──▶ Ubuntu Server (Chromebook 改装)

## 修正记录

- [2026-02-16] ❌ 用户预算 5000 万日元 → ✅ 未确认具体预算

## 历史记忆摘要

- [2026-01] 调研日本癌症治疗方案(BNCT/树突细胞)；NTT路由器IPv6配置；域名价格分析
```

### 3.3 Archive Memory（归档记忆）

**类比：** 人的远期记忆（模糊但可检索）
**存储：** `memory/archive/YYYY-MM.md`
**TTL：** 90 天（可配置），**过期后压缩回 Core，不丢弃**
**写入时机：** Lifecycle Engine 从 Core 降级
**格式：**

```markdown
---
type: archive
period: 2026-01
entries: 47
compressed_from: 312 entries
---

## 摘要

2026年1月主要讨论了日本癌症治疗方案（BNCT、树突细胞疗法）的调研，
以及 NTT 路由器配置和域名价格分析。用户开始探索小红书运营策略。

## 关键条目（按访问频率排序）

- BNCT 治疗：南东北医院、国立がん研究中心提供，费用约 300 万日元
- NTT HGW 路由器：需要在 IPv6 模式下配置端口转发
- 域名 .ai 续费：约 $80/年
```

### 3.4 记忆永不丢失：闭环生命周期

**核心原则：没有任何记忆会被真正删除。** 完整生命周期是一个闭环：

```
Working (48h)  ──晋升──▶  Core (永久)  ──降级──▶  Archive (90d)
    临时对话                 精炼事实                 低频条目
                               ▲                        │
                               │                        │
                               └───压缩回流─────────────┘
                            (超级摘要永久保留在 Core
                             的 "历史记忆摘要" 区域)
```

Archive 过期后，条目被 LLM 压缩为超级摘要（例如将 47 条归档压缩为 3-5 句话），写入 Core Memory 的 `## 历史记忆摘要` 区域，**永久保留**。原始 Archive 文件可选择保留（磁盘空间充足时）或删除（释放空间）。

这意味着即使是一年前的对话，Agent 仍然能以摘要形式回忆起来——就像人类记忆中"我记得去年大概讨论过这个话题，细节模糊了但方向是对的"。

**Core Memory 内部结构因此扩展为：**

```markdown
## 用户画像          ← 永久，几乎不衰减
## 偏好与习惯        ← 永久，缓慢衰减
## 关键决策记录       ← 永久，中等衰减
## 实体关系          ← 永久，缓慢衰减
## 修正记录          ← 永久，快速覆盖
## 历史记忆摘要       ← 永久，从 Archive 压缩回流
```

---

## 4. 存储架构：SQLite 为主 + 可选向量数据库

### 4.1 为什么从 Markdown 优先切换到 SQLite 优先

| 需求 | Markdown | SQLite |
|------|----------|--------|
| 结构化查询（按类型/分数/时间过滤） | ❌ 需解析全文 | ✅ `WHERE layer='core' AND importance > 0.7` |
| 并发写入安全 | ❌ 文件锁冲突 | ✅ WAL 模式支持并发读写 |
| 原子事务（跨层晋升/降级） | ❌ 无法保证 | ✅ `BEGIN...COMMIT` |
| 元数据管理（访问计数/衰减分数） | ⚠️ YAML frontmatter 笨拙 | ✅ 原生字段 |
| 性能（1000+ 条记忆） | ❌ 全文解析 O(n) | ✅ 索引查询 O(log n) |
| 人类可读 | ✅ 原生优势 | ❌ 二进制文件 |
| Git 版本控制 | ✅ diff 友好 | ❌ 二进制 diff 无意义 |
| 与 OpenClaw 原生兼容 | ✅ Bootstrap 直接加载 | ⚠️ 需导出 MEMORY.md |

**结论：SQLite 为主存储，Markdown 作为自动导出的可读镜像。** 两者优势兼得。

### 4.2 数据库 Schema

```sql
-- ~/.openclaw/cortex/brain.db

-- 核心记忆表
CREATE TABLE memories (
  id            TEXT PRIMARY KEY,        -- UUID v7（时间有序）
  layer         TEXT NOT NULL,           -- 'working' | 'core' | 'archive'
  category      TEXT NOT NULL,           -- 'identity' | 'preference' | 'decision' |
                                         -- 'fact' | 'entity' | 'correction' |
                                         -- 'todo' | 'context' | 'summary'
  content       TEXT NOT NULL,           -- 记忆内容（纯文本）
  source        TEXT,                    -- 来源标识（session_id / 'lifecycle' / 'manual'）
  importance    REAL NOT NULL DEFAULT 0.5, -- 基础重要性 [0, 1]
  confidence    REAL NOT NULL DEFAULT 0.8, -- 置信度 [0, 1]
  decay_score   REAL NOT NULL DEFAULT 1.0, -- 当前衰减分数 [0, 1]
  access_count  INTEGER NOT NULL DEFAULT 0,
  last_accessed DATETIME,
  created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at    DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at    DATETIME,                -- Working: +48h, Archive: +90d, Core: NULL
  superseded_by TEXT,                    -- 被哪条记忆覆盖（修正链）
  metadata      TEXT                     -- JSON 扩展字段
);

-- 全文搜索索引（BM25）
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  category,
  content=memories,
  content_rowid=rowid,
  tokenize='trigram'                     -- 支持中日英混合搜索
);

-- 内置向量索引（SQLite vec0 扩展，零外部依赖）
CREATE VIRTUAL TABLE memories_vec USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding FLOAT[768]                   -- 维度随嵌入模型调整
);

-- 访问日志（驱动衰减计算和检索优化）
CREATE TABLE access_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id   TEXT NOT NULL REFERENCES memories(id),
  query       TEXT,                       -- 触发检索的查询
  rank        INTEGER,                    -- 在结果中的排名
  was_useful  BOOLEAN,                    -- Agent 是否实际使用了这条记忆
  accessed_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- 生命周期审计日志
CREATE TABLE lifecycle_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL,              -- 'promote' | 'merge' | 'archive' |
                                          -- 'compress' | 'restore' | 'delete'
  memory_ids  TEXT NOT NULL,              -- JSON array of affected IDs
  details     TEXT,                       -- JSON: before/after snapshots
  executed_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- 实体关系表（轻量知识图谱）
CREATE TABLE relations (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,              -- "Harry"
  predicate   TEXT NOT NULL,              -- "投资于"
  object      TEXT NOT NULL,              -- "品川区物业"
  confidence  REAL NOT NULL DEFAULT 0.8,
  source_memory_id TEXT REFERENCES memories(id),
  created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- 高性能索引
CREATE INDEX idx_memories_layer ON memories(layer);
CREATE INDEX idx_memories_category ON memories(layer, category);
CREATE INDEX idx_memories_decay ON memories(layer, decay_score);
CREATE INDEX idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_access_log_memory ON access_log(memory_id, accessed_at);
CREATE INDEX idx_relations_subject ON relations(subject);
CREATE INDEX idx_relations_object ON relations(object);
```

### 4.3 向量搜索后端：渐进增强

```
Level 0: 纯 BM25                      ← 零配置，FTS5 全文搜索
Level 1: SQLite vec0 内置向量          ← 默认，零外部依赖
Level 2: QMD 本地混合搜索              ← 2GB 模型，完全离线
Level 3: Qdrant / Milvus / Chroma     ← 外接高性能向量数据库
```

**Level 1（默认）** 使用 SQLite vec0 扩展，嵌入维度 768，精确 KNN 搜索，对 10K 以内的记忆条目完全够用。

**Level 3 接入示例（Qdrant）：**

```typescript
// 向量后端接口——所有实现共享同一接口
interface VectorBackend {
  upsert(id: string, embedding: number[], metadata: Record<string, any>): Promise<void>;
  search(query: number[], topK: number, filter?: Filter): Promise<VectorResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
}

// Qdrant 实现
class QdrantBackend implements VectorBackend {
  constructor(private client: QdrantClient, private collection: string) {}

  async upsert(id: string, embedding: number[], metadata: Record<string, any>) {
    await this.client.upsert(this.collection, {
      points: [{ id, vector: embedding, payload: metadata }],
    });
  }

  async search(query: number[], topK: number, filter?: Filter) {
    return this.client.search(this.collection, {
      vector: query,
      limit: topK,
      filter: filter ? this.toQdrantFilter(filter) : undefined,
      with_payload: true,
    });
  }
}

// SQLite vec0 实现（默认，零配置）
class SqliteVecBackend implements VectorBackend {
  async search(query: number[], topK: number, filter?: Filter) {
    // vec0 使用 SQL 查询
    const rows = await this.db.all(`
      SELECT memory_id, distance
      FROM memories_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `, [JSON.stringify(query), topK]);
    return rows;
  }
}
```

**配置切换：**

```json
{
  "cortex": {
    "vectorBackend": {
      "provider": "sqlite-vec",
      "providers": {
        "sqlite-vec": {},
        "qdrant": {
          "url": "http://localhost:6333",
          "collection": "cortex",
          "apiKey": "${QDRANT_API_KEY}"
        },
        "milvus": {
          "uri": "http://localhost:19530",
          "collection": "cortex"
        }
      }
    }
  }
}
```

### 4.4 Markdown 导出器（自动同步）

SQLite 是真实来源，但 Markdown 镜像保证：
- 人类随时可以直接阅读记忆内容
- Git 版本控制追踪记忆演变
- OpenClaw 原生 Bootstrap 能加载 MEMORY.md

```typescript
class MarkdownExporter {
  // 在每次写入操作后异步触发（不阻塞主流程）
  async exportAll(): Promise<void> {
    await Promise.all([
      this.exportCoreToMemoryMd(),    // → MEMORY.md（OpenClaw Bootstrap 加载）
      this.exportWorkingToDaily(),     // → memory/working/YYYY-MM-DD.md
      this.exportArchiveToMonthly(),   // → memory/archive/YYYY-MM.md
      this.exportRelationsToGraph(),   // → memory/relations.md（实体关系图）
    ]);
  }

  private async exportCoreToMemoryMd() {
    const coreMemories = await this.db.all(
      `SELECT * FROM memories WHERE layer = 'core' ORDER BY category, importance DESC`
    );

    // 按 category 分组，生成结构化 Markdown
    const sections = groupBy(coreMemories, 'category');
    const markdown = [
      `---`,
      `exported_at: ${new Date().toISOString()}`,
      `total_entries: ${coreMemories.length}`,
      `source: cortex SQLite`,
      `---`,
      '',
      ...Object.entries(sections).map(([cat, entries]) =>
        `## ${CATEGORY_LABELS[cat]}\n\n` +
        entries.map(e => `- ${e.content}`).join('\n')
      ),
    ].join('\n');

    await writeFile('~/.openclaw/workspace/MEMORY.md', markdown);
  }
}
```

**导出频率：**
- Core 变更后：**立即异步导出** MEMORY.md（保证 Bootstrap 一致性）
- Working 变更后：**批量导出**（5 分钟 debounce）
- Archive 变更后：**Lifecycle Engine 完成后统一导出**

### 4.5 数据完整性保证

```typescript
// 跨层操作使用事务
async function promoteToCore(entry: WorkingMemory): Promise<void> {
  await db.run('BEGIN TRANSACTION');
  try {
    // 1. 插入 Core
    await db.run(
      `INSERT INTO memories (id, layer, category, content, importance, ...)
       VALUES (?, 'core', ?, ?, ?, ...)`,
      [newId(), entry.category, entry.content, entry.importance]
    );
    // 2. 标记 Working 条目为已晋升
    await db.run(
      `UPDATE memories SET superseded_by = ? WHERE id = ?`,
      [newId, entry.id]
    );
    // 3. 同步向量索引
    await vectorBackend.upsert(newId, await embed(entry.content), { layer: 'core' });
    // 4. 记录审计日志
    await db.run(
      `INSERT INTO lifecycle_log (action, memory_ids, details) VALUES (?, ?, ?)`,
      ['promote', JSON.stringify([entry.id]), JSON.stringify({ from: 'working', to: 'core' })]
    );

    await db.run('COMMIT');

    // 5. 异步导出 Markdown（不阻塞事务）
    this.exporter.scheduleExport('core');
  } catch (e) {
    await db.run('ROLLBACK');
    throw e;
  }
}
```

---

## 5. 五大核心组件

### 5.1 Memory Gate（检索+注入）

**触发点：** OpenClaw `agent:beforeResponse` hook
**作用：** 在 Agent 生成回复前，搜索相关记忆并注入上下文

```typescript
// 伪代码
async function memoryGate(context: AgentContext): Promise<PrependContext> {
  const query = context.lastUserMessage;

  // 1. 快速路径：如果消息太短或是闲聊，跳过检索
  if (isSmallTalk(query)) return null;

  // 2. 三层并行搜索
  const [working, core, archive] = await Promise.all([
    searchLayer('working', query, { maxResults: 3 }),
    searchLayer('core', query, { maxResults: 5 }),
    searchLayer('archive', query, { maxResults: 2 }),
  ]);

  // 3. 融合排序 + 去重
  const merged = fuseResults([
    { results: core, weight: 1.0 },      // Core 权重最高
    { results: working, weight: 0.8 },    // Working 次之
    { results: archive, weight: 0.5 },    // Archive 最低
  ], { maxTotal: 8, dedup: true });

  // 4. 格式化注入（不超过 2000 tokens）
  const injection = formatForInjection(merged, { maxTokens: 2000 });

  // 5. 更新访问计数（用于衰减计算）
  await bumpAccessCounts(merged.map(r => r.id));

  return { prependContext: injection };
}
```

**关键设计决策：**
- **三层并行搜索**而非单一搜索，因为不同层的记忆粒度不同
- **层级权重**确保 Core 记忆优先于碎片化的 Working 记忆
- **访问计数更新**驱动后续的衰减/降级决策
- **2000 tokens 上限**避免挤压 Agent 的思考空间

### 5.2 Memory Sieve（智能记忆提取）

**触发点：** OpenClaw `agent:afterResponse` hook（或 REST API `/ingest`）
**作用：** 从整轮对话（用户消息 + Agent 回复）中提取值得记住的信息
**核心原则：** 像人类一样记忆——不是"这是不是个人信息"，而是"未来再遇到类似话题时，哪些信息能让我更有帮助"

#### 5.2.1 为什么现有方案不够

现有记忆插件的提取策略普遍存在三个问题：

| 问题 | 典型表现 | Cortex 解决方案 |
|------|---------|----------------|
| **只看用户消息** | Agent 花 30 分钟算出利回 4.2%，下次从零算 | 同时提取用户输入和 Agent 产出 |
| **只提取"个人信息"** | 用户说"品川区不如大田区"不是个人信息，但有价值 | 多维度价值评估，不限于个人信息 |
| **二元判断（记/不记）** | 所有记忆同等对待，无法区分重要性 | 输出结构化记忆条目，带类型、重要性、置信度 |

#### 5.2.2 双通道提取架构

```
一轮对话完成
    │
    ▼
┌──────────────────────────────────────────────────┐
│              Memory Sieve                         │
│                                                   │
│  通道 1: 快速通道（正则，0ms，无 API 调用）       │
│  ├─ 高信号模式匹配（身份/偏好/决策/修正/待办）   │
│  ├─ 命中 → 直写 Core Memory                      │
│  └─ 不阻塞通道 2                                 │
│                                                   │
│  通道 2: 深度通道（LLM，200-400ms）              │
│  ├─ 输入：完整的 user + assistant 消息            │
│  ├─ LLM 做多维度价值评估                         │
│  ├─ 输出：结构化记忆条目列表（可能 0-N 条）      │
│  └─ 写入 Working Memory                          │
└──────────────────────────────────────────────────┘
```

**两个通道并行执行，互不阻塞。** 通道 1 保证高信号零延迟捕获，通道 2 负责深度理解。

#### 5.2.3 通道 1: 快速通道（正则检测 + 直写 Core）

与之前设计一致，用正则和关键词检测高信号模式：

```typescript
const HIGH_SIGNAL_PATTERNS = {
  correction: /不是[^，。]+[，。]\s*(而)?是|其实是|搞错了|更正/,
  preference: /我(喜欢|偏好|不要|不想|讨厌|prefer)/,
  identity:   /我是[^，。]*[的]?(人|工程师|投资者|开发者)/,
  decision:   /决定|选择了|最终用|确定用|就这样吧/,
  todo:       /记得|需要|待办|别忘了|提醒我|todo/i,
  important:  /重要[：:：]|关键是|核心是|本质上/,
};
```

高信号命中 → 立即 upsert Core Memory，不等 LLM。

#### 5.2.4 通道 2: 深度通道（LLM 智能提取）

这是核心创新——用一个精心设计的 prompt 让 LLM 做**多维度价值评估**。

**关键设计决策：LLM 同时看用户消息和 Agent 回复。** 因为：

- Agent 的回复中包含计算结果、调研结论、建议方案——这些都是用户未来可能需要的
- 用户的问题本身揭示了他的关注点和知识盲区
- 用户对 Agent 回复的反应（接受/拒绝/追问）暴露了真实偏好

**提取 Prompt（核心）：**

```typescript
const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction engine for an AI assistant.
Your job is to analyze a conversation exchange and extract information worth remembering for future conversations.

IMPORTANT PRINCIPLES:
1. Think like a skilled personal assistant who has been working with this person for years.
   Ask yourself: "If this person comes back tomorrow with a related question, what from today's conversation would help me serve them better?"

2. Extract from BOTH the user's messages AND the assistant's responses.
   - User messages reveal: preferences, goals, constraints, knowledge level, context
   - Assistant responses reveal: conclusions, calculations, recommendations, explanations that took effort to produce

3. DO NOT limit extraction to "personal information". Valuable memories include:
   - Factual conclusions reached through analysis (e.g., "actual yield is 4.2% after fees")
   - User's reactions to suggestions (accepted/rejected/modified → reveals preferences)
   - Technical configurations that were debugged together
   - Domain-specific knowledge the user demonstrated or learned
   - Evolving understanding of a topic across the conversation
   - Unresolved questions or next steps

4. Each extracted memory should be SELF-CONTAINED — understandable without the original conversation.
   Bad:  "discussed yield calculation"
   Good: "品川区1LDK物件：表面利回5%，管理费月1.2万日元，实际利回约4.2%"

5. Output 0 items if the exchange is genuinely not worth remembering (pure small talk, greetings, etc.)

CATEGORIZE each memory into exactly one type:`;

const EXTRACTION_USER_PROMPT = `Analyze this conversation exchange and extract memories worth keeping.

<exchange>
<user>{user_message}</user>
<assistant>{assistant_message}</assistant>
</exchange>

For each memory worth extracting, output a JSON object with these fields:

{
  "memories": [
    {
      "content": "Self-contained description of what to remember",
      "category": "one of: identity | preference | decision | fact | insight | todo | correction | skill | relationship | project_state",
      "importance": 0.0-1.0,
      "source": "user | assistant | both",
      "reasoning": "Brief explanation of why this is worth remembering (for debugging, not stored)"
    }
  ]
}

CATEGORY GUIDE:
- identity: Who the user is, their role, location, background
- preference: Likes, dislikes, style preferences, communication preferences
- decision: Choices made, options selected, commitments
- fact: Verified information, calculation results, research findings
- insight: User's opinions, analyses, comparisons, evaluations
- todo: Pending actions, things to follow up on, reminders
- correction: Something previously believed wrong that was corrected
- skill: User's expertise level, tools they know, languages they speak
- relationship: People, companies, properties, assets the user is connected to
- project_state: Current status of ongoing projects, where things left off

IMPORTANCE GUIDE:
- 0.9-1.0: Core identity, strong preferences, major decisions (rare)
- 0.7-0.8: Important facts, active project states, verified conclusions
- 0.5-0.6: Useful context, opinions, comparisons
- 0.3-0.4: Minor details, transient context
- 0.1-0.2: Barely worth keeping, but might be useful in aggregate

Output ONLY valid JSON, no other text.`;
```

#### 5.2.5 提取示例

**示例 1：投资讨论（用户 + Agent 回复都有价值）**

```
用户: 帮我算一下品川区这个1LDK的实际利回，表面利回5%，管理费月1.2万
Agent: 年管理费14.4万，假设房价2000万，实际利回 = (100-14.4)/2000 = 4.28%。
       考虑修缮积立金和固定资产税，综合利回约3.8-4.0%。这个区域近3年的
       成交价中位数是1850-2100万，你的预算在合理范围内。

LLM 提取结果:
{
  "memories": [
    {
      "content": "品川区1LDK投资评估：表面利回5%，管理费月1.2万(年14.4万)，实际利回约4.28%，综合利回3.8-4.0%(含修缮积立金+固定资产税)",
      "category": "fact",
      "importance": 0.7,
      "source": "both",
      "reasoning": "Detailed calculation result that took analysis effort. User will likely reference this when comparing properties."
    },
    {
      "content": "品川区1LDK近3年成交价中位数1850-2100万日元",
      "category": "fact",
      "importance": 0.5,
      "source": "assistant",
      "reasoning": "Market data point useful for future property comparisons in this area."
    },
    {
      "content": "用户正在积极评估品川区投资物件，关注实际利回而非表面利回",
      "category": "project_state",
      "importance": 0.6,
      "source": "user",
      "reasoning": "Ongoing activity - user is in active property evaluation phase."
    }
  ]
}
```

**示例 2：技术调试（Agent 的解决方案有高价值）**

```
用户: Oracle Cloud ARM的iptables一直不生效，重启后规则全丢了
Agent: ARM实例用的是nftables不是iptables。用 iptables-persistent 或者
       直接写 nft 规则到 /etc/nftables.conf，然后 systemctl enable nftables。
       另外注意 Oracle 的 Security List 也要开对应端口。

LLM 提取结果:
{
  "memories": [
    {
      "content": "Oracle Cloud ARM实例使用nftables而非iptables。持久化方案：iptables-persistent 或 nft规则写入 /etc/nftables.conf + systemctl enable nftables",
      "category": "fact",
      "importance": 0.7,
      "source": "assistant",
      "reasoning": "Technical solution that was debugged together. User has Oracle ARM instances and will likely need this again."
    },
    {
      "content": "Oracle Cloud除了OS防火墙，还需要在Security List中开放端口（双层防火墙）",
      "category": "fact",
      "importance": 0.6,
      "source": "assistant",
      "reasoning": "Common pitfall that user might encounter again with new ports/services."
    },
    {
      "content": "用户在管理Oracle Cloud ARM VPS，运行中遇到了防火墙配置问题",
      "category": "project_state",
      "importance": 0.4,
      "source": "user",
      "reasoning": "Context about user's infrastructure setup."
    }
  ]
}
```

**示例 3：闲聊（不提取）**

```
用户: 今天天气真好
Agent: 是啊，东京今天晴天，适合出去走走！

LLM 提取结果:
{
  "memories": []
}
```

**示例 4：用户拒绝了建议（隐含偏好）**

```
用户: 你建议的 Cloudflare Workers 方案太复杂了，我就想要个简单的静态站
Agent: 明白，那推荐 GitHub Pages + Jekyll，零成本，push 即部署...

LLM 提取结果:
{
  "memories": [
    {
      "content": "用户偏好简单方案，拒绝了Cloudflare Workers认为太复杂。倾向零配置/低复杂度的部署方案",
      "category": "preference",
      "importance": 0.7,
      "source": "both",
      "reasoning": "User rejected a suggestion, revealing strong preference for simplicity. This should influence future recommendations."
    },
    {
      "content": "用户选择了GitHub Pages + Jekyll作为静态站部署方案",
      "category": "decision",
      "importance": 0.6,
      "source": "both",
      "reasoning": "Active decision that affects future discussions about the user's web setup."
    }
  ]
}
```

#### 5.2.6 完整 Sieve 流程

```typescript
async function memorySieve(
  userMessage: string,
  assistantMessage: string,
  agentId: string,
  sessionId: string,
): Promise<SieveResult> {

  // === 通道 1: 快速通道（并行启动）===
  const fastChannelPromise = (async () => {
    const highSignals = detectHighSignals(userMessage);
    const results: Memory[] = [];
    for (const signal of highSignals) {
      const memory = await upsertCoreMemory({
        content: signal.content,
        category: signal.category,
        importance: signal.importance,
        source: 'user',
        agent_id: agentId,
      });
      results.push(memory);
    }
    return results;
  })();

  // === 通道 2: 深度通道（并行启动）===
  const deepChannelPromise = (async () => {
    // 跳过条件：消息太短、纯闲聊、或 LLM 不可用
    if (isSmallTalk(userMessage) && assistantMessage.length < 100) {
      return [];
    }

    try {
      const extracted = await llm.complete(
        EXTRACTION_SYSTEM_PROMPT,
        EXTRACTION_USER_PROMPT
          .replace('{user_message}', userMessage)
          .replace('{assistant_message}', assistantMessage),
        { maxTokens: 800, temperature: 0.1 }  // 低温度 = 更稳定的提取
      );

      const parsed = JSON.parse(extracted);
      const memories: Memory[] = [];

      for (const item of parsed.memories) {
        // 写入 Working Memory（通道 2 不直接写 Core）
        const memory = await appendWorkingMemory({
          content: item.content,
          category: item.category,
          importance: item.importance,
          source: item.source,
          agent_id: agentId,
          session_id: sessionId,
        });
        memories.push(memory);
      }
      return memories;
    } catch (e) {
      // LLM 失败 → 降级：把原始对话摘要存入 Working
      log.warn('Deep extraction failed, falling back to raw summary', e);
      const fallback = await appendWorkingMemory({
        content: `[未提取] 用户: ${truncate(userMessage, 100)} | Agent: ${truncate(assistantMessage, 100)}`,
        category: 'context',
        importance: 0.3,
        source: 'both',
        agent_id: agentId,
      });
      return [fallback];
    }
  })();

  // === 两个通道并行执行，汇总结果 ===
  const [fastResults, deepResults] = await Promise.all([
    fastChannelPromise,
    deepChannelPromise,
  ]);

  return {
    highSignals: fastResults,
    extracted: deepResults,
    totalNewMemories: fastResults.length + deepResults.length,
  };
}
```

#### 5.2.7 自动演化的用户画像（User Profile）

提取 prompt 的质量高度依赖于对用户的了解——知道用户是不动产投资者，LLM 就知道利回数据比天气闲聊重要 10 倍。但这不应该靠手动配置，而应该从记忆中**自动合成并持续演化**。

**核心思路：Lifecycle Engine 定期从 Core Memory 合成用户画像，画像反哺给 Sieve 提取 prompt，形成正向闭环。**

```
┌─────────────────────────────────────────────────────┐
│                  正向反馈闭环                         │
│                                                      │
│  对话 ──→ Sieve 提取 ──→ 记忆积累 ──→ Lifecycle     │
│   ▲         (带画像增强)      │          合成画像     │
│   │                           │            │         │
│   │                           ▼            ▼         │
│   │                    Core Memory ←── User Profile  │
│   │                                        │         │
│   └────────────────────────────────────────┘         │
│            画像注入提取 prompt                        │
└─────────────────────────────────────────────────────┘
```

**User Profile 的存储：** 它本身也是一条特殊的 Core Memory，`category = 'profile'`，由系统自动维护，用户也可以在 Dashboard 里手动修正。

**合成时机：**
- **冷启动：** 首次运行时，如果已有历史记忆，立即合成一次
- **定期更新：** Lifecycle Engine 每日凌晨运行时顺带重新合成
- **触发式更新：** 当 Core Memory 中 `identity` / `preference` / `skill` 类别的条目发生变更时，标记画像为 stale，下次 Sieve 调用前重新合成

**合成 Prompt：**

```typescript
const PROFILE_SYNTHESIS_PROMPT = `Based on the following core memories about a user, synthesize a concise user profile.
This profile will be injected into a memory extraction system to help it understand what information is most valuable to this specific user.

<core_memories>
{core_memories_formatted}
</core_memories>

Output a JSON object with these fields:

{
  "summary": "One paragraph describing who this person is and what they care about",
  "domains": ["domain1", "domain2"],
  "high_value_signals": [
    "descriptions of what type of information is especially valuable for this user"
  ],
  "low_value_signals": [
    "descriptions of what type of information this user probably doesn't need remembered"
  ],
  "language_preferences": "how this user prefers to communicate",
  "active_projects": ["brief descriptions of ongoing projects/activities"]
}

Be specific and grounded in the actual memories. Do not speculate beyond what the memories show.
Output ONLY valid JSON.`;
```

**合成示例：**

假设 Core Memory 里已有这些条目：
- identity: Harry，东京居民，不动产投资者 + 技术评估专家
- preference: 低风险、稳定现金流投资风格
- preference: 偏好简单方案，拒绝复杂技术方案
- skill: 精通中日英三语
- skill: 管理多台 Linux 服务器 (Ubuntu, Oracle Cloud ARM)
- project_state: 正在评估品川区投资物件
- decision: 选择 Oracle Cloud ARM 作为 VPS

合成结果：

```json
{
  "summary": "Harry是一位居住在东京的不动产投资者兼技术人员。他同时管理投资物件评估和个人服务器基础设施，偏好低风险投资和简洁的技术方案。精通中日英三语。",
  "domains": [
    "日本不动产投资（利回分析、物件评估、市场数据）",
    "Linux服务器运维（Ubuntu, Oracle Cloud, 网络配置）",
    "AI Agent工具链（OpenClaw, 自部署服务）"
  ],
  "high_value_signals": [
    "投资物件的具体数据：利回、管理费、成交价、区域比较",
    "服务器配置的解决方案：防火墙规则、网络调试、部署方案",
    "用户对建议的接受/拒绝反应（揭示偏好）",
    "计算结论和分析结果（避免重复计算）",
    "日本特有的制度/流程信息（固定资产税、管理组合等）"
  ],
  "low_value_signals": [
    "天气、闲聊等社交性内容",
    "用户已经熟悉的基础技术概念",
    "一次性的格式转换、简单查询等不需要记住的操作"
  ],
  "language_preferences": "中文为主，技术术语可中英混用，涉及日本不动产时可能使用日文术语",
  "active_projects": [
    "品川区投资物件评估（进行中）",
    "Oracle Cloud ARM VPS 配置优化（进行中）",
    "Cortex 记忆系统设计（进行中）"
  ]
}
```

**注入方式：** 画像被格式化为一段自然语言，追加到提取 prompt 的末尾：

```typescript
function buildExtractionPrompt(userMessage: string, assistantMessage: string): string {
  const basePrompt = EXTRACTION_USER_PROMPT
    .replace('{user_message}', userMessage)
    .replace('{assistant_message}', assistantMessage);

  const profile = getCachedProfile(); // 从缓存读取，不是每次都合成

  if (!profile) return basePrompt; // 冷启动：无画像，用通用 prompt

  return basePrompt + `

CONTEXT ABOUT THIS USER (auto-generated from past memories, use to calibrate extraction):
${profile.summary}

Their key domains: ${profile.domains.join(', ')}

HIGH-VALUE information for this user (extract with higher importance):
${profile.high_value_signals.map(s => '- ' + s).join('\n')}

LOW-VALUE for this user (usually skip or extract with low importance):
${profile.low_value_signals.map(s => '- ' + s).join('\n')}

Active projects: ${profile.active_projects.join('; ')}`;
}
```

**画像演化过程：**

```
第 1 天（冷启动）:
  Core Memory: 空
  User Profile: 无
  提取质量: 通用（不差，但不精准）

第 3 天:
  Core Memory: 3 条 identity + 2 条 preference
  User Profile: "用户似乎对投资和服务器管理感兴趣"
  提取质量: 开始关注投资数据

第 2 周:
  Core Memory: 15 条，覆盖多个领域
  User Profile: 详细画像（如上面的示例）
  提取质量: 精准——知道利回数据重要、知道用户偏好简洁

第 2 月:
  画像更新: 发现用户开始关注 AI Agent 开发
  domains 新增 "AI Agent 工具链"
  high_value_signals 新增 "Agent 架构设计、MCP 集成"
```

**手动修正（Dashboard）：**

画像自动合成但不完美——用户可以在 Dashboard 里直接编辑画像：
- 删除不准确的推断
- 添加系统没有从对话中捕获到的信息
- 调整领域优先级
- 标记某些话题为"不需要记忆"（比如用户不想让系统记住某些私人话题）

手动编辑会被标记为 `source: 'manual'`，Lifecycle 重新合成时会保留手动编辑的部分（不被自动覆盖）。

#### 5.2.8 提取质量的持续优化

除了 User Profile 闭环，Cortex 还提供两个辅助机制：

**1. 提取日志审查（Dashboard 功能）**

Dashboard 的"提取日志"页面显示每轮对话的原始输入和 LLM 提取结果，方便人工审查：

```
2026-02-20 14:30  Session: abc123
───────────────────────────────────────
Input:  用户问了品川区利回... Agent回复了4.2%...
Output: 3 memories extracted
  ✅ [fact, 0.7] 品川区1LDK实际利回4.28%...
  ✅ [fact, 0.5] 近3年成交价中位数...
  ⚠️ [project_state, 0.6] 用户在评估品川区...  ← 可手动调整
```

**2. 提取 Prompt 追加指令（高级用户）**

对于有特殊需求的用户，仍可通过配置追加指令。但这是可选的——大多数情况下 User Profile 自动合成就够了：

```json
{
  "cortex": {
    "sieve": {
      "additionalInstructions": "可选的手动追加指令，会和自动画像合并注入"
    }
  }
}
```

### 5.3 Memory Flush+（增强版预压缩刷新）

**触发点：** OpenClaw `agent:beforeCompaction` hook（如存在）或 token 阈值检测
**改进点：** 修复原生 memoryFlush 的陈旧 token 计数 Bug（Issue #5457）

```typescript
async function memoryFlushPlus(context: AgentContext): Promise<void> {
  // 1. 实时计算 token（不用上一轮的缓存值）
  const currentTokens = await countTokensAccurate(context.messages);
  const threshold = config.contextWindow - config.reserveTokensFloor
                    - config.softThresholdTokens;

  if (currentTokens < threshold) return;

  // 2. 提取本轮会话的关键信息
  const sessionSummary = await extractSessionHighlights(context.messages, {
    focus: ['decisions', 'state_changes', 'user_preferences', 'blockers'],
    maxTokens: 500,
  });

  // 3. 写入 Working Memory
  await appendWorkingMemory(sessionSummary, {
    tag: 'pre-compaction-flush',
    timestamp: new Date(),
  });

  // 4. 同步更新 Core Memory（高优先级条目）
  const coreUpdates = sessionSummary.filter(s => s.priority === 'high');
  for (const update of coreUpdates) {
    await upsertCoreMemory(update);
  }

  // 5. 标记已刷新（防止重复触发）
  context.metadata.memoryFlushed = true;
}
```

### 5.4 Lifecycle Engine（记忆生命周期管理）

**触发点：** 定时任务（默认凌晨 3:00，在 OpenClaw 的每日重置之前运行）
**核心理念：** 记忆不是永久的。有衰减、有合并、有遗忘。

```typescript
async function lifecycleEngine(): Promise<LifecycleReport> {
  const report = new LifecycleReport();

  // === 阶段 1: Working → Core 晋升 ===
  const workingEntries = await getWorkingMemories({ olderThan: '24h' });
  for (const entry of workingEntries) {
    const score = computePromotionScore(entry);
    // 评分因子：
    // - 被检索次数（accessCount）
    // - 是否包含高信号
    // - 与 Core Memory 的新颖度（与已有条目的语义距离）

    if (score > PROMOTION_THRESHOLD) {
      await promoteToCore(entry);
      report.promoted++;
    }
  }

  // === 阶段 2: Core 去重与合并 ===
  const coreEntries = await getCoreMemories();
  const clusters = clusterBySimilarity(coreEntries, { threshold: 0.85 });
  for (const cluster of clusters) {
    if (cluster.length > 1) {
      const merged = await mergeEntries(cluster, {
        strategy: 'keep_latest_resolve_conflicts',
        // "用户预算5000万" vs "用户未确认预算"
        // → 保留时间戳更新的那个
      });
      await replaceCoreEntries(cluster, merged);
      report.merged += cluster.length - 1;
    }
  }

  // === 阶段 3: Core → Archive 降级 ===
  for (const entry of coreEntries) {
    const decayScore = computeDecayScore(entry);
    // 衰减因子：
    // - 最后访问时间（越久越衰减）
    // - 访问频率（越低越衰减）
    // - 条目类型（preference/identity 衰减慢，todo 衰减快）

    if (decayScore < ARCHIVE_THRESHOLD) {
      await archiveEntry(entry);
      report.archived++;
    }
  }

  // === 阶段 4: Archive 过期 → 压缩回流 Core ===
  const expired = await getArchivedMemories({
    olderThan: config.archiveTTL || '90d',
  });
  // 永不直接删除——压缩为超级摘要，写回 Core
  if (expired.length > 0) {
    const superSummary = await compressToSuperSummary(expired, {
      maxTokens: 300,  // 将数十条压缩为几句话
      preserveKeyFacts: true,
    });
    // 回流到 Core Memory 的 "历史记忆摘要" 区域（永久保留）
    await appendCoreMemory(superSummary, {
      section: '历史记忆摘要',
      tag: `compressed-from-archive-${expired[0].period}`,
    });
    // 原始 Archive 条目标记为已压缩（可选删除释放空间）
    await markArchiveCompressed(expired);
    if (config.deleteCompressedArchive) {
      await removeArchiveEntries(expired);
    }
    report.compressedToCore = expired.length;
  }

  // === 阶段 5: 重建索引 ===
  await rebuildSearchIndex();
  report.indexRebuilt = true;

  return report;
}
```

**衰减公式：**

```
decayScore = baseImportance × accessFrequency × recencyFactor

其中：
  baseImportance = {
    identity: 1.0,     // "我是东京的不动产投资者" 几乎不衰减
    preference: 0.9,   // "我偏好低风险" 衰减很慢
    decision: 0.7,     // "决定用 Oracle Cloud" 中等衰减
    fact: 0.5,         // "品川区利回5%" 正常衰减
    todo: 0.3,         // "记得查ISP IP" 快速衰减
    context: 0.2,      // "今天讨论了路由器" 最快衰减
  }

  accessFrequency = log(1 + accessCount) / log(1 + maxAccessCount)

  recencyFactor = exp(-λ × daysSinceLastAccess)
  λ = 0.03  // 半衰期约 23 天
```

---

## 6. 搜索引擎设计

### 6.1 搜索架构

搜索直接在 SQLite 上执行——BM25 走 FTS5，向量走 vec0 或外接后端，不再解析 Markdown。

```
用户查询
    │
    ▼
┌──────────────────────────┐
│   Query Preprocessor      │
│   - 语言检测              │
│   - 意图分类              │
│   - 关键词提取            │
└────────────┬─────────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
┌──────────┐   ┌─────────────────┐
│  BM25    │   │ Vector Search   │
│ FTS5     │   │                 │
│ (SQLite) │   │ sqlite-vec (默认)│
│          │   │ OR Qdrant       │
│          │   │ OR Milvus       │
└────┬─────┘   └───────┬─────────┘
     │                 │
     ▼                 ▼
┌──────────────────────────┐
│   Hybrid Fusion           │
│   score = 0.7v + 0.3t    │
│   + layer weight (SQL)    │
│   + recency boost (SQL)   │
│   + access boost (SQL)    │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│   Optional: LLM Reranker │
│   (QMD / Cohere / local) │
└────────────┬─────────────┘
             │
             ▼
       Top K 结果
```

**关键改进：** 层级权重、新近度、访问频率这些信号现在可以直接用 SQL 计算，不需要在应用层遍历 Markdown 文件。

### 6.2 搜索 SQL 示例

```sql
-- 单条 SQL 完成：BM25 搜索 + 层级权重 + 衰减分数 + 新近度
SELECT
  m.id,
  m.content,
  m.layer,
  m.category,
  fts.rank AS text_score,
  m.decay_score,
  -- 层级权重
  CASE m.layer
    WHEN 'core'    THEN 1.0
    WHEN 'working' THEN 0.8
    WHEN 'archive' THEN 0.5
  END AS layer_weight,
  -- 新近度提升（7天内线性衰减）
  CASE
    WHEN julianday('now') - julianday(m.created_at) < 7
    THEN 1.0 + 0.1 * (7 - (julianday('now') - julianday(m.created_at))) / 7
    ELSE 1.0
  END AS recency_boost,
  -- 访问频率提升
  1.0 + 0.05 * MIN(m.access_count, 10) AS access_boost
FROM memories m
JOIN memories_fts fts ON fts.rowid = m.rowid
WHERE memories_fts MATCH ?
  AND m.layer IN ('core', 'working', 'archive')
  AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
ORDER BY
  fts.rank * layer_weight * recency_boost * access_boost DESC
LIMIT 20;  -- 取 Top 20 候选，再与向量结果融合
```

### 6.3 混合搜索融合

```typescript
async function hybridSearch(query: string, opts: SearchOptions): Promise<SearchResult[]> {
  // 1. BM25 全文搜索（SQLite FTS5）
  const textResults = await db.all(BM25_SEARCH_SQL, [query]);

  // 2. 向量语义搜索（通过 VectorBackend 接口，backend 可换）
  const queryEmbedding = await embed(query);
  const vecResults = await vectorBackend.search(queryEmbedding, opts.maxResults * 4, {
    // 向量后端也支持元数据过滤（Qdrant/Milvus 原生支持，vec0 需应用层过滤）
    layer: opts.layers,
    expires_after: new Date(),
  });

  // 3. 加权融合
  const fused = weightedFusion(textResults, vecResults, {
    vectorWeight: config.search.vectorWeight,  // default 0.7
    textWeight: config.search.textWeight,       // default 0.3
  });

  // 4. 从 SQLite 补充元数据（access_count, decay_score 等）
  const enriched = await enrichFromDb(fused);

  // 5. 最终排序（考虑所有信号）
  return enriched
    .map(r => ({
      ...r,
      finalScore: r.fusedScore * r.layerWeight * r.recencyBoost * r.accessBoost,
    }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, opts.maxResults);
}
```

### 6.4 LLM 与 Embedding：API 优先策略

**设计决策：放弃"本地优先"，改为"API 优先"。**

原因很实际：QMD 本地 GGUF 模型在没有 NVIDIA GPU 的机器上（ARM VPS、Chromebook 改装机等）冷启动慢、推理经常超 15 秒。对于每轮对话都要跑的 Memory Gate（检索）和 Memory Sieve（提取），15 秒延迟完全不可接受。API 调用通常 200-500ms 返回，成本极低。

#### 6.4.1 两种 LLM 用途及推荐模型

本项目在两个地方需要 LLM：

| 用途 | 调用频率 | 延迟要求 | 推荐模型 | 备选 |
|------|---------|---------|---------|------|
| **记忆提取摘要** (Sieve) | 每轮对话 | < 1s | `gpt-4o-mini` | `claude-haiku-4-5` / `gemini-2.0-flash` |
| **记忆压缩/合并** (Lifecycle) | 每日凌晨 | 不敏感 | `gpt-4o-mini` | `claude-sonnet-4-5` (质量更高) |

**为什么选 gpt-4o-mini 作为默认：**
- 延迟 ~200-400ms，满足实时要求
- 成本极低：$0.15/1M input + $0.60/1M output
- 每轮提取约 300 tokens input + 200 tokens output → 每万轮对话约 $0.015
- 中日英三语能力足够好
- 按月估算：普通使用（50 轮/天）≈ $0.02/月

```typescript
// LLM Provider 接口
interface LLMProvider {
  complete(prompt: string, opts: { maxTokens: number; temperature: number }): Promise<string>;
}

// 支持的 Provider
type LLMProviderConfig =
  | { provider: 'openai'; model: string; apiKey?: string }    // gpt-4o-mini, gpt-4o
  | { provider: 'anthropic'; model: string; apiKey?: string } // claude-haiku, claude-sonnet
  | { provider: 'google'; model: string; apiKey?: string }    // gemini-flash, gemini-pro
  | { provider: 'openrouter'; model: string; apiKey?: string }// 任意模型，统一接口
  | { provider: 'ollama'; model: string; baseUrl?: string }   // 本地 Ollama (离线 fallback)
  | { provider: 'none' };                                     // 禁用 LLM，仅用正则提取
```

#### 6.4.2 Embedding 模型推荐

| 模型 | 维度 | 延迟 | 成本 | 中日英 | 推荐场景 |
|------|------|------|------|--------|---------|
| **`text-embedding-3-small`** | 1536 | ~100ms | $0.02/1M tokens | ✅ 好 | **默认推荐**，性价比最高 |
| `text-embedding-3-large` | 3072 | ~150ms | $0.13/1M tokens | ✅ 好 | 追求最高精度 |
| `voyage-3-lite` | 512 | ~80ms | $0.02/1M tokens | ✅ 好 | 低维度，节省存储 |
| `gemini-embedding-001` | 768 | ~120ms | 免费额度 | ✅ 好 | 有 Google API 的用户 |
| **`bge-m3` (Ollama)** | 1024 | 3-15s* | 免费 | ✅✅ 最强 | **离线 fallback** |
| `nomic-embed-text` (Ollama) | 768 | 2-10s* | 免费 | ⚠️ 一般 | 轻量离线 |

*本地推理延迟取决于硬件，无 GPU 时显著增加

**月度成本估算（Embedding）：**
- 每条记忆平均 100 tokens
- 每天写入 ~50 条 + 每天搜索 ~100 次
- 月度：(50×30 + 100×30) × 100 = 450K tokens
- text-embedding-3-small：450K × $0.02/1M = **$0.009/月** ≈ 可忽略

#### 6.4.3 Cascade 配置（API → 本地 → 降级）

```json
{
  "cortex": {
    "llm": {
      "extraction": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "fallback": { "provider": "ollama", "model": "qwen2.5:3b" },
        "disabled_fallback": { "provider": "none" }
      },
      "lifecycle": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "fallback": { "provider": "anthropic", "model": "claude-haiku-4-5" }
      }
    },
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "dimensions": 1536,
      "fallback": { "provider": "ollama", "model": "bge-m3" },
      "disabled_fallback": { "provider": "none", "mode": "bm25-only" }
    }
  }
}
```

**Cascade 降级逻辑：**

```typescript
class CascadeLLM implements LLMProvider {
  private providers: LLMProvider[];

  async complete(prompt: string, opts: CompletionOpts): Promise<string> {
    for (const provider of this.providers) {
      try {
        const result = await Promise.race([
          provider.complete(prompt, opts),
          timeout(provider.timeoutMs || 5000),  // API: 5s, Ollama: 30s
        ]);
        return result;
      } catch (e) {
        log.warn(`LLM provider ${provider.name} failed, trying next`, e);
        continue;
      }
    }
    // 所有 LLM 都失败 → Memory Sieve 降级为纯正则提取（不做摘要）
    log.warn('All LLM providers failed, falling back to regex-only extraction');
    return null;
  }
}

class CascadeEmbedding implements EmbeddingProvider {
  async embed(text: string): Promise<number[] | null> {
    for (const provider of this.providers) {
      try {
        return await Promise.race([
          provider.embed(text),
          timeout(provider.timeoutMs || 3000),  // API: 3s, Ollama: 20s
        ]);
        } catch (e) {
        log.warn(`Embedding provider ${provider.name} failed, trying next`, e);
        continue;
      }
    }
    // 所有 Embedding 都失败 → 该条记忆只进 FTS5 索引，不进向量索引
    log.warn('All embedding providers failed, memory indexed as text-only');
    return null;
  }
}
```

**关键设计：优雅降级，永不阻塞。**
- LLM 全挂 → Sieve 退化为正则提取（高信号仍能捕获）+ 不做摘要（原文存入 Working）
- Embedding 全挂 → 该条记忆只进 FTS5 全文索引，不进向量索引（BM25 仍可搜索）
- 网络恢复后 → 后台补全缺失的向量索引（异步）

#### 6.4.4 总月度成本估算

| 组件 | 模型 | 调用量/月 | 成本/月 |
|------|------|----------|--------|
| Embedding | text-embedding-3-small | ~450K tokens | $0.01 |
| 记忆提取 (Sieve) | gpt-4o-mini | ~1.5M in + 300K out | $0.40 |
| 生命周期压缩 (Lifecycle) | gpt-4o-mini | ~500K in + 100K out | $0.14 |
| **总计** | | | **~$0.55/月** |

基于每天 50 轮对话的中等使用量。即使翻 3 倍使用量也不到 $2/月。

**嵌入维度与向量后端的对应关系：**

| 嵌入模型 | 维度 | SQLite vec0 | Qdrant | Milvus |
|----------|------|-------------|--------|--------|
| text-embedding-3-small (默认) | 1536 | ✅ | ✅ | ✅ |
| text-embedding-3-large | 3072 | ✅ | ✅ | ✅ |
| voyage-3-lite | 512 | ✅ | ✅ | ✅ |
| gemini-embedding-001 | 768 | ✅ | ✅ | ✅ |
| bge-m3 (Ollama 离线) | 1024 | ✅ | ✅ | ✅ |

切换嵌入模型会触发全量重新索引——从 SQLite memories 表重新生成所有向量并写入向量后端。

---

## 7. 配置设计

### 7.1 零配置默认值

```json
{
  "cortex": {
    "enabled": true,
    "storage": {
      "dbPath": "cortex/brain.db",
      "walMode": true
    },
    "llm": {
      "extraction": {
        "provider": "openai",
        "model": "gpt-4o-mini"
      },
      "lifecycle": {
        "provider": "openai",
        "model": "gpt-4o-mini"
      }
    },
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "dimensions": 1536
    },
    "vectorBackend": {
      "provider": "sqlite-vec"
    },
    "markdownExport": {
      "enabled": true,
      "exportMemoryMd": true,
      "exportWorkingDaily": true,
      "exportArchiveMonthly": true,
      "debounceMs": 300000
    },
    "layers": {
      "working": { "ttl": "48h" },
      "core":    { "maxEntries": 1000 },
      "archive": { "ttl": "90d", "compressBackToCore": true }
    },
    "sieve": {
      "highSignalImmediate": true
    },
    "gate": {
      "maxInjectionTokens": 2000,
      "skipSmallTalk": true,
      "layerWeights": { "core": 1.0, "working": 0.8, "archive": 0.5 }
    },
    "lifecycle": {
      "schedule": "0 3 * * *",
      "promotionThreshold": 0.6,
      "archiveThreshold": 0.2,
      "decayLambda": 0.03,
      "mergeStrategy": "keep_latest_resolve_conflicts"
    },
    "flush": {
      "enabled": true,
      "softThresholdTokens": 40000,
      "accurateTokenCount": true
    },
    "search": {
      "hybrid": true,
      "vectorWeight": 0.7,
      "textWeight": 0.3,
      "recencyBoostWindow": "7d",
      "accessBoostCap": 10
    }
  }
}
```

> 默认使用 OpenAI API（gpt-4o-mini + text-embedding-3-small），总成本约 $0.55/月。
> 需要设置 `OPENAI_API_KEY` 环境变量，或在 OpenClaw 的 credentials 中配置。

### 7.2 极简配置（最小化）

```json
{
  "cortex": { "enabled": true }
}

// 这就够了。需要 OPENAI_API_KEY。
// SQLite + vec0 + FTS5 + Markdown 导出 + gpt-4o-mini 提取 全部自动启用。
// 月成本约 $0.55。
```

### 7.3 高性能配置（Qdrant + 高质量模型）

```json
{
  "cortex": {
    "enabled": true,
    "llm": {
      "extraction": {
        "provider": "anthropic",
        "model": "claude-haiku-4-5"
      },
      "lifecycle": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-5"
      }
    },
    "embedding": {
      "provider": "openai",
      "model": "text-embedding-3-large",
      "dimensions": 3072
    },
    "vectorBackend": {
      "provider": "qdrant",
      "qdrant": {
        "url": "http://localhost:6333",
        "collection": "cortex",
        "quantization": "scalar"
      }
    },
    "search": {
      "hybrid": true,
      "vectorWeight": 0.75,
      "textWeight": 0.25,
      "reranker": {
        "enabled": true,
        "provider": "cohere",
        "model": "rerank-v3.5"
      }
    }
  }
}
```

### 7.4 完全离线配置（无网络环境专用）

```json
{
  "cortex": {
    "enabled": true,
    "llm": {
      "extraction": {
        "provider": "ollama",
        "model": "qwen2.5:3b",
        "baseUrl": "http://localhost:11434"
      },
      "lifecycle": {
        "provider": "ollama",
        "model": "qwen2.5:7b"
      }
    },
    "embedding": {
      "provider": "ollama",
      "model": "bge-m3"
    },
    "vectorBackend": { "provider": "sqlite-vec" }
  }
}
// ⚠️ 仅推荐在完全无网络的环境使用。
// 需要 Ollama 运行中 + 足够 RAM（建议 8GB+）。
// 推理延迟会显著高于 API（3-15s vs 200ms），影响用户体验。
// 无 GPU 的机器上不建议使用此配置。
```

---

## 8. 数据流详解

### 8.1 单次对话的完整数据流

```
用户发送消息: "帮我查一下品川区1LDK的投资利回"
    │
    ▼
[Memory Gate] beforeResponse hook
    │
    ├─ 搜索 Working: 找到昨天讨论过品川区
    ├─ 搜索 Core: 找到 "用户偏好低风险、稳定现金流"
    ├─ 搜索 Archive: 找到上月的东京房产市场调研
    │
    ├─ 融合排序 → 注入 1800 tokens 上下文
    │   "[来自核心记忆] 你偏好低风险、稳定现金流的投资
    │    [来自昨日对话] 昨天讨论了品川区的交通便利性
    │    [来自历史归档] 上月调研显示品川区平均利回4.5-5.5%"
    │
    ▼
Agent 生成回复（带上下文的高质量回答）
    │
    ▼
[Memory Sieve] afterResponse hook
    │
    ├─ 高信号检测: 无高信号
    ├─ 轻量摘要: "讨论了品川区1LDK投资利回，提供了4.5-5.5%参考"
    ├─ 追加到 Working Memory (memory/working/2026-02-20.md)
    │
    ▼
完成
```

### 8.2 夜间生命周期的完整数据流

```
凌晨 3:00 触发 Lifecycle Engine
    │
    ▼
[阶段 1] Working → Core 晋升
    │
    ├─ 扫描过去 24h 的 Working 条目
    ├─ 计算晋升评分:
    │   "讨论品川区利回" → score 0.45 (未被检索过，低)
    │   "用户决定用Oracle Cloud" → score 0.82 (高信号+被检索2次)
    │
    ├─ 晋升 "Oracle Cloud决策" 到 Core Memory
    ├─ "品川区利回" 留在 Working，等待自然过期
    │
    ▼
[阶段 2] Core 去重合并
    │
    ├─ 发现重复: "用户在东京" + "Harry位于东京" → 语义相似度 0.92
    ├─ 合并为: "Harry，东京居民"
    │
    ▼
[阶段 3] Core → Archive 降级
    │
    ├─ "上月调研的NTT路由器IPv6配置" → 30天未访问
    ├─ decayScore = 0.5 × 0.1 × 0.41 = 0.02 < 0.2
    ├─ 降级到 Archive
    │
    ▼
[阶段 4] Archive 过期清理
    │
    ├─ 2025年11月的归档条目 (>90天) → 压缩为超级摘要
    │
    ▼
[阶段 5] 重建索引
    │
    ▼
生成报告: promoted=1, merged=1, archived=1, compressedToCore=3
```

---

## 9. 与现有生态的兼容性

### 10.1 与 OpenClaw 的关系

```
Cortex Sidecar              OpenClaw
───────────────────                ────────────────
独立 Node.js 进程              vs   Agent 运行时
HTTP REST API 提供服务              通过 Bridge Plugin 调用
SQLite brain.db (真实来源)      →   自动导出 MEMORY.md (Bootstrap 加载 ✅)
自动导出 working/YYYY-MM-DD.md →   memory/YYYY-MM-DD.md (兼容)
独立升级/重启                       不受影响
Sidecar 挂了                   →   Agent 正常工作，只是没有记忆增强
```

**Bridge Plugin 是唯一的耦合点**——约 200 行代码，做纯转发。OpenClaw 的任何 hook API 变更只影响这 200 行，不影响 Sidecar 核心。

### 10.2 多 Agent 支持

Sidecar 通过 `agent_id` 参数区分不同的 Agent 来源：

```bash
# OpenClaw Agent
curl -X POST localhost:21100/api/v1/ingest \
  -d '{"agent_id": "openclaw-main", "user_message": "...", ...}'

# 未来：LangChain Agent
curl -X POST localhost:21100/api/v1/recall \
  -d '{"agent_id": "langchain-assistant", "query": "..."}'

# 未来：自建 Agent
curl -X POST localhost:21100/api/v1/recall \
  -d '{"agent_id": "custom-bot", "query": "..."}'
```

每个 `agent_id` 的记忆是隔离的（默认），也可以配置为共享（跨 Agent 记忆融合）。

### 10.3 与其他插件共存

Bridge Plugin 非常轻量，与其他 OpenClaw 插件无冲突。但仍不建议同时启用 Mem0/Engram 等也做记忆注入的插件——会重复注入上下文。

---

## 10. 实施路线图

### Phase 0: Sidecar 基础设施（2 周）

```
□ 创建 monorepo 项目结构（server + bridge-plugin + dashboard）
□ Sidecar HTTP 服务骨架（Express/Fastify + 路由 + 中间件）
□ SQLite 数据库初始化（memories + FTS5 + vec0 + access_log + relations）
□ VectorBackend 接口定义 + SQLite vec0 默认实现
□ LLM/Embedding Provider cascade 框架（API 优先 + 降级链）
□ 配置系统（文件 + 环境变量 + API 热更新）
□ 健康检查 + 基础日志
□ Docker Compose 开发环境
```

### Phase 1: 核心 API + Bridge Plugin（2-3 周）

```
□ POST /api/v1/ingest — Memory Sieve 实现
  □ 高信号正则检测（中/英/日三语）
  □ LLM 摘要提取（gpt-4o-mini）
  □ SQLite 写入 + 向量索引
□ POST /api/v1/recall — Memory Gate 实现
  □ 三层并行搜索（BM25 + Vector）
  □ 层级加权融合排序
  □ 格式化输出（token 预算控制）
□ POST /api/v1/flush — Memory Flush+ 实现
□ Bridge Plugin for OpenClaw (~200 行)
  □ onBeforeResponse → /recall
  □ onAfterResponse → /ingest (fire-and-forget)
  □ onBeforeCompaction → /flush
□ 端到端集成测试：OpenClaw ↔ Sidecar 完整链路
```

### Phase 2: Lifecycle Engine（2-3 周）

```
□ 衰减评分计算
□ Working → Core 晋升
□ Core 语义去重与合并
□ Core → Archive 降级
□ Archive → Core 压缩回流（永不丢失）
□ Markdown Exporter（自动生成 MEMORY.md + 日志文件）
□ 定时调度（node-cron）
□ dry-run 模式和详细报告
□ GET/POST /api/v1/lifecycle/* API
□ 压力测试：1000 条记忆的生命周期模拟
```

### Phase 3: Management Dashboard（3-4 周）

```
□ React SPA 骨架 + 路由
□ 记忆浏览器
  □ 时间线视图（按日期分组，卡片展示）
  □ 表格视图（排序、过滤、分页）
  □ 分层视图（Working / Core / Archive 三栏）
□ 记忆详情 + 编辑
  □ 内容编辑（富文本）
  □ 元数据编辑（category, importance, layer）
  □ 修正链可视化（superseded_by 追溯）
□ 搜索调试
  □ 输入查询 → 显示 BM25 分数、向量分数、融合分数、最终排名
  □ 对比不同搜索策略的效果
□ 实体关系图
  □ 力导向图（D3.js / react-force-graph）
  □ 点击实体 → 展开相关记忆
□ 生命周期监控
  □ 历史报告列表（每日晋升/合并/降级统计）
  □ 下次预览（dry-run 可视化）
□ 系统统计 Dashboard
  □ 记忆总数 & 各层分布
  □ 搜索延迟 P50/P95/P99
  □ API 调用成本追踪
  □ 存储使用量
□ 配置管理 UI
```

### Phase 4: MCP Server（1-2 周）

```
□ MCP Server 实现（@modelcontextprotocol/sdk）
  □ stdio transport（供 Claude Desktop 启动）
  □ SSE transport（供远程连接）
□ MCP Tools 注册
  □ cortex_recall — 检索记忆
  □ cortex_remember — 主动存储记忆
  □ cortex_forget — 删除/修正记忆
  □ cortex_search_debug — 搜索调试
□ MCP Resources 注册
  □ 记忆统计概览
  □ 当前 Core Memory 摘要
□ mcp-client 独立包（npx cortex-mcp 一键启动）
□ Claude Desktop 配置文档 + 测试
□ Cursor / Windsurf 兼容性测试
```

### Phase 5: 外接向量数据库支持（1-2 周）

```
□ Qdrant Backend 实现 + 配置
□ Milvus Backend 实现 + 配置
□ 启动时一致性检查（SQLite ↔ 向量库同步）
□ 后端切换时的全量重索引
```

### Phase 6: 打磨与发布（1-2 周）

```
□ 错误处理与优雅降级完善
□ 性能优化（嵌入缓存、查询预编译、连接池）
□ 安全加固（API 认证、CORS、localhost 绑定）
□ README + 使用文档 + API 文档
□ Docker 镜像发布
□ npm 发布 (cortex-server / cortex-mcp / openclaw-cortex-bridge)
□ 社区反馈收集
```

**总预估：** 12-18 周（个人开发者节奏）

---

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| OpenClaw hook API 变更 | 中 | 高 | 锁定最低兼容版本，监控 release notes |
| 本地 LLM 摘要质量不足 | 中 | 中 | cascade 策略：本地 → API fallback |
| SQLite WAL 文件膨胀 | 低 | 中 | 定期 checkpoint + VACUUM |
| 向量索引与 SQLite 不一致 | 中 | 中 | 事务内同步写入 + 启动时一致性检查 |
| 误删重要记忆 | 中 | 高 | dry-run 模式 + archive 不真删 + Markdown 导出备份 |
| Markdown 导出与原生 MEMORY.md 冲突 | 低 | 高 | 迁移脚本 + 备份原文件 + 可回退 |
| Compaction hook 不存在 | 中 | 中 | fallback 到 token 阈值轮询检测 |
| Qdrant 连接断开 | 低 | 低 | 自动降级到 SQLite vec0，恢复后重同步 |

---

## 12. 成功指标

```
KPI 1: 记忆持久性
  - 衡量：Compaction 后记忆召回率
  - 目标：> 90%（当前约 40-60%）

KPI 2: 检索精准度
  - 衡量：Top-5 检索结果的相关性（人工评估）
  - 目标：> 80% 相关（当前约 60%）

KPI 3: 跨 Session 连续性
  - 衡量：新 Session 首次回复中包含历史上下文的比例
  - 目标：> 70%（当前约 20-30%，仅靠 bootstrap 文件）

KPI 4: 资源开销
  - 衡量：额外内存使用 / API 调用成本
  - 目标：< 200MB 额外内存，< $1/月 额外 API 成本

KPI 5: 用户感知
  - 衡量："Agent 好像忘了" 的抱怨频率
  - 目标：减少 80%
```

---

## 13. 备选方案与否决理由

| 方案 | 否决理由 |
|------|---------|
| 直接用 Mem0 云端 | Auto-Recall Bug (#4037) + 隐私顾虑 + 依赖外部服务 |
| 纯 Markdown 存储（原设计 v0.1）| 并发写入不安全、结构化查询困难、元数据管理笨拙 |
| 强制要求 Qdrant | 违反渐进增强原则，个人部署门槛过高 |
| 完全本地 LLM 做记忆提取 | QMD 模型需 2GB+，不是所有人都有资源 |
| Fork OpenClaw 修改核心 | 维护成本高，无法跟进上游更新 |
| 只优化 MEMORY.md 写入策略 | 治标不治本，不解决 compaction 和检索精度问题 |

**为什么选择 SQLite 为主 + 可选向量库：** SQLite 零部署、事务安全、结构化查询强；vec0 扩展提供基础向量能力够用；Qdrant/Milvus 作为可选升级路径满足追求极致的用户。Markdown 降级为自动导出的镜像，保持人类可读性和 Git 友好。

---

## 附录 A: 项目目录结构

```
cortex/
├── packages/
│   ├── server/                      # Cortex 核心服务
│   │   ├── src/
│   │   │   ├── index.ts             # 服务启动入口
│   │   │   ├── api/
│   │   │   │   ├── router.ts        # REST 路由总表
│   │   │   │   ├── recall.ts        # POST /recall
│   │   │   │   ├── ingest.ts        # POST /ingest
│   │   │   │   ├── flush.ts         # POST /flush
│   │   │   │   ├── search.ts        # POST /search
│   │   │   │   ├── memories.ts      # CRUD /memories
│   │   │   │   ├── relations.ts     # CRUD /relations
│   │   │   │   ├── lifecycle.ts     # /lifecycle/*
│   │   │   │   └── system.ts        # /stats, /config, /health
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts        # MCP Server (stdio + SSE)
│   │   │   │   ├── tools.ts         # cortex_recall / remember / forget
│   │   │   │   └── resources.ts     # MCP Resources (记忆列表等)
│   │   │   ├── core/
│   │   │   │   ├── gate.ts          # Memory Gate 逻辑
│   │   │   │   ├── sieve.ts         # Memory Sieve 逻辑
│   │   │   │   ├── flush.ts         # Memory Flush+ 逻辑
│   │   │   │   └── lifecycle.ts     # Lifecycle Engine
│   │   │   ├── db/
│   │   │   │   ├── schema.ts        # SQLite 建表 + 迁移
│   │   │   │   ├── connection.ts    # 连接管理 (WAL)
│   │   │   │   ├── queries.ts       # 预编译 SQL
│   │   │   │   └── migrations/
│   │   │   ├── vector/
│   │   │   │   ├── interface.ts     # VectorBackend 接口
│   │   │   │   ├── sqlite-vec.ts    # 默认实现
│   │   │   │   ├── qdrant.ts        # 可选
│   │   │   │   └── milvus.ts        # 可选
│   │   │   ├── llm/
│   │   │   │   ├── interface.ts     # LLMProvider 接口
│   │   │   │   ├── cascade.ts       # Cascade 降级逻辑
│   │   │   │   ├── openai.ts
│   │   │   │   ├── anthropic.ts
│   │   │   │   ├── google.ts
│   │   │   │   └── ollama.ts        # 离线 fallback
│   │   │   ├── embedding/
│   │   │   │   ├── interface.ts
│   │   │   │   ├── cascade.ts
│   │   │   │   ├── openai.ts
│   │   │   │   └── ollama.ts
│   │   │   ├── search/
│   │   │   │   ├── hybrid.ts        # BM25 + Vector 混合
│   │   │   │   ├── scoring.ts       # 评分融合
│   │   │   │   └── reranker.ts      # 可选重排序
│   │   │   ├── signals/
│   │   │   │   ├── detector.ts      # 高信号正则检测
│   │   │   │   └── patterns.ts      # 中/英/日三语
│   │   │   ├── decay/
│   │   │   │   ├── scoring.ts       # 衰减计算
│   │   │   │   ├── promotion.ts     # 晋升
│   │   │   │   ├── archival.ts      # 降级
│   │   │   │   ├── compression.ts   # 压缩回流
│   │   │   │   └── merger.ts        # 去重合并
│   │   │   ├── export/
│   │   │   │   ├── markdown.ts      # Markdown 导出
│   │   │   │   └── memory-md.ts     # MEMORY.md 生成
│   │   │   └── utils/
│   │   │       ├── tokens.ts
│   │   │       └── config.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── Dockerfile
│   │
│   ├── mcp-client/                  # 独立 MCP 入口（供 Claude Desktop 启动）
│   │   ├── src/
│   │   │   └── index.ts             # stdio 适配，连接 Cortex Server
│   │   ├── package.json
│   │   └── README.md                # Claude Desktop 配置说明
│   │
│   ├── bridge-openclaw/             # OpenClaw 薄桥接插件
│   │   ├── src/
│   │   │   └── index.ts             # ~200 行，纯转发
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── dashboard/                   # React 管理面板
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── MemoryBrowser.tsx    # 记忆浏览器
│       │   │   ├── MemoryDetail.tsx     # 记忆详情+编辑
│       │   │   ├── SearchDebug.tsx      # 搜索调试
│       │   │   ├── RelationGraph.tsx    # 实体关系图
│       │   │   ├── LifecycleMonitor.tsx # 生命周期监控
│       │   │   ├── Stats.tsx            # 系统统计
│       │   │   └── Settings.tsx         # 配置管理
│       │   ├── components/
│       │   │   ├── MemoryCard.tsx
│       │   │   ├── MemoryTimeline.tsx
│       │   │   ├── LayerBadge.tsx
│       │   │   ├── DecayIndicator.tsx
│       │   │   └── SearchScoreBar.tsx
│       │   └── api/
│       │       └── client.ts           # Cortex API 客户端
│       ├── package.json
│       └── vite.config.ts
│
├── docker-compose.yml               # 一键部署（Cortex + 可选 Qdrant）
├── package.json                     # monorepo root (pnpm workspace)
├── pnpm-workspace.yaml
└── README.md
```

---

## 附录 B: 为什么叫 Cortex 🧠

大脑皮层（Cortex）是人类大脑中负责高级认知功能的区域——包括长期记忆的存储、检索和整合。它不是简单的数据仓库，而是一个活的系统：记忆在这里被编码、巩固、关联，也在这里逐渐衰减和被新记忆覆盖。

这正是我们要为 AI Agent 实现的：不只是存储对话历史，而是构建一个有生命周期的记忆系统——会提取、会遗忘、会关联、会在需要时精准回忆。

**Cortex = AI Agent 的大脑皮层。**
