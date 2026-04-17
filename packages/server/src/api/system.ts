import type { FastifyInstance } from 'fastify';
import { getStats, getDb } from '../db/index.js';
import { getConfig, updateConfig } from '../utils/config.js';
import { restartLifecycleScheduler } from '../core/scheduler.js';
import { sanitizeLLMConfig } from '../llm/config-utils.js';
import { createLogger, getLogLevel as _getLogLevel, setLogLevel as _setLogLevel, getLogBuffer } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import type { CortexApp } from '../app.js';
import type { Memory } from '../db/queries.js';
import type { SearchResult } from '../search/index.js';
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
        // Only return version from the root monorepo package, not sub-packages
        if (pkg.name === 'cortex' || pkg.name === '@cortex/root') return pkg.version;
      }
    }
  } catch {}
  return '0.0.0';
}

const CURRENT_VERSION = getPackageVersion();

/** Returns true if `latest` is strictly newer than `current` (semver comparison) */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [lM, lm, lp] = parse(latest);
  const [cM, cm, cp] = parse(current);
  if (lM !== cM) return lM > cM;
  if (lm !== cm) return lm > cm;
  return (lp || 0) > (cp || 0);
}
const GITHUB_REPO = 'rikouu/cortex';
const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

// Cache latest release info (check at most every 30 min)
let latestReleaseCache: { tag: string; url: string; publishedAt: string; checkedAt: number } | null = null;
const RELEASE_CHECK_INTERVAL = 30 * 60 * 1000;

