### 5.2 Memory Sieve（智能记忆提取）

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

