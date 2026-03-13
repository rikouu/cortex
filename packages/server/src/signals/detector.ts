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
 *
 * Design principles:
 * - Prefer precision over recall (false negatives are OK, false positives are not — deep channel catches what we miss)
 * - skipOnQuestion: indirect patterns that are easily confused with questions
 * - Chinese patterns must handle adverbs (很/比较/特别/非常) between subject and verb
 */
const HIGH_SIGNAL_PATTERNS: {
  category: MemoryCategory;
  patterns: RegExp[];
  importance: number;
  name: string;
  /** If true, skip this rule when the user message looks like a question */
  skipOnQuestion?: boolean;
}[] = [
  // ── Correction ──
  {
    category: 'correction',
    patterns: [
      /不是[^，。！？\n]{1,30}[，,]\s*(而)?是/,
      // "其实是" requires follow-up correction context, not just casual "其实是我忘了"
      /其实是[^，。！？\n]{1,20}(不是|而不是|应该)/,
      /搞错了/,
      /更正[：:]/,
      /纠正[：:]/,
      /^不对[，,\s]/,
      /说错了/,
      /我之前说错/,
      /错了[，,]?\s*(应该|其实|是)/,
      /不是这样/,
      /actually[, ].{0,30}(not|it's|it was|should)/i,
      /correction[: ]/i,
      /not (.+), (?:but |it's )/i,
      /実は.{0,20}(ではなく|じゃなく|違)/,
      /間違[いえっ]/,
      /訂正/,
    ],
    importance: 0.9,
    name: 'correction',
  },

  // ── Preference (direct) ──
  {
    category: 'preference',
    patterns: [
      /我(很|比较|特别|非常|超级|真的|确实|一直|最|挺|有点)?(喜欢|偏好|不要|不想|讨厌|倾向|更愿意|最喜欢)/,
      /我prefer/i,
      // EN: require "I" subject, not "you like" or "he likes"
      /\bi (really |absolutely |definitely )?(like|prefer|want|don'?t want|hate|love|enjoy|dislike) /i,
      /私は.{0,10}(好き|嫌い|したい|したくない)/,
      /が好き/,
      /は嫌[いだ]/,
      /please (always|never|don'?t)/i,
      /以后(都|总是|不要|别)/,
      /记住我(喜欢|不喜欢|偏好)/,
      /can'?t stand/i,
    ],
    importance: 0.85,
    name: 'preference',
  },

  // ── Preference (indirect — skip on questions) ──
  {
    category: 'preference',
    patterns: [
      /觉得.{1,20}(比较好|更好|最好|不错)/,
      // "还是...好" but not "还是算了吧"
      /还是.{1,15}(好|比较)(?!了|算)/,
      /用.{1,10}(习惯了|顺手)/,
      /\bi(?:'d| would) (?:rather|prefer)/i,
      /(?:fan|fond) of/i,
    ],
    importance: 0.75,
    name: 'preference_indirect',
    skipOnQuestion: true,
  },

  // ── Identity ──
  {
    category: 'identity',
    patterns: [
      // Expanded role list
      /我是[^，。！？\n]{1,30}(的人|工程师|投资者|开发者|设计师|学生|老师|医生|程序员|产品经理|创始人|自由职业|研究员|架构师|运维|全栈)/,
      /我叫[^，。！？\n]{1,20}/,
      /我的名字是/,
      /i(?:'m| am) (?:a |an )?[a-z]+ (?:developer|engineer|investor|designer|student|teacher|doctor|programmer|founder|researcher|architect|freelancer)/i,
      /my name is/i,
      /call me /i,
      /私は.{1,20}(と申します|といいます)/,
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

  // ── Decision (explicit — requires "我" or first person) ──
  {
    category: 'decision',
    patterns: [
      // Require first person "我" to avoid "你决定吧" / "让他决定"
      /我(已经|最终)?决定[了]?/,
      /我选择了/,
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
    ],
    importance: 0.8,
    name: 'decision',
  },

  // ── Decision (implicit — skip on questions) ──
  {
    category: 'decision',
    patterns: [
      /那就.{1,20}(吧|了)/,
      /行[，,]\s*就/,
      /好[，,]\s*(就)?用/,
      /换成/,
      /改[用成为]/,
      /迁移到/,
      /\bi(?:'ll| will) (?:use|go with|switch to|move to|stick with)/i,
      /switching to/i,
      /moving to/i,
      /going with/i,
    ],
    importance: 0.75,
    name: 'decision_implicit',
    skipOnQuestion: true,
  },

  // ── Todo ──
  {
    category: 'todo',
    patterns: [
      // "记得" but NOT "记得吗/记得吧/记得呢" (questions/rhetorical)
      /记得(?!吗|吧|呢|了吗|不)[^，。！？\n]{2,40}/,
      // "需要" but NOT "需要注意的是" (explanatory) or "需要吗" (question)
      /需要(?!注意的是|了解的是|说明的是|吗|呢)[^，。！？\n]{2,40}/,
      /待办/,
      /别忘了/,
      /提醒我/,
      /回头(要|得|记得)/,
      /下次记得/,
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

  // ── Fact ──
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

  // ── Skill ──
  {
    category: 'skill',
    patterns: [
      // "我会" + skill noun/verb, NOT "我会去/想/帮/看/试/等/来/走/做" (future tense actions)
      /我会(写|用|做|开发|设计|搭建|部署|配置|管理|运维|编程|编写|调试|优化)[^，。！？\n]{0,30}/,
      /我(很|比较|特别|非常|超)?擅长/,
      /我(很|比较|特别|非常|超)?熟悉/,
      /我精通/,
      /i know how to/i,
      /i(?:'m| am) (?:good|proficient|experienced|skilled|fluent) (?:at|in|with)/i,
      /i have (?:\d+ years? )?experience (?:with|in)/i,
      /得意な/,
      /スキル/,
    ],
    importance: 0.85,
    name: 'skill',
  },

  // ── Relationship ──
  {
    category: 'relationship',
    patterns: [
      /我的(同事|老板|领导|经理|朋友|搭档|合伙人|老婆|老公|女朋友|男朋友|室友|导师|学生|客户|下属)/,
      /我(同事|老板|领导)[^，。！？\n]{1,20}/,
      /my (colleague|coworker|boss|manager|friend|partner|wife|husband|girlfriend|boyfriend|roommate|mentor|client)/i,
      /i work with/i,
      /チームメンバー/,
      /同僚の/,
      /上司の/,
    ],
    importance: 0.85,
    name: 'relationship',
  },

  // ── Goal ──
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

  // ── Constraint ──
  {
    category: 'constraint',
    patterns: [
      /禁止.{1,30}/,
      /绝对不[要能可]/,
      /(?<!怪|难|舍|巴|了|恨|免)不得(?!了|已|而知|不).{1,40}/,
      /(不许|不允许|不可以).{1,40}/,
      /(永远|任何时候|无论如何)都?不[要能可以]/,
      /must not/i,
      /never .{0,30}(do|allow|execute|run|use)/i,
      /forbidden/i,
      /prohibited/i,
      /do not .{1,30} under any circumstances/i,
      /してはいけない/,
      /禁じ/,
      /絶対に.{0,20}(ない|だめ|いけない)/,
      /厳禁/,
    ],
    importance: 0.95,
    name: 'constraint',
  },

  // ── Agent self-improvement (matches ASSISTANT text only) ──
  {
    category: 'agent_self_improvement',
    patterns: [
      /我(发现|注意到|意识到)(自己|我).{0,20}(应该|可以|需要).{0,20}(改进|优化|调整)/,
      /下次(我|应该|可以)/,
      /i (should|could|need to) (improve|adjust|change)/i,
      /next time i (should|will|could)/i,
      /i noticed (that )?i/i,
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

  // Question detection: skip indirect preference/decision patterns when user is asking a question
  // Covers: trailing ？/?/吗/呢, and leading question words
  const trimmedUser = cleanUser.trim();
  const isQuestion = /[？?]\s*$/.test(trimmedUser) ||
    /[吗呢]\s*[？?]?\s*$/.test(trimmedUser) ||
    /^(你觉得|你认为|你说|你看|怎么样|哪个|选哪|好不好|是不是|do you think|which|what do you|should i|is it better|how about)/i.test(trimmedUser);

  for (const rule of HIGH_SIGNAL_PATTERNS) {
    // Agent categories match assistant text; all other categories match user text only
    const text = rule.category.startsWith('agent_') ? cleanAssistant : cleanUser;
    if (!text || text.length < 3) continue;

    // Skip indirect patterns when user is asking a question
    if (rule.skipOnQuestion && isQuestion) continue;

    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract surrounding context at sentence boundaries
        const idx = match.index || 0;
        const context = extractSentenceContext(text, idx, match[0].length);

        // Skip constraint/policy signals that are too short to be meaningful rules
        // 4 chars allows valid Chinese constraints like "禁止删除", "不得修改"
        if ((rule.category === 'constraint' || rule.category === 'policy') && context.length < 4) {
          continue;
        }

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

  // Very short messages (but CJK characters carry more meaning per char)
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(trimmed);
  const minLength = hasCJK ? 2 : 5;
  if (trimmed.length < minLength) return true;

  // Pure emoji messages
  if (/^[\p{Emoji}\s]+$/u.test(trimmed)) return true;

  const smallTalkPatterns = [
    /^(hi|hello|hey|yo|sup|嗨|你好|哈喽|おはよう|こんにちは|早安|晚安|おやすみ)[\s!！。.]*$/i,
    /^(thanks|thank you|谢谢|ありがとう|thx|tks|ty)[\s!！。.]*$/i,
    /^(ok|okay|好的|了解|わかった|はい|嗯嗯|嗯|行)[\s!！。.]*$/i,
    /^(bye|goodbye|再见|じゃね|さようなら|拜拜|88)[\s!！。.]*$/i,
    /^(lol|haha|哈哈|hhh|笑|www|233|666|nb|牛)[\s!！。.]*$/i,
    /^(yes|no|是|不是|うん|ううん|对|没错|是的)[\s!！。.]*$/i,
  ];

  return smallTalkPatterns.some(p => p.test(trimmed));
}
