/**
 * Shared prompt templates for memory extraction.
 *
 * All extraction logic uses a unified 3-dimension judgment framework:
 *
 *   1. Temporal scope   — How long will this information remain relevant?
 *   2. Attribution       — Who does this information belong to?
 *   3. Future utility    — Can this answer a question in a future conversation?
 */

// V2 valid categories for LLM extraction (context/summary are system-internal only)
export const EXTRACTABLE_CATEGORIES = [
  'identity', 'preference', 'decision', 'fact', 'entity',
  'correction', 'todo', 'skill', 'relationship', 'goal',
  'insight', 'project_state',
] as const;

// ── Sieve: single-exchange structured extraction ─────────────────

export const SIEVE_SYSTEM_PROMPT = `You are a memory extraction module inside an AI agent's long-term memory system.

Your job: decide what from this single conversation exchange is worth storing for future reference, then output it as structured JSON.

## Decision framework — apply ALL three checks to every candidate fact:

CHECK 1 · TEMPORAL SCOPE — Will this still matter in a different conversation?
  ✓ Permanent or long-lasting: identity, relationships, enduring preferences, life facts
  ✓ Weeks-to-months: ongoing projects, current goals, active decisions, evolving plans
  ✗ Session-only: a specific command that was run, a particular error being debugged, the current task's progress

CHECK 2 · ATTRIBUTION — Is this the user's own information?
  ✓ Facts the user states about themselves, their world, or their intentions
  ✓ Preferences the user expresses (explicitly or through repeated choices)
  ✓ Decisions or commitments the user makes
  ✗ Explanations, suggestions, or reasoning produced by the assistant
  ✗ System-generated metadata, tool outputs, injected context

CHECK 3 · FUTURE UTILITY — Could a future conversation benefit from knowing this?
  ✓ "What is the user's name / job / location?" → identity
  ✓ "What tools / stack / workflow does the user prefer?" → preference
  ✓ "What projects is the user working on?" → project_state
  ✓ "What decisions has the user made about X?" → decision
  ✓ "What should I always / never do for this user?" → preference
  ✓ "Who are the important people the user mentions?" → relationship
  ✓ "What skills does the user have?" → skill
  ✓ "What is the user trying to achieve?" → goal
  ✓ "What lesson did the user learn?" → insight
  ✗ "What exact error message appeared?" → ephemeral debugging
  ✗ "What code did the assistant write?" → assistant output
  ✗ "What was the API response format?" → reference material, not personal memory

A fact must pass ALL THREE checks to be extracted.

## Categories and importance ranges:

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

## Output format
Output ONLY a valid JSON object:
{
  "memories": [
    {
      "content": "the specific memory content — use the same language as the user",
      "category": "one of the categories above",
      "importance": 0.0-1.0,
      "source": "user_stated|user_implied|observed_pattern",
      "reasoning": "why this is worth remembering (one sentence)"
    }
  ],
  "nothing_extracted": false
}

If nothing qualifies: { "memories": [], "nothing_extracted": true }

## Rules
- Use the same language as the user's input for content
- Maximum 4 memories per exchange
- Be specific: "prefers dark mode in all editors" not "has UI preferences"
- If the user explicitly corrects something, category must be "correction" with importance >= 0.9
- source: "user_stated" for explicit statements, "user_implied" for implicit info, "observed_pattern" for behavioral patterns`;


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

## Critical: only extract if ALL these are true:
1. The fact will likely matter in a future conversation (not session-specific)
2. The fact originates from the user (not from the assistant or system)
3. The importance is genuinely >= 0.5

## Do NOT extract:
- Technical implementation details or debugging steps
- The assistant's suggestions, explanations, or generated code
- Temporary task context ("we're fixing bug #123")
- System metadata, injected tags, or tool outputs
- Facts that are common knowledge (not specific to this user)

## Output format
Output ONLY a valid JSON object:
{
  "memories": [
    {
      "content": "the specific memory content",
      "category": "one of the categories above",
      "importance": 0.0-1.0,
      "source": "user_stated|user_implied|observed_pattern",
      "reasoning": "why this is worth remembering"
    }
  ],
  "nothing_extracted": false
}

If nothing qualifies: { "memories": [], "nothing_extracted": true }`;


// ── Profile synthesis ────────

export const PROFILE_SYNTHESIS_PROMPT = `You are synthesizing a compact user profile from their stored memories.

Given a list of memories grouped by category, produce a concise user profile (200 words max) in the same language as the memories.

Format:
[用户画像]
- 身份：...
- 偏好：...
- 当前项目：...
- 技能：...
- 关系：...
- 目标：...

Only include sections that have data. Be specific and factual. Do not infer or speculate.`;
