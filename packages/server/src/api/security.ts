import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { updateConfig } from '../utils/config.js';

const log = createLogger('security');

/** Timing-safe string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen, 0);
  const bufB = Buffer.alloc(maxLen, 0);
  Buffer.from(a).copy(bufA);
  Buffer.from(b).copy(bufB);
  return a.length === b.length && timingSafeEqual(bufA, bufB);
}

/** Check if the active token comes from env var (immutable from Dashboard) */
function isTokenFromEnv(): boolean {
  return !!process.env.CORTEX_AUTH_TOKEN;
}

// ============ Auth Types ============

export interface AgentToken {
  agent_id: string;
  token: string;
}

export interface AuthConfig {
  token?: string;           // Master token (access all agents)
  agents?: AgentToken[];    // Per-agent tokens
}

/** Result of token resolution */
export interface TokenInfo {
  isMaster: boolean;
  agentId?: string;  // Bound agent_id (undefined for master)
}

// ============ Auth Routes ============

export function registerAuthRoutes(app: FastifyInstance, authConfig: AuthConfig): void {
  const hasAuth = !!(authConfig.token || (authConfig.agents && authConfig.agents.length > 0));

  // Public: check if auth is enabled (no token required)
  app.get('/api/v1/auth/check', async () => {
    return { authRequired: hasAuth };
  });

  // Public: auth status — source, setupRequired, etc.
  app.get('/api/v1/auth/status', async () => {
    const hasToken = !!authConfig.token;
    const hasAgents = !!(authConfig.agents && authConfig.agents.length > 0);
    const fromEnv = isTokenFromEnv();

    let source: 'env' | 'config' | 'none' = 'none';
    if (hasToken) {
      source = fromEnv ? 'env' : 'config';
    }

    return {
      authRequired: hasToken || hasAgents,
      setupRequired: !hasToken && !hasAgents,
      source,
      hasAgentTokens: hasAgents,
      agentTokenCount: authConfig.agents?.length ?? 0,
      mutable: !fromEnv,  // Can Dashboard change the token?
    };
  });

  // Public: first-time token setup (only works when no token is set)
  app.post('/api/v1/auth/setup', async (req, reply) => {
    if (authConfig.token) {
      reply.code(409).send({ error: 'Token already configured. Use /api/v1/auth/change-token instead.' });
      return;
    }

    const body = req.body as any;
    const newToken = body?.token;
    if (!newToken || typeof newToken !== 'string' || newToken.length < 8) {
      reply.code(400).send({ error: 'Token must be at least 8 characters.' });
      return;
    }

    // Persist to config file
    authConfig.token = newToken;
    updateConfig({ auth: { token: newToken, agents: authConfig.agents } });
    log.info('Master token configured via setup');

    return { ok: true, message: 'Token configured. Please refresh and log in.' };
  });

  // Authenticated: change existing master token
  app.post('/api/v1/auth/change-token', async (req, reply) => {
    if (isTokenFromEnv()) {
      reply.code(403).send({
        error: 'Token is set via environment variable (CORTEX_AUTH_TOKEN). Change it there and restart.',
      });
      return;
    }

    const body = req.body as any;
    const oldToken = body?.oldToken;
    const newToken = body?.newToken;

    if (!oldToken || !newToken) {
      reply.code(400).send({ error: 'Both oldToken and newToken are required.' });
      return;
    }

    if (typeof newToken !== 'string' || newToken.length < 8) {
      reply.code(400).send({ error: 'New token must be at least 8 characters.' });
      return;
    }

    // Verify old token
    if (!authConfig.token || !safeCompare(oldToken, authConfig.token)) {
      reply.code(403).send({ error: 'Current token is incorrect.' });
      return;
    }

    // Update
    authConfig.token = newToken;
    updateConfig({ auth: { token: newToken, agents: authConfig.agents } });
    log.info('Master token changed via Dashboard');

    return { ok: true, message: 'Token changed. Please log in with the new token.' };
  });

  // Public: verify a token
  app.post('/api/v1/auth/verify', async (req) => {
    if (!hasAuth) {
      return { valid: true, isMaster: true };
    }
    const body = req.body as any;
    const provided = body?.token;
    if (!provided) return { valid: false };

    const info = resolveToken(provided, authConfig);
    if (info) {
      return { valid: true, isMaster: info.isMaster, agentId: info.agentId };
    }
    return { valid: false };
  });
}

// ============ Token Resolution ============

/** Resolve a bearer token to its identity. Returns null if invalid. */
function resolveToken(provided: string, authConfig: AuthConfig): TokenInfo | null {
  // Check master token first
  if (authConfig.token && safeCompare(provided, authConfig.token)) {
    return { isMaster: true };
  }

  // Check agent tokens
  if (authConfig.agents) {
    for (const agentToken of authConfig.agents) {
      if (safeCompare(provided, agentToken.token)) {
        return { isMaster: false, agentId: agentToken.agent_id };
      }
    }
  }

  return null;
}

// ============ Auth Middleware ============

// Extend Fastify request to carry auth info
declare module 'fastify' {
  interface FastifyRequest {
    tokenInfo?: TokenInfo;
  }
}

