/**
 * Shared prompt templates for memory extraction.
 *
 * All extraction logic uses a unified 3-dimension judgment framework:
 *
 *   1. Temporal scope   — How long will this information remain relevant?
 *   2. Attribution       — Who does this information belong to?
 *   3. Future utility    — Can this answer a question in a future conversation?
 */

// V3 valid categories for LLM extraction (context/summary are system-internal only)
export const EXTRACTABLE_CATEGORIES = [
  'identity', 'preference', 'decision', 'fact', 'entity',
  'correction', 'todo', 'skill', 'relationship', 'goal',
  'insight', 'project_state',
  'constraint', 'policy',
  'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona',
] as const;

// ── Shared prompt fragments (used by both SIEVE and FLUSH_CORE) ──────────

const SHARED_CATEGORIES = `## Categories (importance range)
### Primary categories (most common)
- identity (0.9-1.0): Who the user is — name, job, location, background
- preference (0.8-0.9): What they like/dislike — tools, styles, workflows
- decision (0.8-0.9): Concrete choices — "will use X", "switched to Y"
- constraint (0.9-1.0): Hard rules — "never do X", "always Y first"
- correction (0.9-1.0): Updates to previously known info — "actually changed from X to Y"

### Secondary categories
- fact (0.5-0.8): User-specific factual information: living situation, company details, environment constraints, personal context. NOT: debugging steps, error messages, common knowledge, or session-specific task context.
- goal (0.7-0.9): What they're working toward — objectives, plans, milestones
- skill (0.8-0.9): Technical skills, expertise, proficiency
- entity (0.6-0.8): Named tools, projects, organizations the user works with
- todo (0.6-0.8): Action items the user needs to follow up on
- relationship (0.8-0.9): People/entities in the user's world
- insight (0.5-0.7): Lessons learned, observations, experience-based wisdom
- project_state (0.5-0.7): Project progress, status changes, architecture decisions
- policy (0.7-0.9): Default execution strategies — "prefer X before Y"

### Agent categories (from assistant's perspective only)
- agent_self_improvement (0.7-0.9): Mistakes noticed, better approaches
- agent_user_habit (0.7-0.9): User's patterns and rhythms
- agent_relationship (0.8-0.9): Interaction dynamics, rapport, trust
- agent_persona (0.8-1.0): Agent's own character, tone, role positioning`;

const SHARED_ATTRIBUTION = `## Attribution rules
- [USER] sections → user categories (identity, preference, decision, fact, etc.)
  - User confirming ("ok", "好的", "就这样") = decision — extract what was decided
  - Assistant's recommendations/analysis are NEVER user preferences
  - User asking a question ≠ agreeing with the answer
- [ASSISTANT] sections → agent_* categories only (self_improvement, user_habit, relationship, persona)
  - Agent reflects: "记住了", "下次我会..." → agent_self_improvement
  - Agent notices patterns → agent_user_habit`;

const SHARED_EXCLUSIONS = `## Do NOT extract
1. Assistant's output: suggestions, code, analysis, explanations — even if user asked
2. Session-specific context: debugging steps, temp fixes, error messages, tool outputs
3. System metadata: prompts, tool descriptions, framework markers, injected tags`;

const SHARED_OUTPUT_FORMAT = `## Output format
{"memories": [{"content": "...", "category": "...", "importance": 0.0-1.0, "source": "user_stated|user_implied|observed_pattern|system_defined|self_reflection", "reasoning": "..."}], "relations": [{"subject": "entity (1-5 words)", "predicate": "uses|works_at|lives_in|knows|manages|belongs_to|created|prefers|studies|skilled_in|collaborates_with|reports_to|owns|interested_in|related_to|not_uses|not_interested_in|dislikes", "object": "entity (1-5 words)", "confidence": 0.0-1.0, "expired": false}], "nothing_extracted": false}

If nothing qualifies: {"memories": [], "nothing_extracted": true}`;

const SHARED_RELATION_RULES = `## Relations
- ONLY extract relationships that are EXPLICITLY stated. Do NOT infer or speculate.
- subject/object MUST be short entity names (1-5 words), NOT descriptions or sentences
- Only extract when BOTH entities are explicitly mentioned
- Use the same language as the conversation for entity names
- If the relationship is PAST TENSE (used to, previously, no longer), set "expired": true
- For negative relationships, use negative predicates: not_uses, not_interested_in, dislikes
- Standard predicates: uses, works_at, lives_in, knows, manages, belongs_to, created, prefers, studies, skilled_in, collaborates_with, reports_to, owns, interested_in, related_to, not_uses, not_interested_in, dislikes`;

