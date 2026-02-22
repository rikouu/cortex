import type { MemoryCategory } from '../db/queries.js';

export interface DetectedSignal {
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  pattern: string;
}

/** Sentence boundary characters for CJK and Western text */
const SENTENCE_BOUNDARIES = /[。！？\n.!?]/;

/**
 * Extract context at sentence boundaries around a match position.
 * Falls back to character-level slicing if the sentence is too long (>300 chars).
 */
function extractSentenceContext(text: string, matchIdx: number, matchLen: number): string {
  const maxLen = 300;

  // Find sentence start: search backward for sentence boundary
  let start = matchIdx;
  for (let i = matchIdx - 1; i >= Math.max(0, matchIdx - 200); i--) {
    if (SENTENCE_BOUNDARIES.test(text[i]!)) {
      start = i + 1;
      break;
    }
    if (i === Math.max(0, matchIdx - 200)) {
      start = i;
    }
  }

  // Find sentence end: search forward for sentence boundary
  const matchEnd = matchIdx + matchLen;
  let end = matchEnd;
  for (let i = matchEnd; i < Math.min(text.length, matchEnd + 200); i++) {
    if (SENTENCE_BOUNDARIES.test(text[i]!)) {
      end = i + 1;
      break;
    }
    if (i === Math.min(text.length, matchEnd + 200) - 1) {
      end = i + 1;
    }
  }

  let context = text.slice(start, end).trim();

  // Fallback: if extracted sentence is too long, truncate around match
  if (context.length > maxLen) {
    const fallbackStart = Math.max(0, matchIdx - 50);
    const fallbackEnd = Math.min(text.length, matchIdx + matchLen + 200);
    context = text.slice(fallbackStart, fallbackEnd).trim();
  }

  return context;
}

/**
 * High signal patterns for Chinese, English, and Japanese.
 * These detect important information without requiring LLM calls.
 */
