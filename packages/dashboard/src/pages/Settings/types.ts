export type SectionKey = 'llm' | 'search' | 'lifecycle' | 'layers' | 'gate' | 'sieve' | 'markdownExport' | 'auth' | 'selfImprovement';

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
    models: ['gpt-4o-mini', 'gpt-5.2', 'gpt-5.3-chat-latest', 'gpt-5.4'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6-20260217',
      'claude-opus-4-5-20251022',
      'claude-opus-4-6-20260205',
    ],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3-pro-preview'],
    envKey: 'GOOGLE_API_KEY',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4'],
    envKey: 'DEEPSEEK_API_KEY',
  },
  dashscope: {
    label: 'DashScope (通义千问)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      'qwen-plus', 'qwen-turbo', 'qwen-max',
      'qwen-long', 'qwen3-235b-a22b',
    ],
    envKey: 'DASHSCOPE_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-opus-4-6',
      'anthropic/claude-haiku-4-5',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'openai/gpt-5.2',
      'openai/gpt-4o-mini',
      'deepseek/deepseek-v4',
      'deepseek/deepseek-chat-v3',
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
      'gemini-embedding-2',
      'gemini-embedding-001',
      'text-embedding-004',
    ],
    envKey: 'GOOGLE_API_KEY',
  },
  voyage: {
    label: 'Voyage AI',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    models: [
      'voyage-4-large', 'voyage-4-lite', 'voyage-4-nano',
      'voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite',
      'voyage-code-3',
    ],
    envKey: 'VOYAGE_API_KEY',
  },
  dashscope: {
    label: 'DashScope (通义千问)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      'text-embedding-v3',
      'text-embedding-v2',
    ],
    envKey: 'DASHSCOPE_API_KEY',
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
export const RERANKER_PROVIDERS: Record<string, ProviderPreset> = {
  none: {
    label: 'Disabled',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
  llm: {
    label: 'LLM (uses extraction model)',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
  cohere: {
    label: 'Cohere',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    models: ['rerank-v3.5', 'rerank-v3.0'],
    envKey: 'COHERE_API_KEY',
  },
  voyage: {
    label: 'Voyage AI (200M free tokens)',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    models: ['rerank-2.5', 'rerank-2.5-lite', 'rerank-2'],
    envKey: 'VOYAGE_API_KEY',
  },
  jina: {
    label: 'Jina AI (multilingual, 1M free tokens)',
    defaultBaseUrl: 'https://api.jina.ai/v1',
    models: ['jina-reranker-v2-base-multilingual', 'jina-reranker-v1-base-en'],
    envKey: 'JINA_API_KEY',
  },
  siliconflow: {
    label: 'SiliconFlow (开源模型)',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    models: ['BAAI/bge-reranker-v2-m3', 'BAAI/bge-reranker-large'],
    envKey: 'SILICONFLOW_API_KEY',
  },
};

export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Google
  'gemini-embedding-2': 3072,
  'gemini-embedding-001': 768,
  'text-embedding-004': 768,
  // Voyage
  'voyage-4-large': 2048,
  'voyage-4-lite': 1024,
  'voyage-4-nano': 512,
  'voyage-3-large': 1024,
  'voyage-3.5': 1024,
  'voyage-3.5-lite': 1024,
  'voyage-code-3': 1024,
  // DashScope
  'text-embedding-v3': 1024,
  'text-embedding-v2': 1536,
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