export function registerAuthMiddleware(app: FastifyInstance, authConfig: AuthConfig): void {
  const hasAuth = !!(authConfig.token || (authConfig.agents && authConfig.agents.length > 0));

  if (!hasAuth) {
    log.info('Auth token not configured, API authentication disabled');
    return;
  }

  const agentCount = authConfig.agents?.length ?? 0;
  log.info({ agentTokens: agentCount }, 'API Bearer token authentication enabled');

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip health check and auth routes (public)
    if (req.url === '/api/v1/health') return;
    if (req.url === '/api/v1/metrics') return;
    if (req.url.startsWith('/api/v1/auth/')) return;
    // Skip non-API routes (dashboard static files)
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/mcp/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' });
      return;
    }

    const provided = authHeader.slice(7);
    const info = resolveToken(provided, authConfig);

    if (!info) {
      log.warn({ ip: req.ip, url: req.url }, 'Invalid auth token');
      reply.code(403).send({ error: 'Forbidden', message: 'Invalid token' });
      return;
    }

    // Attach token info to request for downstream agent_id enforcement
    req.tokenInfo = info;
  });
}

// ============ Agent ID Enforcement ============

/**
 * Register a preHandler hook that enforces agent_id access control.
 * - Master tokens can access any agent_id
 * - Agent tokens can only access their bound agent_id
 * - If agent token and no agent_id in request, auto-inject it
 */
export function registerAgentEnforcement(app: FastifyInstance, authConfig: AuthConfig): void {
  const hasAgentTokens = authConfig.agents && authConfig.agents.length > 0;
  if (!hasAgentTokens && !authConfig.token) return;

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only enforce on API routes
    if (!req.url.startsWith('/api/')) return;
    // Skip auth/health/system routes
    if (req.url.startsWith('/api/v1/auth/')) return;
    if (req.url === '/api/v1/health') return;

    const tokenInfo = req.tokenInfo;
    if (!tokenInfo) return; // No auth configured or public route

    // Master token: no restrictions
    if (tokenInfo.isMaster) return;

    // Agent token: enforce agent_id binding
    const boundAgentId = tokenInfo.agentId;
    if (!boundAgentId) return;

    // Extract agent_id from request body or query
    const body = (req.body as Record<string, unknown>) || {};
    const query = (req.query as Record<string, unknown>) || {};
    const requestAgentId = (body.agent_id as string) || (query.agent_id as string);

    if (requestAgentId) {
      // Verify it matches the bound agent_id
      if (requestAgentId !== boundAgentId) {
        log.warn(
          { ip: req.ip, url: req.url, requested: requestAgentId, bound: boundAgentId },
          'Agent token tried to access unauthorized agent_id',
        );
        reply.code(403).send({
          error: 'Forbidden',
          message: `Token is bound to agent "${boundAgentId}", cannot access agent "${requestAgentId}"`,
        });
        return;
      }
    } else {
      // Auto-inject agent_id for agent tokens
      if (body && typeof body === 'object') {
        (body as any).agent_id = boundAgentId;
      }
    }
  });
}

// ============ Input Size Limits ============

const MAX_MESSAGE_LENGTH = 50_000;
const MAX_CONTENT_LENGTH = 10_000;

export function registerInputLimits(app: FastifyInstance): void {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.body || typeof req.body !== 'object') return;
    const body = req.body as Record<string, unknown>;

    if (typeof body.user_message === 'string' && body.user_message.length > MAX_MESSAGE_LENGTH) {
      reply.code(413).send({
        error: 'Payload Too Large',
        message: `user_message exceeds max length of ${MAX_MESSAGE_LENGTH} characters`,
      });
      return;
    }
    if (typeof body.assistant_message === 'string' && body.assistant_message.length > MAX_MESSAGE_LENGTH) {
      reply.code(413).send({
        error: 'Payload Too Large',
        message: `assistant_message exceeds max length of ${MAX_MESSAGE_LENGTH} characters`,
      });
      return;
    }
    if (typeof body.content === 'string' && body.content.length > MAX_CONTENT_LENGTH) {
      reply.code(413).send({
        error: 'Payload Too Large',
        message: `content exceeds max length of ${MAX_CONTENT_LENGTH} characters`,
      });
      return;
    }
  });
}

// ============ Rate Limiting ============

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createRateLimiter(windowMs: number, maxRequests: number): Map<string, RateLimitEntry> {
  const store = new Map<string, RateLimitEntry>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 300_000);
  if (cleanup.unref) cleanup.unref();
  return store;
}

function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  windowMs: number,
  maxRequests: number,
  reply: FastifyReply,
): boolean {
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
    log.warn({ ip: key, count: entry.count }, 'Rate limit exceeded');
    reply.code(429).send({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil((entry.resetAt - now) / 1000)}s`,
    });
    return true;
  }
  return false;
}

export function registerRateLimiting(
  app: FastifyInstance,
  opts: { windowMs?: number; maxRequests?: number } = {},
): void {
  const windowMs = opts.windowMs || 60_000;
  const maxRequests = opts.maxRequests || 120;
  const globalStore = createRateLimiter(windowMs, maxRequests);

  // Stricter limiter for auth endpoints (10 req/min)
  const authWindowMs = 60_000;
  const authMaxRequests = 10;
  const authStore = createRateLimiter(authWindowMs, authMaxRequests);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith('/api/')) return;

    const key = req.ip;

    // Auth endpoints get a stricter dedicated limit
    if (req.url.startsWith('/api/v1/auth/')) {
      if (checkRateLimit(authStore, key, authWindowMs, authMaxRequests, reply)) return;
      return; // auth endpoints only use the auth limiter
    }

    if (checkRateLimit(globalStore, key, windowMs, maxRequests, reply)) return;
  });
}