const HIGH_SIGNAL_PATTERNS: {
  category: MemoryCategory;
  patterns: RegExp[];
  importance: number;
  name: string;
}[] = [
  {
    category: 'correction',
    patterns: [
      /不是[^，。！？\n]{1,30}[，,]\s*(而)?是/,
      /其实是/,
      /搞错了/,
      /更正[：:]/,
      /纠正[：:]/,
      /actually[, ]/i,
      /correction[: ]/i,
      /not (.+), (?:but |it's )/i,
      /実は/,
      /間違[いえっ]/,
      /訂正/,
    ],
    importance: 0.9,
    name: 'correction',
  },
  {
    category: 'preference',
    patterns: [
      /我(喜欢|偏好|不要|不想|讨厌|倾向|更愿意|比较喜欢|最喜欢)/,
      /我prefer/i,
      /i (like|prefer|want|don'?t want|hate|love|enjoy|dislike)/i,
      /私は.{0,10}(好き|嫌い|したい|したくない)/,
      /が好き/,
      /は嫌[いだ]/,
      /please (always|never|don'?t)/i,
      /以后(都|总是|不要|别)/,
      /记住我(喜欢|不喜欢|偏好)/,
      // Indirect preference patterns
      /觉得.{1,20}(比较好|更好|最好|不错)/,
      /还是.{1,15}(好|吧|比较)/,
      /用.{1,10}(习惯了|顺手)/,
      /i(?:'d| would) (?:rather|prefer)/i,
      /(?:fan|fond) of/i,
      /can'?t stand/i,
    ],
    importance: 0.85,
    name: 'preference',
  },
  {
    category: 'identity',
    patterns: [
      /我是[^，。！？\n]{1,30}(的人|工程师|投资者|开发者|设计师|学生|老师|医生)/,
      /我叫[^，。！？\n]{1,20}/,
      /我的名字是/,
      /i(?:'m| am) (?:a |an )?[a-z]+ (?:developer|engineer|investor|designer|student|teacher|doctor)/i,
      /my name is/i,
      /call me /i,
      /私は.{1,20}(です|だ|と申します)/,
      /我住在/,
      /i live in/i,
      /我在[^，。！？\n]{1,20}工作/,
      /i work (?:at|for|in)/i,
      // Location/duration patterns: "在东京生活了3年"
      /在[^，。！？\n]{1,15}(生活|住|待|呆|工作)了?\d/,
      /(?:lived?|been|stayed|worked) in .{1,20} for/i,
      /\d+年.{0,5}(经验|工作)/,
      /(毕业|出身|来自)/,
      /i(?:'m| am) from/i,
      /born in/i,
      /graduated from/i,
    ],
    importance: 1.0,
    name: 'identity',
  },
  {
    category: 'decision',
    patterns: [
      /决定[了]?/,
      /选择了/,
      /最终用/,
      /确定用/,
      /就这样吧/,
      /就[这那]么[定办]/,
      /i(?:'ve)? decided/i,
      /let'?s go with/i,
      /i(?:'ll)? choose/i,
      /final decision/i,
      /に決め[たる]/,
      /にし[よまた]/,
      /を選[んぶび]/,
      // Implicit decisions
      /那就.{1,20}(吧|了)/,
      /行[，,]就/,
      /好[，,]用/,
      /换成/,
      /改[用成为]/,
      /迁移到/,
      /i(?:'ll| will) (?:use|go with|switch to|move to|stick with)/i,
      /switching to/i,
      /moving to/i,
      /going with/i,
    ],
    importance: 0.8,
    name: 'decision',
  },
  {
    category: 'todo',
    patterns: [
      /记得[^，。！？\n]{1,40}/,
      /需要[^，。！？\n]{1,40}/,
      /待办/,
      /别忘了/,
      /提醒我/,
      /todo[: ]/i,
      /remind me/i,
      /don'?t forget/i,
      /i need to/i,
      /remember to/i,
      /忘れないで/,
      /覚えて/,
      /リマインド/,
    ],
    importance: 0.7,
    name: 'todo',
  },
  {
    category: 'fact',
    patterns: [
      /重要[：:]/,
      /关键是/,
      /核心是/,
      /本质上/,
      /important[: ]/i,
      /key (?:point|thing|fact)[: ]/i,
      /the (?:main|core|essential) (?:thing|point|idea)/i,
      /重要なのは/,
      /ポイントは/,
    ],
    importance: 0.75,
    name: 'important_fact',
  },
  {
    category: 'skill',
    patterns: [
      /我会[^，。！？\n]{1,30}/,
      /我擅长/,
      /我熟悉/,
      /我精通/,
      /i know how to/i,
      /i(?:'m| am) (?:good|proficient|experienced|skilled) (?:at|in|with)/i,
      /i have experience (?:with|in)/i,
      /得意な/,
      /できます/,
      /スキル/,
    ],
    importance: 0.85,
    name: 'skill',
  },
  {
    category: 'relationship',
    patterns: [
      /我的(同事|老板|领导|经理|朋友|搭档|合伙人|老婆|老公|女朋友|男朋友)/,
      /我(同事|老板|领导)[^，。！？\n]{1,20}/,
      /my (colleague|coworker|boss|manager|friend|partner|wife|husband|girlfriend|boyfriend)/i,
      /i work with/i,
      /チームメンバー/,
      /同僚の/,
      /上司の/,
    ],
    importance: 0.85,
    name: 'relationship',
  },
  {
    category: 'goal',
    patterns: [
      /我的目标是/,
      /我想(要|达到|实现|完成)/,
      /我计划/,
      /我打算/,
      /i want to achieve/i,
      /my goal is/i,
      /i(?:'m| am) (?:planning|trying|aiming) to/i,
      /i plan to/i,
      /目標は/,
      /達成したい/,
    ],
    importance: 0.8,
    name: 'goal',
  },
  {
    category: 'constraint',
    patterns: [
      // Chinese — require constraint context to avoid false positives like "我不能吃辣"
      /禁止.{1,30}/,
      /绝对不[要能可]/,
      /(不得|不许|不允许|不可以).{1,40}/,
      /(永远|任何时候|无论如何)都?不[要能可以]/,
      // English
      /must not/i,
      /never .{1,30}(do|allow|execute|run|use)/i,
      /forbidden/i,
      /prohibited/i,
      /do not .{1,30} under any circumstances/i,
      // Japanese
      /してはいけない/,
      /禁じ/,
      /絶対に.{0,20}(ない|だめ|いけない)/,
      /厳禁/,
    ],
    importance: 0.95,
    name: 'constraint',
  },
  {
    category: 'agent_self_improvement',
    patterns: [
      // Chinese
      /我(发现|注意到|意识到)(自己|我).{0,20}(应该|可以|需要).{0,20}(改进|优化|调整)/,
      /下次(我|应该|可以)/,
      // English
      /i (should|could|need to) (improve|adjust|change)/i,
      /next time i (should|will|could)/i,
      /i noticed (that )?i/i,
      // Japanese
      /次回は.{0,20}(べき|ようにする|改善)/,
      /反省.{0,20}(した|する|点|すべき)/,
      /改善(すべき|した方|できる|点)/,
    ],
    importance: 0.75,
    name: 'agent_self_improvement',
  },
];

/** Regex to strip injected system tags before pattern matching */
const INJECTED_TAG_RE = /<cortex_memory>[\s\S]*?<\/cortex_memory>/g;
const SYSTEM_TAG_RE = /<(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)[\s\S]*?<\/(?:system|context|memory|tool_result|tool_use|function_call|function_result|instructions|artifact|thinking|antThinking)>/g;

/**
 * Detect high-signal information from user/assistant exchange.
 * Uses regex patterns only — no LLM call needed.
 *
 * User-category patterns only run against user messages to prevent
 * assistant responses from being misidentified as user facts.
 * Agent-category patterns (agent_*) run against assistant messages.
 */
export function detectHighSignals(exchange: { user: string; assistant: string }): DetectedSignal[] {
  const signals: DetectedSignal[] = [];
  // Strip injected tags to avoid matching content from previous memory injections
  const cleanUser = exchange.user.replace(INJECTED_TAG_RE, '').replace(SYSTEM_TAG_RE, '');
  const cleanAssistant = exchange.assistant.replace(INJECTED_TAG_RE, '').replace(SYSTEM_TAG_RE, '');

  for (const rule of HIGH_SIGNAL_PATTERNS) {
    // Agent categories match assistant text; all other categories match user text only
    const text = rule.category.startsWith('agent_') ? cleanAssistant : cleanUser;
    if (!text || text.length < 3) continue;

    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract surrounding context at sentence boundaries
        const idx = match.index || 0;
        const context = extractSentenceContext(text, idx, match[0].length);

        signals.push({
          category: rule.category,
          content: context,
          importance: rule.importance,
          confidence: 0.85,
          pattern: rule.name,
        });
        break; // One match per category is enough
      }
    }
  }

  return signals;
}

/**
 * Determine if a message is "small talk" that doesn't warrant memory retrieval.
 */
export function isSmallTalk(message: string): boolean {
  const trimmed = message.trim();

  // Very short messages
  if (trimmed.length < 5) return true;

  const smallTalkPatterns = [
    /^(hi|hello|hey|yo|sup|嗨|你好|哈喽|おはよう|こんにちは)[\s!！。.]*$/i,
    /^(thanks|thank you|谢谢|ありがとう|thx)[\s!！。.]*$/i,
    /^(ok|okay|好的|了解|わかった|はい)[\s!！。.]*$/i,
    /^(bye|goodbye|再见|じゃね|さようなら)[\s!！。.]*$/i,
    /^(lol|haha|哈哈|hhh|笑|www)[\s!！。.]*$/i,
    /^(yes|no|是|不是|うん|ううん)[\s!！。.]*$/i,
  ];

  return smallTalkPatterns.some(p => p.test(trimmed));
}