// ── Sieve: single-exchange structured extraction ─────────────────

export const SIEVE_SYSTEM_PROMPT = `You are a memory extraction module. Extract worth-remembering facts from a conversation exchange as structured JSON.

## Three-check filter (ALL must pass)
1. TEMPORAL: Will this matter in a DIFFERENT conversation? Skip session-specific debugging, commands, errors.
2. ATTRIBUTION: User categories from [USER] only. Agent categories from [ASSISTANT] only. Never attribute assistant's words to user.
3. UTILITY: Could a future conversation benefit from this? Skip common knowledge and ephemeral details.

${SHARED_CATEGORIES}

${SHARED_OUTPUT_FORMAT}

${SHARED_ATTRIBUTION}

## Rules
- Same language as user input.
- Extract in the SAME language as the user's message. Never translate. Category names and JSON keys stay in English (they are schema).
- Extract everything genuinely worth remembering — don't miss real information.
- But don't pad: if an exchange has 1 memory, output 1. If it has 0, output 0.
- Typical range: 0-3 memories per exchange. Max 5 only for unusually information-dense exchanges.
- Max 3 relations per exchange. Only extract relations you're confident about.
- nothing_extracted: true is a valid and common output — use it when appropriate.
- Be specific: "prefers dark mode in all editors" not "has UI preferences"
- Corrections: category="correction", importance≥0.9, content MUST include the updated fact
- Relations: only EXPLICITLY stated, short entity names, use "expired":true for past tense
- source: constraint→"user_stated"/"system_defined", policy→"user_stated"/"observed_pattern", agent_*→"observed_pattern"/"self_reflection"

${SHARED_EXCLUSIONS}

## Multi-turn
[USER]/[ASSISTANT] labels show who said what. Use full conversation flow for context. Connect references across turns.

## Examples

### Example 1: Rich information — extract multiple
[USER]: 我在大阪开了一家拉面店，用 Go 写点单系统，最近在考虑加个外卖功能
[ASSISTANT]: 大阪拉面！外卖功能确实是趋势

{"memories": [
  {"content": "在大阪经营拉面店", "category": "identity", "importance": 0.95, "source": "user_stated", "reasoning": "core identity"},
  {"content": "使用 Go 开发点单系统", "category": "skill", "importance": 0.8, "source": "user_stated", "reasoning": "technical skill + use case"},
  {"content": "考虑为拉面店添加外卖功能", "category": "goal", "importance": 0.7, "source": "user_stated", "reasoning": "active plan"}
], "relations": [{"subject": "用户", "predicate": "lives_in", "object": "大阪", "confidence": 0.95, "expired": false}], "nothing_extracted": false}

### Example 2: Pure debugging — nothing to extract
[USER]: 这个 CORS 报错怎么解决？Error: Access to XMLHttpRequest blocked
[ASSISTANT]: 需要在服务端设置 Access-Control-Allow-Origin 头...

{"memories": [], "nothing_extracted": true}

### Example 3: Attribution trap — assistant suggestion ≠ user preference
[USER]: 该用什么消息队列？
[ASSISTANT]: 推荐 RabbitMQ，稳定成熟

{"memories": [], "nothing_extracted": true}

### Example 4: User confirms a decision — NOW extract
[USER]: 好，那就用 RabbitMQ
[ASSISTANT]: 好的，那我帮你配置

{"memories": [{"content": "决定使用 RabbitMQ 作为消息队列", "category": "decision", "importance": 0.85, "source": "user_stated", "reasoning": "explicit decision after discussion"}], "nothing_extracted": false}

### Example 5: Debugging with a lasting decision
[USER]: 搞了半天发现是 Nginx 的问题，以后反代全部换成 Caddy
[ASSISTANT]: Caddy 确实配置简单很多

{"memories": [{"content": "决定将反向代理从 Nginx 全部切换为 Caddy", "category": "decision", "importance": 0.85, "source": "user_stated", "reasoning": "lasting infrastructure decision born from debugging"}], "nothing_extracted": false}`;


// ── Flush: session highlights (conversation summary) ─────

