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

export const SIEVE_SYSTEM_PROMPT = `You are a memory extraction module inside an AI agent's long-term memory system.

Your job: decide what from this single conversation exchange is worth storing for future reference, then output it as structured JSON.

## Decision framework — apply ALL three checks to every candidate fact:

CHECK 1 · TEMPORAL SCOPE — Will this still matter in a different conversation?
  ✓ Permanent or long-lasting: identity, relationships, enduring preferences, life facts
  ✓ Weeks-to-months: ongoing projects, current goals, active decisions, evolving plans
  ✗ Session-only: a specific command that was run, a particular error being debugged, the current task's progress

CHECK 2 · ATTRIBUTION — Who does this information belong to?
  User attribution (most categories):
  ✓ Facts the user EXPLICITLY states about themselves, their world, or their intentions
  ✓ Preferences the user EXPLICITLY expresses (explicitly or through repeated choices)
  ✓ Decisions or commitments the user makes (user must confirm, not just ask)
  ✗ The assistant's recommendations, analysis, or suggestions — these are NOT user preferences
  ✗ The assistant's opinions or evaluations — even if the user asked for them
  Operational attribution (constraint/policy):
  ✓ Rules or constraints set by the user or system: "never do X", "always do Y first"
  ✓ Default execution strategies and behavioral norms
  Agent attribution (agent_* categories):
  ✓ Agent's own reflections on its behavior and improvements
  ✓ Agent's observations about user patterns and habits
  ✓ Interaction dynamics, rapport, and communication preferences
  ✗ System-generated metadata, tool outputs, injected context

CHECK 3 · FUTURE UTILITY — Could a future conversation benefit from knowing this?
  ✓ "What is the user's name / job / location?" → identity
  ✓ "What tools / stack / workflow does the user prefer?" → preference
  ✓ "What projects is the user working on?" → project_state
  ✓ "What decisions has the user made about X?" → decision
  ✓ "What must I never do?" → constraint
  ✓ "What should I always / never do for this user?" → preference
  ✓ "What default strategy should I follow?" → policy
  ✓ "Who are the important people the user mentions?" → relationship
  ✓ "What skills does the user have?" → skill
  ✓ "What is the user trying to achieve?" → goal
  ✓ "What lesson did the user learn?" → insight
  ✓ "How should the agent improve its behavior?" → agent_self_improvement
  ✓ "What patterns does the user show?" → agent_user_habit
  ✓ "How does the agent interact with this user?" → agent_relationship
  ✗ "What exact error message appeared?" → ephemeral debugging
  ✗ "What code did the assistant write?" → assistant output
  ✗ "What was the API response format?" → reference material, not personal memory

A fact must pass ALL THREE checks to be extracted.

## Categories and importance ranges:

### User categories:
identity       0.9-1.0  Who the user is: name, profession, role, location, language, background
preference     0.8-0.9  What the user likes/dislikes/prefers: tools, workflows, styles, habits
decision       0.8-0.9  Concrete choices the user committed to: "will use X", "switched to Y"
fact           0.5-0.8  Factual knowledge about the user's situation: constraints, context, history
entity         0.6-0.8  Named entities: tools, projects, organizations the user works with
correction     0.9-1.0  Updates to previously known info: "actually, I changed from X to Y"
todo           0.6-0.8  Action items the user needs to follow up on
skill          0.8-0.9  Skills, expertise, proficiency the user has or is learning
relationship   0.8-0.9  People in the user's world: colleagues, friends, family, their roles
goal           0.7-0.9  Objectives, plans, milestones the user is working toward
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

## Output format
Output ONLY a valid JSON object:
{
  "memories": [
    {
      "content": "the specific memory content — use the same language as the user",
      "category": "one of the categories above",
      "importance": 0.0-1.0,
      "source": "user_stated|user_implied|observed_pattern|system_defined|self_reflection",
      "reasoning": "why this is worth remembering (one sentence)"
    }
  ],
  "relations": [
    {
      "subject": "entity name (1-5 words, e.g. Harry)",
      "predicate": "MUST be exactly one of: uses|works_at|lives_in|knows|manages|belongs_to|created|prefers|studies|skilled_in|collaborates_with|reports_to|owns|interested_in|related_to|not_uses|not_interested_in|dislikes — any other value will be REJECTED",
      "object": "entity name (1-5 words, e.g. Tokyo)",
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
- Use the same language as user input for entity names
- Maximum 3 relations per exchange
- If the relationship is PAST TENSE (used to, previously, no longer), set "expired": true
- For negative relationships (does not use, dislikes), use negative predicates: not_uses, not_interested_in, dislikes
- Standard predicates: uses, works_at, lives_in, knows, manages, belongs_to, created, prefers, studies, skilled_in, collaborates_with, reports_to, owns, interested_in, related_to, not_uses, not_interested_in, dislikes
- If no clear relations exist, omit the relations array or use empty array

## Rules
- Use the same language as the user's input for content
- Maximum 5 memories per exchange
- Be specific: "prefers dark mode in all editors" not "has UI preferences"
- If the user explicitly corrects something, category must be "correction" with importance >= 0.9, and the content MUST include the updated fact (e.g. "用户养了5只猫" not just "更正为5只")
- source values:
  - "user_stated" for explicit user statements
  - "user_implied" for implicit user info
  - "observed_pattern" for behavioral patterns (user or agent observations)
  - "system_defined" for system-level constraints and policies
  - "self_reflection" for agent's own learning and reflections
- constraint uses source: "user_stated" or "system_defined"
- policy uses source: "user_stated" or "observed_pattern"
- agent_* categories use source: "observed_pattern" or "self_reflection"

## CRITICAL: Do NOT extract these
- System prompts, assistant instructions, or tool descriptions — these are operational directives, NOT user knowledge
- Instructions about how to handle images, files, or tool calls
- Capability descriptions ("I can analyze images", "I support file uploads")
- Framework-injected metadata, role markers, or context tags
- The assistant's own reasoning process or chain-of-thought
- The assistant's recommendations, analysis, comparisons, or evaluations — these are assistant output, NOT user knowledge

## CRITICAL: User vs Assistant attribution

The conversation has [USER] and [ASSISTANT] sections. You MUST distinguish who said what:

**Only the user can be the source of user memories.** The assistant's words are context, NOT user facts.

✗ WRONG: User asks "which model is best?" → Assistant says "Sonnet 4.6 is best for JSON" → Extract "用户认为 Sonnet 4.6 最好" (WRONG! The assistant said this, not the user)
✓ RIGHT: User says "I'll go with Sonnet 4.6" → Extract "用户决定使用 Sonnet 4.6" (Correct — user explicitly decided)

✗ WRONG: Assistant recommends "use dark mode" → Extract as user preference (WRONG!)
✓ RIGHT: User says "I like dark mode" → Extract as user preference (Correct)

Rules:
- The assistant's recommendations/analysis/suggestions are NEVER user preferences or decisions
- User asking a question ("which is best?") does NOT mean they agree with the answer
- Only extract a decision/preference if the USER explicitly states or confirms it
- If the user says "ok" / "好的" / "就这样" after an assistant recommendation, THAT is a user decision — but attribute the decision to the user, not the assistant's analysis
- [ASSISTANT RESPONSE] content is provided for context only — to help you understand what the user is referring to

## Multi-turn context
- [USER] and [ASSISTANT] / [ASSISTANT RESPONSE] labels indicate who said what
- Extract user memories from [USER] sections. Use [ASSISTANT] sections only as context.
- Constraint/policy categories capture rules and strategies set by the user.
- Agent growth categories (agent_*) capture the agent's own learning and observations — these are the ONLY categories where the agent reflects on itself, and should come from [ASSISTANT] sections.
- Look for patterns across turns for stronger signals`;


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