async function getLatestRelease(forceRefresh = false): Promise<typeof latestReleaseCache> {
  if (!forceRefresh && latestReleaseCache && Date.now() - latestReleaseCache.checkedAt < RELEASE_CHECK_INTERVAL) {
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
  // Metrics endpoint (Prometheus text format)
  app.get('/api/v1/metrics', async (req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return metrics.toPrometheus();
  });

  // Metrics endpoint (JSON format for Dashboard)
  app.get('/api/v1/metrics/json', async () => {
    return metrics.toJSON();
  });

  // Log level
  app.get('/api/v1/log-level', async () => {
    return { level: _getLogLevel() };
  });

  app.patch('/api/v1/log-level', async (req) => {
    const { level } = req.body as any;
    const valid = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (!valid.includes(level)) {
      return { ok: false, error: `Invalid level. Use: ${valid.join(', ')}` };
    }
    _setLogLevel(level);
    return { ok: true, level };
  });

  // System logs (ring buffer)
  app.get('/api/v1/logs', async (req) => {
    const query = req.query as any;
    const limit = Math.min(Number(query.limit) || 100, 500);
    const level = query.level || undefined;
    return { logs: getLogBuffer(limit, level) };
  });

  // Health check (?refresh=true to bypass release cache)
  app.get('/api/v1/health', async (req) => {
    const query = req.query as any;
    const latest = await getLatestRelease(query.refresh === 'true');
    const latestVersion = latest?.tag?.replace(/^v/, '') ?? null;
    return {
      status: 'ok',
      version: CURRENT_VERSION,
      github: GITHUB_URL,
      latestRelease: latest ? {
        version: latestVersion,
        url: latest.url,
        publishedAt: latest.publishedAt,
        updateAvailable: latestVersion ? isNewerVersion(latestVersion, CURRENT_VERSION) : false,
      } : null,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  // Trigger self-update: pull latest image + recreate container
  // Requires: docker socket + docker-compose.yml mounted (see docker-compose.yml)
  //
  // Strategy:
  // 1. Pull latest image (safe, no effect on running container)
  // 2. Spawn a helper container (`docker run -d`) that waits, then runs
  //    `docker compose up -d --force-recreate` to replace us.
  //    The helper is a separate container, so it survives our shutdown.
  app.post('/api/v1/update', async () => {
    if (!fs.existsSync('/var/run/docker.sock')) {
      return { ok: false, error: 'Docker socket not mounted.' };
    }
    if (!fs.existsSync('/app/docker-compose.yml')) {
      return { ok: false, error: 'docker-compose.yml not mounted into /app/.' };
    }

    try {
      const { spawn, spawnSync } = await import('node:child_process');
      const hostname = (await import('node:os')).hostname();

      // Validate path to prevent injection
      const isValidPath = (p: string) => /^\/[A-Za-z0-9_/.\-]+$/.test(p);

      // Detect compose project name + config file path on host
      let project = 'cortex';
      let composeDir = '/opt/cortex'; // default
      let composeHostPath = '/opt/cortex/docker-compose.yml';
      try {
        const inspectRes = spawnSync(
          'curl', ['-s', '--unix-socket', '/var/run/docker.sock', `http://localhost/containers/${hostname}/json`],
          { encoding: 'utf-8', timeout: 5000 }
        );
        const info = JSON.parse(inspectRes.stdout);
        const detectedProject = info?.Config?.Labels?.['com.docker.compose.project'];
        if (detectedProject && /^[A-Za-z0-9_-]+$/.test(detectedProject)) {
          project = detectedProject;
        }
        const mounts = info?.Mounts || [];
        const composeMnt = mounts.find((m: any) => m.Destination === '/app/docker-compose.yml');
        if (composeMnt?.Source && isValidPath(composeMnt.Source)) {
          composeHostPath = composeMnt.Source;
          composeDir = composeMnt.Source.replace(/\/docker-compose\.yml$/, '');
        }
        log.info({ project, composeDir }, 'Detected compose context');
      } catch { /* best effort */ }

      // Step 0: Ensure compose file uses image: mode (not build:)
      try {
        const composeContent = fs.readFileSync('/app/docker-compose.yml', 'utf-8');
        const lines = composeContent.split('\n');
        let hasBuild = false;
        let hasImage = false;
        let inCortexService = false;
        for (const line of lines) {
          if (/^\s{2}\w+:/.test(line) && !line.trim().startsWith('#')) {
            inCortexService = /^\s{2}cortex:/.test(line);
          }
          if (!inCortexService) continue;
          const trimmed = line.trim();
          if (trimmed.startsWith('#')) continue;
          if (/^\s*build:\s/.test(line)) hasBuild = true;
          if (/^\s*image:\s/.test(line)) hasImage = true;
        }
        if (hasBuild && !hasImage) {
          log.warn('Compose file is in build mode, switching to image mode for update');
          try {
            spawnSync('docker', [
              'run', '--rm', '-v', `${composeDir}:/target`, 'alpine',
              'sh', '-c', "sed -i 's|^\\(\\s*\\)build: \\.|\\1# build: .|;s|^\\(\\s*\\)# *image: ghcr|\\1image: ghcr|' /target/docker-compose.yml",
            ], { timeout: 10000, stdio: 'pipe' });
            log.info('Compose file switched to image mode');
          } catch (fixErr: any) {
            log.warn({ error: fixErr.message }, 'Failed to auto-fix compose file, proceeding anyway');
          }
        }
      } catch (e: any) {
        log.warn({ error: e.message }, 'Could not check compose file mode');
      }

      // Step 1: Pull latest image
      const IMAGE = 'ghcr.io/rikouu/cortex:latest';
      log.info('Pulling latest image...');
      const pullResult = spawnSync('docker', ['pull', IMAGE], { timeout: 120000, encoding: 'utf-8', stdio: 'pipe' });
      if (pullResult.status !== 0) {
        return { ok: false, error: 'Pull failed: ' + (pullResult.stderr || pullResult.error?.message || 'unknown') };
      }
      log.info({ output: (pullResult.stdout || '').trim().split('\n').pop() }, 'Pull complete');

      // Step 2: Remove stale updater container if exists
      spawnSync('docker', ['rm', '-f', 'cortex-updater'], { timeout: 5000, stdio: 'pipe' });

      // Step 3: Spawn a helper container to recreate us
      const helperArgs = [
        'run', '-d', '--rm', '--name', 'cortex-updater',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-v', `${composeDir}:/work:ro`,
        '-w', '/work',
        IMAGE,
        'sh', '-c', `sleep 2 && docker compose -p ${project} up -d --force-recreate --remove-orphans 2>&1`,
      ];

      log.info({ helperArgs }, 'Spawning updater container');
      const helper = spawn('docker', helperArgs, { stdio: 'pipe', detached: true });
      helper.unref();
      helper.on('error', (err) => log.error({ error: err.message }, 'Failed to spawn updater'));

      return { ok: true, message: 'Update triggered. Server will restart shortly.' };
    } catch (e: any) {
      log.error({ error: e.message }, 'Failed to trigger update');
      return { ok: false, error: e.message };
    }
  });
  // Component health status
  app.get('/api/v1/health/components', async () => {
    const db = getDb();
    const config = getConfig();
    const components: any[] = [];

    // 1. Extraction LLM
    try {
      const last = db.prepare(`SELECT channel, created_at, latency_ms, memories_written, memories_deduped FROM extraction_logs ORDER BY created_at DESC LIMIT 1`).get() as any;
      // Ensure UTC timestamp has Z suffix for correct client-side parsing
      if (last?.created_at && !last.created_at.endsWith('Z')) last.created_at = last.created_at + 'Z';
      const errorCount = (db.prepare(`SELECT COUNT(*) as c FROM extraction_logs WHERE error IS NOT NULL AND created_at > datetime('now', '-24 hours')`).get() as any)?.c || 0;
      const totalLast24h = (db.prepare(`SELECT COUNT(*) as c FROM extraction_logs WHERE created_at > datetime('now', '-24 hours')`).get() as any)?.c || 0;
      components.push({
        id: 'extraction_llm',
        name: 'Extraction LLM',
        status: last ? 'ok' : 'unknown',
        lastRun: last?.created_at || null,
        latencyMs: last?.latency_ms || null,
        details: {
          channel: last?.channel,
          memoriesWritten: last?.memories_written,
          last24h: totalLast24h,
          errorsLast24h: errorCount,
        },
      });
    } catch { components.push({ id: 'extraction_llm', name: 'Extraction LLM', status: 'error' }); }

    // 2. Lifecycle Engine
    try {
      const last = db.prepare(`SELECT action, executed_at, details FROM lifecycle_log WHERE action = 'lifecycle_run' ORDER BY executed_at DESC LIMIT 1`).get() as any;
      if (last?.executed_at && !last.executed_at.endsWith('Z')) last.executed_at = last.executed_at + 'Z';
      let details: any = {};
      try { details = last?.details ? JSON.parse(last.details) : {}; } catch {}
      const hasErrors = details.errors && details.errors.length > 0;
      components.push({
        id: 'lifecycle',
        name: 'Lifecycle Engine',
        status: last ? (hasErrors ? 'warning' : 'ok') : 'unknown',
        lastRun: last?.executed_at || null,
        latencyMs: details.durationMs || null,
        details: {
          trigger: details.trigger,
          promoted: details.promoted,
          archived: details.archived,
          expired: details.expiredWorking,
          errors: details.errors?.length || 0,
        },
      });
    } catch { components.push({ id: 'lifecycle', name: 'Lifecycle Engine', status: 'error' }); }

    // 3. Embedding Service
    try {
      // Check if embedding is configured
      const hasEmbedding = !!(config.embedding?.baseUrl || config.embedding?.apiKey || process.env.OPENAI_API_KEY);
      const lastAccess = db.prepare(`SELECT accessed_at FROM access_log ORDER BY accessed_at DESC LIMIT 1`).get() as any;
      if (lastAccess?.accessed_at && !lastAccess.accessed_at.endsWith('Z')) lastAccess.accessed_at = lastAccess.accessed_at + 'Z';
      components.push({
        id: 'embedding',
        name: 'Embedding',
        status: hasEmbedding ? (lastAccess ? 'ok' : 'unknown') : 'not_configured',
        lastRun: lastAccess?.accessed_at || null,
        details: {
          model: config.embedding?.model || 'default',
          configured: hasEmbedding,
        },
      });
    } catch { components.push({ id: 'embedding', name: 'Embedding', status: 'error' }); }

    // 4. Scheduler
    try {
      const { getSchedulerStatus } = await import('../core/scheduler.js');
      const sched = getSchedulerStatus();
      components.push({
        id: 'scheduler',
        name: 'Scheduler',
        status: sched.running ? 'ok' : 'stopped',
        details: {
          schedule: sched.schedule,
          nextRun: sched.nextRun,
          running: sched.running,
        },
      });
    } catch { components.push({ id: 'scheduler', name: 'Scheduler', status: 'unknown' }); }

    return { components };
  });

  // Test connections
  app.post('/api/v1/health/test', async () => {
    const config = getConfig();
    const results: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

    // Test LLM
    try {
      const start = Date.now();
      const response = await cortex.llmExtraction.complete('Reply with exactly: pong', { maxTokens: 10 });
      results.llm = { ok: response.length > 0, latencyMs: Date.now() - start };
    } catch (e: any) {
      results.llm = { ok: false, latencyMs: 0, error: e.message?.slice(0, 200) };
    }

    // Test Embedding
    try {
      const start = Date.now();
      const emb = await cortex.embeddingProvider.embed('test connection');
      results.embedding = { ok: emb.length > 0, latencyMs: Date.now() - start };
      if (emb.length === 0) results.embedding.error = 'Empty embedding returned';
    } catch (e: any) {
      results.embedding = { ok: false, latencyMs: 0, error: e.message?.slice(0, 200) };
    }

    return results;
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
      serverInfo: {
        time: new Date().toISOString(),
        timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        uptime: Math.floor(process.uptime()),
        resolvedDbPath: config.storage.dbPath,
      },
      llm: {
        extraction: sanitizeLLMConfig(config.llm.extraction),
        lifecycle: sanitizeLLMConfig(config.llm.lifecycle),
      },
      embedding: {
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        baseUrl: config.embedding.baseUrl,
        hasApiKey: !!config.embedding.apiKey,
      },
      search: {
        ...config.search,
        reranker: {
          ...config.search.reranker,
          apiKey: undefined,
          hasApiKey: !!config.search.reranker?.apiKey,
        },
      },
    };
  });

  // Export full config (redacts secrets — for backup/migration review)
  app.get('/api/v1/config/export', async () => {
    const config = getConfig();
    const exportable = JSON.parse(JSON.stringify(config));
    // Redact all API keys and auth tokens
    const redact = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (/^(apiKey|api_key|token)$/i.test(key) && typeof obj[key] === 'string') {
          obj[key] = '***REDACTED***';
        } else if (typeof obj[key] === 'object') {
          redact(obj[key]);
        }
      }
    };
    redact(exportable);
    return exportable;
  });

  // Hot update config
  app.patch('/api/v1/config', async (req) => {
    const body = req.body as any;
    const updated = updateConfig(body);
    const reloaded = await cortex.reloadProviders(updated);
    // Restart lifecycle scheduler if schedule changed
    if (body.lifecycle?.schedule !== undefined) {
      restartLifecycleScheduler(cortex);
    }
    return { ok: true, reloaded_providers: reloaded };
  });

  // Test LLM connection
  app.post('/api/v1/test-llm', async (req) => {
    const body = req.body as any;
    const target: 'extraction' | 'lifecycle' = body?.target === 'lifecycle' ? 'lifecycle' : 'extraction';
    const provider = target === 'extraction' ? cortex.llmExtraction : cortex.llmLifecycle;
    const providerConfig = cortex.config.llm[target];
    const providerName = providerConfig.provider;
    const start = Date.now();
    try {
      await provider.complete('Reply with exactly: OK', { maxTokens: 10, temperature: 0 });
      const attemptMeta = typeof (provider as any).getLastAttemptMeta === 'function'
        ? (provider as any).getLastAttemptMeta()
        : null;
      return {
        ok: true,
        provider: providerName,
        fallback_provider: providerConfig.fallback?.provider,
        latency_ms: Date.now() - start,
        used_provider: attemptMeta?.provider,
        attempts: attemptMeta?.totalAttempts,
      };
    } catch (e: any) {
      return {
        ok: false,
        provider: providerName,
        fallback_provider: providerConfig.fallback?.provider,
        latency_ms: Date.now() - start,
        error: e.message,
      };
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

  // Test Reranker connection
  app.post('/api/v1/test-reranker', async () => {
    const rerankerConfig = cortex.config.search?.reranker;
    const provider = rerankerConfig?.provider ?? 'none';
    if (provider === 'none') {
      return { ok: false, provider, error: 'Reranker is disabled' };
    }
    // Check API key for dedicated providers
    if (['cohere', 'voyage', 'jina', 'siliconflow'].includes(provider)) {
      const envKeys: Record<string, string> = { cohere: 'COHERE_API_KEY', voyage: 'VOYAGE_API_KEY', jina: 'JINA_API_KEY', siliconflow: 'SILICONFLOW_API_KEY' };
      if (!rerankerConfig?.apiKey && !process.env[envKeys[provider] ?? '']) {
        return { ok: false, provider, error: `API key not configured. Set it in Dashboard or via ${envKeys[provider]} env var.` };
      }
    }
    const start = Date.now();
    try {
      // Create a minimal test: rerank 3 simple documents
      const now = new Date().toISOString();
      const testResults: SearchResult[] = [
        {
          id: '1',
          content: 'The weather is nice today',
          layer: 'core',
          category: 'fact',
          agent_id: 'test',
          importance: 0.5,
          decay_score: 1,
          access_count: 1,
          created_at: now,
          textScore: 0.2,
          vectorScore: 0.2,
          rawVectorSim: 0.2,
          fusedScore: 0.2,
          layerWeight: 1,
          recencyBoost: 1,
          accessBoost: 1,
          finalScore: 0.2,
        },
        {
          id: '2',
          content: 'Cortex is a memory system for AI',
          layer: 'core',
          category: 'fact',
          agent_id: 'test',
          importance: 0.5,
          decay_score: 1,
          access_count: 1,
          created_at: now,
          textScore: 0.9,
          vectorScore: 0.9,
          rawVectorSim: 0.9,
          fusedScore: 0.9,
          layerWeight: 1,
          recencyBoost: 1,
          accessBoost: 1,
          finalScore: 0.9,
        },
        {
          id: '3',
          content: 'Docker containers need regular cleanup',
          layer: 'core',
          category: 'fact',
          agent_id: 'test',
          importance: 0.5,
          decay_score: 1,
          access_count: 1,
          created_at: now,
          textScore: 0.1,
          vectorScore: 0.1,
          rawVectorSim: 0.1,
          fusedScore: 0.1,
          layerWeight: 1,
          recencyBoost: 1,
          accessBoost: 1,
          finalScore: 0.1,
        },
      ];
      const { createReranker } = await import('../search/reranker.js');
      const reranker = createReranker(rerankerConfig, cortex.llmExtraction);
      const ranked = await reranker.rerank('What is Cortex?', testResults, 3);
      const topContent = ranked[0]?.content ?? '';
      return {
        ok: ranked.length > 0,
        provider,
        model: rerankerConfig?.model ?? (provider === 'llm' ? 'extraction model' : ''),
        topResult: topContent.substring(0, 50),
        latency_ms: Date.now() - start,
      };
    } catch (e: any) {
      return { ok: false, provider, latency_ms: Date.now() - start, error: e.message };
    }
  });

  // Full reindex — rebuilds all vector embeddings
  app.post('/api/v1/reindex', async (req, reply) => {
    // Re-initialize vector backend in case embedding dimensions changed since startup
    await cortex.vectorBackend.initialize(cortex.embeddingProvider.dimensions || 1536);

    const db = getDb();
    const memories = db.prepare('SELECT id, content FROM memories WHERE superseded_by IS NULL').all() as Pick<Memory, 'id' | 'content'>[];
    const activeIds = new Set(memories.map(m => m.id));

    // Clean ghost vectors: entries in vector index for deleted/superseded memories
    let ghostsCleaned = 0;
    try {
      const vecTable = (() => {
        try { db.prepare('SELECT 1 FROM memories_vec LIMIT 0').get(); return 'memories_vec'; } catch { /* */ }
        try { db.prepare('SELECT 1 FROM memories_vec_fallback LIMIT 0').get(); return 'memories_vec_fallback'; } catch { /* */ }
        return null;
      })();
      if (vecTable) {
        const vecIds = (db.prepare(`SELECT memory_id FROM ${vecTable}`).all() as { memory_id: string }[]).map(r => r.memory_id);
        const ghostIds = vecIds.filter(id => !activeIds.has(id));
        if (ghostIds.length > 0) {
          await cortex.vectorBackend.delete(ghostIds);
          ghostsCleaned = ghostIds.length;
          log.info({ count: ghostsCleaned }, 'Cleaned ghost vectors during reindex');
        }
      }
    } catch (e: any) {
      log.warn({ error: e.message }, 'Ghost vector cleanup failed, continuing with reindex');
    }

    let indexed = 0;
    let errors = 0;
    const batchSize = 20;

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      try {
        const embeddings = await cortex.embeddingProvider.embedBatch(batch.map(m => m.content));
        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j] && embeddings[j]!.length > 0) {
            try {
              await cortex.vectorBackend.upsert(batch[j]!.id, embeddings[j]!);
              indexed++;
            } catch (ue: any) {
              log.error({ id: batch[j]!.id, error: ue.message }, 'Reindex: vector upsert failed');
              errors++;
            }
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

    // Also rebuild FTS index with jieba tokenization
    try {
      const { rebuildFtsIndex } = await import('../db/fts-rebuild.js');
      rebuildFtsIndex();
    } catch (e: any) {
      log.warn({ error: e.message }, 'FTS rebuild during reindex failed');
    }

    return { ok: true, total: memories.length, indexed, errors, ghosts_cleaned: ghostsCleaned };
  });
}
