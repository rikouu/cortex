import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthMiddleware, registerRateLimiting } from '../src/api/security.js';

describe('Security', () => {
  describe('Auth Middleware', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerAuthMiddleware(app, 'test-token-123');
      app.get('/api/v1/health', async () => ({ status: 'ok' }));
      app.get('/api/v1/stats', async () => ({ count: 0 }));
      app.get('/dashboard', async () => 'html');
      await app.ready();
    });

    afterAll(() => app.close());

    it('should allow health check without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
    });

    it('should reject API calls without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/stats' });
      expect(res.statusCode).toBe(401);
    });

    it('should reject API calls with wrong token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('should allow API calls with correct token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/stats',
        headers: { authorization: 'Bearer test-token-123' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('should allow non-API routes without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerRateLimiting(app, { windowMs: 60000, maxRequests: 3 });
      app.get('/api/v1/test', async () => ({ ok: true }));
      await app.ready();
    });

    afterAll(() => app.close());

    it('should allow requests within limit', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/test' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    });

    it('should block requests exceeding limit', async () => {
      // Already used 1, send 2 more to hit limit
      await app.inject({ method: 'GET', url: '/api/v1/test' });
      await app.inject({ method: 'GET', url: '/api/v1/test' });
      const res = await app.inject({ method: 'GET', url: '/api/v1/test' });
      expect(res.statusCode).toBe(429);
    });
  });
});
