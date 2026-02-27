import type { FastifyInstance } from 'fastify';
import { getStats, getDb } from '../db/index.js';
import { getConfig, updateConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import type { CortexApp } from '../app.js';
import type { Memory } from '../db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = createLogger('system');

// Read version from root package.json at startup
function getPackageVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Try multiple possible locations (dev vs built)
    for (const rel of ['../../../../package.json', '../../../package.json', '../../package.json']) {
      const p = path.resolve(__dirname, rel);
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.name === 'cortex' || pkg.name === '@cortex/root') return pkg.version;
        if (pkg.version) return pkg.version;
      }
    }
  } catch {}
  return '0.0.0';
}

const CURRENT_VERSION = getPackageVersion();
const GITHUB_REPO = 'rikouu/cortex';
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

// Cache latest release info (check at most every 30 min)
let latestReleaseCache: { tag: string; url: string; publishedAt: string; checkedAt: number } | null = null;
const RELEASE_CHECK_INTERVAL = 30 * 60 * 1000;

async function getLatestRelease(): Promise<typeof latestReleaseCache> {
  if (latestReleaseCache && Date.now() - latestReleaseCache.checkedAt < RELEASE_CHECK_INTERVAL) {
    return latestReleaseCache;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'cortex-server' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      latestReleaseCache = {
        tag: data.tag_name,
        url: data.html_url,
        publishedAt: data.published_at,
        checkedAt: Date.now(),
      };
    }
  } catch (e) {
    log.debug({ error: (e as Error).message }, 'Failed to check latest release');
  }
  return latestReleaseCache;
}

export function registerSystemRoutes(app: FastifyInstance, cortex: CortexApp): void {
  // Health check
  app.get('/api/v1/health', async () => {
    const latest = await getLatestRelease();
    const latestVersion = latest?.tag?.replace(/^v/, '') ?? null;
    return {
      status: 'ok',
      version: CURRENT_VERSION,
      github: GITHUB_URL,
      latestRelease: latest ? {
        version: latestVersion,
        url: latest.url,
        publishedAt: latest.publishedAt,
        updateAvailable: latestVersion ? latestVersion !== CURRENT_VERSION : false,
      } : null,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // Stats
  app.get('/api/v1/stats', async (req) => {
    const q = req.query as any;
    return getStats(q.agent_id);
  });

  // Get config (safe — masks sensitive fields, exposes baseUrl + hasApiKey)
  app.get('/api/v1/config', async () => {
    const config = getConfig();
    return {
      ...config,
      llm: {
        extraction: {
          provider: config.llm.extraction.provider,
          model: config.llm.extraction.model,
          baseUrl: config.llm.extraction.baseUrl,
          hasApiKey: !!config.llm.extraction.apiKey,
        },
        lifecycle: {
          provider: config.llm.lifecycle.provider,
          model: config.llm.lifecycle.model,
          baseUrl: config.llm.lifecycle.baseUrl,
          hasApiKey: !!config.llm.lifecycle.apiKey,
        },
      },
      embedding: {
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        baseUrl: config.embedding.baseUrl,
        hasApiKey: !!config.embedding.apiKey,
      },
    };
  });

  // Hot update config
  app.patch('/api/v1/config', async (req) => {
    const body = req.body as any;
    const updated = updateConfig(body);
    const reloaded = cortex.reloadProviders(updated);
    return { ok: true, config: updated, reloaded_providers: reloaded };
  });

  // Test LLM connection
  app.post('/api/v1/test-llm', async (req) => {
    const body = req.body as any;
    const target: 'extraction' | 'lifecycle' = body?.target === 'lifecycle' ? 'lifecycle' : 'extraction';
    const provider = target === 'extraction' ? cortex.llmExtraction : cortex.llmLifecycle;
    const providerName = cortex.config.llm[target].provider;
    const start = Date.now();
    try {
      await provider.complete('Reply with exactly: OK', { maxTokens: 10, temperature: 0 });
      return { ok: true, provider: providerName, latency_ms: Date.now() - start };
    } catch (e: any) {
      return { ok: false, provider: providerName, latency_ms: Date.now() - start, error: e.message };
    }
  });

  // Test Embedding connection
  app.post('/api/v1/test-embedding', async () => {
    const providerName = cortex.config.embedding.provider;
    const start = Date.now();
    try {
      const result = await cortex.embeddingProvider.embed('test connection');
      return {
        ok: result.length > 0,
        provider: providerName,
        dimensions: result.length,
        latency_ms: Date.now() - start,
      };
    } catch (e: any) {
      return { ok: false, provider: providerName, dimensions: 0, latency_ms: Date.now() - start, error: e.message };
    }
  });

  // Full reindex — rebuilds all vector embeddings
  app.post('/api/v1/reindex', async (req, reply) => {
    const db = getDb();
    const memories = db.prepare('SELECT id, content FROM memories WHERE superseded_by IS NULL').all() as Pick<Memory, 'id' | 'content'>[];

    let indexed = 0;
    let errors = 0;
    const batchSize = 20;

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      try {
        const embeddings = await cortex.embeddingProvider.embedBatch(batch.map(m => m.content));
        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j] && embeddings[j]!.length > 0) {
            await cortex.vectorBackend.upsert(batch[j]!.id, embeddings[j]!);
            indexed++;
          } else {
            log.warn({ id: batch[j]!.id }, 'Reindex: embedding returned empty, provider may be unavailable');
            errors++;
          }
        }
      } catch (e: any) {
        log.error({ error: e.message, batch: i }, 'Reindex batch failed');
        errors += batch.length;
      }
    }

    return { ok: true, total: memories.length, indexed, errors };
  });
}
