import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../utils/logger.js';

const log = createLogger('security');

// ============ Auth Middleware ============

export function registerAuthMiddleware(app: FastifyInstance, token?: string): void {
  if (!token) {
    log.info('Auth token not configured, API authentication disabled');
    return;
  }

  log.info('API Bearer token authentication enabled');

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip health check
    if (req.url === '/api/v1/health') return;
    // Skip non-API routes (dashboard)
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/mcp/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' });
      return;
    }

    const provided = authHeader.slice(7);
    if (provided !== token) {
      log.warn({ ip: req.ip, url: req.url }, 'Invalid auth token');
      reply.code(403).send({ error: 'Forbidden', message: 'Invalid token' });
      return;
    }
  });
}

// ============ Rate Limiting ============

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function registerRateLimiting(
  app: FastifyInstance,
  opts: { windowMs?: number; maxRequests?: number } = {},
): void {
  const windowMs = opts.windowMs || 60_000; // 1 minute
  const maxRequests = opts.maxRequests || 120; // 120 req/min
  const store = new Map<string, RateLimitEntry>();

  // Cleanup stale entries every 5 minutes
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 300_000);

  // Ensure cleanup doesn't prevent process exit
  if (cleanup.unref) cleanup.unref();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only rate-limit API routes
    if (!req.url.startsWith('/api/')) return;

    const key = req.ip;
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    reply.header('X-RateLimit-Limit', maxRequests);
    reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      log.warn({ ip: req.ip, count: entry.count }, 'Rate limit exceeded');
      reply.code(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s`,
      });
      return;
    }
  });
}
