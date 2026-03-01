export type SectionKey = 'llm' | 'search' | 'lifecycle' | 'layers' | 'gate' | 'sieve';

// ─── Provider & Model Presets ────────────────────────────────────────────────

export interface ProviderPreset {
  label: string;
  defaultBaseUrl: string;
  models: string[];
  envKey: string;
}

export const LLM_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4o', 'o4-mini', 'o3-mini'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
      'claude-opus-4-5-20251022',
    ],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    envKey: 'GOOGLE_API_KEY',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    envKey: 'DEEPSEEK_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-sonnet-4-5',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'openai/gpt-4o-mini',
      'deepseek/deepseek-chat-v3',
      'deepseek/deepseek-r1',
      'meta-llama/llama-4-maverick',
      'qwen/qwen3-235b-a22b',
    ],
    envKey: 'OPENROUTER_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      'qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5:14b',
      'llama3.2:3b', 'llama3.2:8b',
      'mistral:7b', 'mistral-nemo:12b',
      'deepseek-r1:7b', 'deepseek-r1:14b',
      'gemma2:9b', 'phi3:14b',
    ],
    envKey: '',
  },
  none: {
    label: 'Disabled',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
};

export const EMBEDDING_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      'text-embedding-3-small',
      'text-embedding-3-large',
      'text-embedding-ada-002',
    ],
    envKey: 'OPENAI_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: [
      'gemini-embedding-001',
      'text-embedding-004',
    ],
    envKey: 'GOOGLE_API_KEY',
  },
  voyage: {
    label: 'Voyage AI',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    models: [
      'voyage-3', 'voyage-3-lite',
      'voyage-code-3',
    ],
    envKey: 'VOYAGE_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      'bge-m3', 'nomic-embed-text',
      'mxbai-embed-large', 'all-minilm',
    ],
    envKey: '',
  },
  none: {
    label: 'Disabled',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
};

/** Recommended embedding dimensions per model */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Google
  'gemini-embedding-001': 768,
  'text-embedding-004': 768,
  // Voyage
  'voyage-3': 1024,
  'voyage-3-lite': 512,
  'voyage-code-3': 1024,
  // Ollama
  'bge-m3': 1024,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
};

export const CUSTOM_MODEL = '__custom__';

// ─── Schedule Presets ────────────────────────────────────────────────────────

export interface SchedulePreset {
  value: string;
  labelKey: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { value: '', labelKey: 'settings.scheduleDisabled' },
  { value: '0 * * * *', labelKey: 'settings.scheduleEveryHour' },
  { value: '0 */6 * * *', labelKey: 'settings.scheduleEvery6Hours' },
  { value: '0 */12 * * *', labelKey: 'settings.scheduleEvery12Hours' },
  { value: '0 0 * * *', labelKey: 'settings.scheduleDailyMidnight' },
  { value: '0 3 * * *', labelKey: 'settings.scheduleDailyAt3' },
  { value: '0 6 * * *', labelKey: 'settings.scheduleDailyAt6' },
];

export const SCHEDULE_CUSTOM = '__custom__';

// ─── Duration Helpers ────────────────────────────────────────────────────────

export function parseDuration(s: string): { num: string; unit: string } {
  if (!s) return { num: '', unit: 'h' };
  const m = s.match(/^(\d+)\s*(m|h|d)$/i);
  if (m) return { num: m[1], unit: m[2].toLowerCase() };
  const numOnly = s.replace(/[^0-9]/g, '');
  return { num: numOnly || '', unit: 'h' };
}
