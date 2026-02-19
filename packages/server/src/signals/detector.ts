import type { MemoryCategory } from '../db/queries.js';

export interface DetectedSignal {
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  pattern: string;
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
      /我(喜欢|偏好|不要|不想|讨厌|倾向|更愿意)/,
      /我prefer/i,
      /i (like|prefer|want|don'?t want|hate|love)/i,
      /私は.{0,10}(好き|嫌い|したい|したくない)/,
      /が好き/,
      /は嫌[いだ]/,
      /please (always|never|don'?t)/i,
      /以后(都|总是|不要|别)/,
      /记住我(喜欢|不喜欢|偏好)/,
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
];

/**
 * Detect high-signal information from user/assistant exchange.
 * Uses regex patterns only — no LLM call needed.
 */
export function detectHighSignals(exchange: { user: string; assistant: string }): DetectedSignal[] {
  const signals: DetectedSignal[] = [];
  const text = `${exchange.user}\n${exchange.assistant}`;

  for (const rule of HIGH_SIGNAL_PATTERNS) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract surrounding context (up to 200 chars around match)
        const idx = match.index || 0;
        const start = Math.max(0, idx - 50);
        const end = Math.min(text.length, idx + match[0].length + 150);
        const context = text.slice(start, end).trim();

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