export const FLUSH_HIGHLIGHTS_SYSTEM_PROMPT = `You are a memory extraction module inside an AI agent's long-term memory system.

Your job: extract key highlights from an entire conversation session that are worth persisting. This runs when a session ends or the context window is about to be compressed.

## What to extract (must pass the temporal + attribution + utility checks):
- Decisions or conclusions the user reached during this session
- New preferences or constraints the user expressed
- Status changes to projects or goals ("decided to switch from X to Y")
- Important blockers, todos, or follow-up items the user identified
- New people, tools, or resources the user mentioned they'll use
- Corrections to previously known information

## What to skip:
- Step-by-step execution details (commands run, files edited, errors fixed)
- The assistant's explanations, code output, or troubleshooting process
- System metadata, tags, or tool call details
- Facts already captured in previous extractions (don't repeat known info)
- Information that only makes sense in context of this exact session

## Output rules
- 1-3 concise bullet points capturing lasting outcomes, in the same language as the conversation
- Focus on: decisions made, preferences expressed, goals set, status changes.
- Skip: step-by-step execution details, debugging processes, routine task completion.
- Each bullet should make sense without reading the full conversation
- If no lasting outcomes emerged, output: NOTHING_TO_EXTRACT`;


// ── Flush: core item extraction (structured JSON) ────────

export const FLUSH_CORE_ITEMS_SYSTEM_PROMPT = `You are a memory extraction module inside an AI agent's long-term memory system.

Your job: extract structured facts from a full conversation that should be stored permanently in the user's profile memory. These are high-confidence, long-lasting facts.

${SHARED_CATEGORIES}

## Critical: only extract if ALL these are true:
1. The fact will likely matter in a future conversation (not session-specific)
2. Attribution is correct: user categories for user info, constraint/policy for rules, agent_* for agent's own learning
3. The importance is genuinely >= 0.5

${SHARED_ATTRIBUTION}

${SHARED_EXCLUSIONS}

${SHARED_OUTPUT_FORMAT}

${SHARED_RELATION_RULES}
- Maximum 5 relations per flush
- If no clear relations exist, omit the relations array or use empty array

## Rules
- Extract in the SAME language as the user's message. Never translate. Category names and JSON keys stay in English.
- Be specific and factual. Do not infer or speculate.
- source: constraint→"user_stated"/"system_defined", policy→"user_stated"/"observed_pattern", agent_*→"observed_pattern"/"self_reflection"`;


// ── Smart Update: dedup decision ─────────────────────────

export const SMART_UPDATE_SYSTEM_PROMPT = `You are a memory deduplication module inside an AI agent's long-term memory system.

Given an EXISTING memory and a NEW memory that are semantically similar, decide what to do:

## Actions

1. **keep** — The existing memory already covers everything in the new one. Skip the new memory.
2. **replace** — The new memory is more accurate, more specific, or corrects the existing one. Replace the old with the new.
3. **merge** — The two memories are complementary. Combine them into a single, richer memory.
4. **conflict** — The new memory CONTRADICTS the existing one (not just updates). The old one becomes invalid.
   Use for: location changes ("东京→大阪"), tool/framework switches ("Nginx→Caddy"), role changes, preference reversals.
   NOT for: additions ("uses Python" + "also uses Rust" → merge, not conflict)

## Decision criteria

- If the new memory adds NO new information → keep
- If the new memory contradicts or updates the old one → replace
- If the new memory adds details that complement the old one → merge
- If the new memory directly contradicts the old one (opposite facts) → conflict
- Prefer merge when both contain unique useful details
- Prefer replace when the new memory is strictly better (more specific, corrects errors)

## Output format
Output ONLY a valid JSON object:
{
  "action": "keep" | "replace" | "merge" | "conflict",
  "merged_content": "combined content if action=merge, otherwise omit",
  "reasoning": "one sentence explaining why"
}

## Rules
- Use the same language as the memories for merged_content
- merged_content should be concise — combine, don't concatenate
- If merging, preserve the most specific and accurate details from both`;


// ── Profile synthesis ────────

export const PROFILE_SYNTHESIS_PROMPT = `You are synthesizing a compact user profile from their stored memories.

Given a list of memories grouped by category, produce a concise user profile (200 words max) in the same language as the memories.

Use this section structure (translate section names to match the memory language):
- Identity: name, role, location, background
- Preferences: tools, workflows, styles, habits
- Current projects: active work, status
- Skills: expertise, proficiency
- Relationships: key people, their roles
- Goals: objectives, plans
- Constraints: hard rules, things that must never happen
- Policies: default execution strategies
- Agent growth: self-improvement notes, user habit observations, interaction dynamics, persona style

Only include sections that have data. Be specific and factual. Do not infer or speculate.`;
