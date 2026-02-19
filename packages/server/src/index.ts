import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, createLogger } from './utils/index.js';
import { initDatabase, closeDatabase } from './db/index.js';
import { CortexApp } from './app.js';
import { registerAllRoutes } from './api/router.js';

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
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Register routes
  registerAllRoutes(app, cortex);

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
