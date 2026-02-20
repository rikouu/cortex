import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, createLogger } from './utils/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { CortexApp } from './app.js';
import { registerAllRoutes } from './api/router.js';
import { registerAuthMiddleware, registerRateLimiting } from './api/security.js';

const log = createLogger('server');

async function main() {
  // 1. Load config
  const config = loadConfig();
  log.info({ port: config.port, host: config.host }, 'Starting Cortex server');

  // 2. Initialize database
  initDatabase(config.storage.dbPath);

  // 3. Create app
  const cortex = new CortexApp(config);
  await cortex.initialize();

  // 4. Create Fastify server
  const app = Fastify({
    logger: false,  // We use our own pino logger
  });

  // CORS
  await app.register(cors, {
    origin: config.cors?.origin ?? true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Security middleware
  registerAuthMiddleware(app, config.auth?.token);
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
      decorateReply: false,
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
  app.setErrorHandler((error, req, reply) => {
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
  } catch (err) {
    log.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  // 6. Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await app.close();
    await cortex.shutdown();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
