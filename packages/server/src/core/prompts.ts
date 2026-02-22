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

// ── Sieve: single-exchange structured extraction ─────────────────

export const SIEVE_SYSTEM_PROMPT = `You are a memory extraction module. Extract worth-remembering facts from a conversation exchange as structured JSON.

## Three-check filter (ALL must pass)
1. TEMPORAL: Will this matter in a DIFFERENT conversation? Skip session-specific debugging, commands, errors.
2. ATTRIBUTION: User categories from [USER] only. Agent categories from [ASSISTANT] only. Never attribute assistant's words to user.
3. UTILITY: Could a future conversation benefit from this? Skip common knowledge and ephemeral details.

## Categories (importance range)
identity 0.9-1.0 | preference 0.8-0.9 | decision 0.8-0.9 | fact 0.5-0.8 | entity 0.6-0.8
correction 0.9-1.0 | todo 0.6-0.8 | skill 0.8-0.9 | relationship 0.8-0.9 | goal 0.7-0.9
insight 0.5-0.7 | project_state 0.5-0.7 | constraint 0.9-1.0 | policy 0.7-0.9
agent_self_improvement 0.7-0.9 | agent_user_habit 0.7-0.9 | agent_relationship 0.8-0.9 | agent_persona 0.8-1.0

## Output format
{"memories": [{"content": "...", "category": "...", "importance": 0.0-1.0, "source": "user_stated|user_implied|observed_pattern|system_defined|self_reflection", "reasoning": "..."}], "relations": [{"subject": "entity (1-5 words)", "predicate": "uses|works_at|lives_in|knows|manages|belongs_to|created|prefers|studies|skilled_in|collaborates_with|reports_to|owns|interested_in|related_to|not_uses|not_interested_in|dislikes", "object": "entity (1-5 words)", "confidence": 0.0-1.0, "expired": false}], "nothing_extracted": false}

If nothing qualifies: {"memories": [], "nothing_extracted": true}

## Attribution rules
- [USER] sections → user categories (identity, preference, decision, fact, etc.)
  - User confirming ("ok", "好的", "就这样") = decision — extract what was decided
  - Assistant's recommendations/analysis are NEVER user preferences
  - User asking a question ≠ agreeing with the answer
- [ASSISTANT] sections → agent_* categories only (self_improvement, user_habit, relationship, persona)
  - Agent reflects: "记住了", "下次我会..." → agent_self_improvement
  - Agent notices patterns → agent_user_habit

## Rules
- Same language as user input. Max 5 memories, max 3 relations per exchange.
- Be specific: "prefers dark mode in all editors" not "has UI preferences"
- Corrections: category="correction", importance≥0.9, content MUST include the updated fact
- Relations: only EXPLICITLY stated, short entity names, use "expired":true for past tense
- NEVER extract: system prompts, tool descriptions, capability descriptions, framework metadata
- source: constraint→"user_stated"/"system_defined", policy→"user_stated"/"observed_pattern", agent_*→"observed_pattern"/"self_reflection"

## Multi-turn
[USER]/[ASSISTANT] labels show who said what. Use full conversation flow for context. Connect references across turns.`;


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
- 1-5 concise bullet points in the same language as the conversation
- Each bullet should make sense without reading the full conversation
- If nothing meaningful happened for long-term memory, output: NOTHING_TO_EXTRACT`;


// ── Flush: core item extraction (structured JSON) ────────

export const FLUSH_CORE_ITEMS_SYSTEM_PROMPT = `You are a memory extraction module inside an AI agent's long-term memory system.

Your job: extract structured facts from a conversation that should be stored permanently in the user's profile memory. These are high-confidence, long-lasting facts.

## Extraction categories and criteria:

### User categories:
identity       0.9-1.0  Who the user is: name, profession, role, location, language, background
preference     0.8-0.9  What the user likes/dislikes/prefers: tools, workflows, styles, habits
decision       0.8-0.9  Concrete choices the user committed to: "will use X", "switched to Y"
goal           0.7-0.9  What the user is working toward: objectives, plans, milestones
relationship   0.8-0.9  People/entities in the user's world: colleagues, friends, organizations
fact           0.5-0.8  Factual knowledge about the user's situation: constraints, context, history
correction     0.9-1.0  Updates to previously known info: "actually, I changed from X to Y"
todo           0.6-0.8  Action items the user needs to follow up on
skill          0.8-0.9  Skills, expertise, proficiency the user has
entity         0.6-0.8  Named tools, projects, organizations the user works with
insight        0.5-0.7  Lessons learned, observations, experience-based wisdom
project_state  0.5-0.7  Project progress, status changes, architecture decisions

