import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, createLogger } from './utils/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { initNeo4j, ensureSchema as ensureNeo4jSchema, closeNeo4j } from './db/neo4j.js';
import { CortexApp } from './app.js';
import { registerAllRoutes } from './api/router.js';
import { registerAuthRoutes, registerAuthMiddleware, registerAgentEnforcement, registerRateLimiting, registerInputLimits } from './api/security.js';
import { startLifecycleScheduler, stopLifecycleScheduler } from './core/scheduler.js';
import { ensureLoaded as ensureTokenizerLoaded } from './utils/tokenizer.js';
import { rebuildFtsIndex } from './db/fts-rebuild.js';

const log = createLogger('server');

async function main() {
  // 1. Load config
  const config = loadConfig();
  log.info({ port: config.port, host: config.host }, 'Starting Cortex server');

  // 1b. Initialize jieba tokenizer (loads WASM + dict)
  await ensureTokenizerLoaded();
  log.info('Jieba tokenizer loaded');

  // 2. Initialize databases
  initDatabase(config.storage.dbPath);

  // 2a. Rebuild FTS index with jieba tokenization (idempotent)
  rebuildFtsIndex();

  // 2b. Initialize Neo4j (optional — graph features)
  const neo4jDriver = initNeo4j();
  if (neo4jDriver) {
    await ensureNeo4jSchema();
  }

  // 3. Create app
  const cortex = new CortexApp(config);
  await cortex.initialize();

  // 4. Create Fastify server
  const app = Fastify({
    logger: false,  // We use our own pino logger
  });


  // Accept POST with empty body / no Content-Type (fixes 415 for bodyless POST routes)
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      const json = typeof body === "string" && body.trim() ? JSON.parse(body) : {};
      done(null, json);
    } catch (e: any) {
      done(e, undefined);
    }
  });
  // CORS
  await app.register(cors, {
    origin: config.cors?.origin ?? true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Auth config
  const authConfig = {
    token: config.auth?.token,
    agents: config.auth?.agents,
  };

  // Auth routes (public, must be before auth middleware)
  registerAuthRoutes(app, authConfig);

  // Security middleware
  registerAuthMiddleware(app, authConfig);
  registerAgentEnforcement(app, authConfig);
  registerInputLimits(app);
  if (config.rateLimit?.enabled !== false) {
    registerRateLimiting(app, {
      windowMs: config.rateLimit?.windowMs,
      maxRequests: config.rateLimit?.maxRequests,
    });
  }

  // Register routes
  registerAllRoutes(app, cortex);

  // Serve dashboard static files if available
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dashboardPath = path.resolve(__dirname, '../../dashboard/dist');
  if (fs.existsSync(dashboardPath)) {
    await app.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
    });
    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        return reply.sendFile('index.html');
      }
    });
    log.info({ path: dashboardPath }, 'Dashboard static files served');
  }

  // Error handler
  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    log.error({ error: error.message, url: req.url, method: req.method }, 'Request error');
    reply.code(error.statusCode || 500).send({
      error: error.message,
      statusCode: error.statusCode || 500,
    });
  });

  // 5. Start listening
  try {
    await app.listen({ port: config.port, host: config.host });
    log.info({ port: config.port, host: config.host }, 'Cortex server is running');

    // Start lifecycle scheduler
    startLifecycleScheduler(cortex);
  } catch (err) {
    log.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  // 6. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    stopLifecycleScheduler();
    await app.close();
    await cortex.shutdown();
    closeDatabase();
    await closeNeo4j();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
