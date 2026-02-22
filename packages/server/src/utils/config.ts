// Cortex Configuration System
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const LLMProviderSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'gemini', 'deepseek', 'openrouter', 'ollama', 'none']),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

const EmbeddingProviderSchema = z.object({
  provider: z.enum(['openai', 'google', 'gemini', 'voyage', 'ollama', 'none']),
  model: z.string().optional(),
  dimensions: z.number().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  timeoutMs: z.number().optional(),
});

const VectorBackendSchema = z.object({
  provider: z.enum(['sqlite-vec', 'qdrant', 'milvus', 'none']).default('sqlite-vec'),
  qdrant: z.object({
    url: z.string(),
    collection: z.string(),
    apiKey: z.string().optional(),
  }).optional(),
});

const CortexConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(21100),
  host: z.string().default('127.0.0.1'),
  auth: z.object({
    token: z.string().optional(),
  }).default({}),
  cors: z.object({
    origin: z.union([z.string(), z.array(z.string()), z.boolean()]).default(true),
  }).default({}),
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    windowMs: z.number().default(60000),
    maxRequests: z.number().default(120),
  }).default({}),
  storage: z.object({
    dbPath: z.string().default('cortex/brain.db'),
    walMode: z.boolean().default(true),
  }).default({}),
  llm: z.object({
    extraction: LLMProviderSchema.default({ provider: 'openai', model: 'gpt-4o' }),
    lifecycle: LLMProviderSchema.default({ provider: 'openai', model: 'gpt-4o-mini' }),
  }).default({}),
  embedding: EmbeddingProviderSchema.default({
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  }),
  vectorBackend: VectorBackendSchema.default({ provider: 'sqlite-vec' }),
  layers: z.object({
    working: z.object({ ttl: z.string().default('48h') }).default({}),
    core: z.object({ maxEntries: z.number().default(1000) }).default({}),
    archive: z.object({
      ttl: z.string().default('90d'),
      compressBackToCore: z.boolean().default(true),
    }).default({}),
  }).default({}),
  gate: z.object({
    maxInjectionTokens: z.number().default(3000),
    skipSmallTalk: z.boolean().default(true),
    layerWeights: z.object({
      core: z.number().default(1.0),
      working: z.number().default(0.8),
      archive: z.number().default(0.5),
    }).default({}),
  }).default({}),
  sieve: z.object({
    highSignalImmediate: z.boolean().default(true),
    fastChannelEnabled: z.boolean().default(true),
    parallelChannels: z.boolean().default(true),
    profileInjection: z.boolean().default(true),
    extractionLogging: z.boolean().default(true),
    maxExtractionTokens: z.number().default(800),
    maxConversationChars: z.number().min(2000).max(16000).default(4000),
    contextMessages: z.number().min(2).max(20).default(4),
    smartUpdate: z.boolean().default(true),
    similarityThreshold: z.number().min(0.1).max(0.8).default(0.35),
    exactDupThreshold: z.number().min(0.01).max(0.2).default(0.08),
    relationExtraction: z.boolean().default(true),
  }).default({}),
  lifecycle: z.object({
    schedule: z.string().default('0 3 * * *'),
    promotionThreshold: z.number().default(0.6),
    archiveThreshold: z.number().default(0.2),
    decayLambda: z.number().default(0.03),
  }).default({}),
  flush: z.object({
    enabled: z.boolean().default(true),
    softThresholdTokens: z.number().default(40000),
  }).default({}),
  search: z.object({
    hybrid: z.boolean().default(true),
    vectorWeight: z.number().default(0.7),
    textWeight: z.number().default(0.3),
    recencyBoostWindow: z.string().default('7d'),
    accessBoostCap: z.number().default(10),
  }).default({}),
  markdownExport: z.object({
    enabled: z.boolean().default(true),
    exportMemoryMd: z.boolean().default(true),
    debounceMs: z.number().default(300000),
  }).default({}),
});

export type CortexConfig = z.infer<typeof CortexConfigSchema>;

let _config: CortexConfig | null = null;
let _configFilePath: string | null = null;

export function loadConfig(overrides?: Partial<CortexConfig>): CortexConfig {
  // 1. Try loading from config file
  let fileConfig: Record<string, unknown> = {};
  // Prefer config inside DB directory (typically a Docker volume) so that
  // Dashboard changes survive container restarts.  Fall back to CWD / home.
  const dbDir = process.env.CORTEX_DB_PATH
    ? path.resolve(path.dirname(process.env.CORTEX_DB_PATH))
    : null;
  const configPaths = [
    ...(dbDir ? [path.join(dbDir, 'cortex.json')] : []),
    path.resolve('cortex.json'),
    path.resolve('cortex.config.json'),
    path.join(process.env.HOME || '', '.config/cortex/config.json'),
  ];

  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
        _configFilePath = p;
        break;
      } catch { /* skip invalid */ }
    }
  }

  // If no config file found, set default path for future persistence
  if (!_configFilePath) {
    _configFilePath = configPaths[0]!;
  }

  // 2. Env overrides
  const envOverrides: Record<string, unknown> = {};
  if (process.env.CORTEX_PORT) envOverrides.port = parseInt(process.env.CORTEX_PORT);
  if (process.env.CORTEX_HOST) envOverrides.host = process.env.CORTEX_HOST;
  if (process.env.CORTEX_DB_PATH) envOverrides.storage = { dbPath: process.env.CORTEX_DB_PATH };
  if (process.env.CORTEX_AUTH_TOKEN) envOverrides.auth = { token: process.env.CORTEX_AUTH_TOKEN };

  // 3. Merge and validate
  const merged = { ...fileConfig, ...envOverrides, ...overrides };
  _config = CortexConfigSchema.parse(merged);
  return _config;
}

export function getConfig(): CortexConfig {
  if (!_config) {
    return loadConfig();
  }
  return _config;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function updateConfig(partial: Partial<CortexConfig>): CortexConfig {
  const current = getConfig();
  _config = CortexConfigSchema.parse(deepMerge(current, partial));
  persistConfig(_config);
  return _config;
}

/** Persist current config to disk (best-effort, non-blocking) */
function persistConfig(config: CortexConfig): void {
  if (!_configFilePath) return;
  try {
    const dir = path.dirname(_configFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(_configFilePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch {
    // best-effort: don't crash if write fails
  }
}