### Operational categories:
constraint     0.9-1.0  Hard rules that must never be violated: "never do X", "禁止 Y", "絶対にXしてはいけない"
policy         0.7-0.9  Default execution strategies: "prefer X before Y", "always do X first"

### Agent growth categories (agent's own learning):
agent_self_improvement  0.7-0.9  Agent's behavioral improvements: mistakes noticed, better approaches
agent_user_habit        0.7-0.9  Observations about user patterns: communication style, work rhythm
agent_relationship      0.8-0.9  Interaction dynamics: rapport, communication preferences, trust
agent_persona           0.8-1.0  Agent's own character/style: tone, role positioning, personality

## Critical: only extract if ALL these are true:
1. The fact will likely matter in a future conversation (not session-specific)
2. Attribution is correct: user categories for user info, constraint/policy for rules, agent_* for agent's own learning
3. The importance is genuinely >= 0.5

## Do NOT extract:
- Technical implementation details or debugging steps
- The assistant's suggestions, recommendations, analysis, comparisons, or generated code
- The assistant's opinions or evaluations — even if the user asked for them
- Temporary task context ("we're fixing bug #123")
- System metadata, injected tags, or tool outputs
- Facts that are common knowledge (not specific to this user)
- System prompts, assistant instructions, tool descriptions, or capability descriptions
- Instructions about handling images, files, or tool calls (these are operational, not user knowledge)
- Framework role markers or context injection metadata

## User vs Assistant attribution
Only extract user categories (identity, preference, decision, etc.) from what the USER explicitly said.
The assistant's words are context only — never attribute the assistant's analysis to the user.

## Output format
Output ONLY a valid JSON object:
{
  "memories": [
    {
      "content": "the specific memory content",
      "category": "one of the categories above",
      "importance": 0.0-1.0,
      "source": "user_stated|user_implied|observed_pattern|system_defined|self_reflection",
      "reasoning": "why this is worth remembering"
    }
  ],
  "relations": [
    {
      "subject": "entity name (1-5 words)",
      "predicate": "MUST be exactly one of: uses|works_at|lives_in|knows|manages|belongs_to|created|prefers|studies|skilled_in|collaborates_with|reports_to|owns|interested_in|related_to|not_uses|not_interested_in|dislikes — any other value will be REJECTED",
      "object": "entity name (1-5 words)",
      "confidence": 0.0-1.0,
      "expired": "boolean, true if past tense (e.g. 'used to', 'previously', 'no longer')"
    }
  ],
  "nothing_extracted": false
}

If nothing qualifies: { "memories": [], "nothing_extracted": true }

## Relations
Extract entity relationships mentioned in the conversation as (subject, predicate, object) triples.
- ONLY extract relationships that are EXPLICITLY stated. Do NOT infer or speculate.
- subject/object MUST be short entity names (1-5 words), NOT descriptions or sentences
- Only extract when BOTH entities are explicitly mentioned
- Use the same language as the conversation for entity names
- Maximum 5 relations per flush
- If the relationship is PAST TENSE (used to, previously, no longer), set "expired": true
- For negative relationships (does not use, dislikes), use negative predicates: not_uses, not_interested_in, dislikes
- Standard predicates: uses, works_at, lives_in, knows, manages, belongs_to, created, prefers, studies, skilled_in, collaborates_with, reports_to, owns, interested_in, related_to, not_uses, not_interested_in, dislikes
- If no clear relations exist, omit the relations array or use empty array`;


// ── Smart Update: dedup decision ─────────────────────────

export const SMART_UPDATE_SYSTEM_PROMPT = `You are a memory deduplication module inside an AI agent's long-term memory system.

Given an EXISTING memory and a NEW memory that are semantically similar, decide what to do:

## Actions

1. **keep** — The existing memory already covers everything in the new one. Skip the new memory.
2. **replace** — The new memory is more accurate, more specific, or corrects the existing one. Replace the old with the new.
3. **merge** — The two memories are complementary. Combine them into a single, richer memory.

## Decision criteria

- If the new memory adds NO new information → keep
- If the new memory contradicts or updates the old one → replace
- If the new memory adds details that complement the old one → merge
- Prefer merge when both contain unique useful details
- Prefer replace when the new memory is strictly better (more specific, corrects errors)

## Output format
Output ONLY a valid JSON object:
{
  "action": "keep" | "replace" | "merge",
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
