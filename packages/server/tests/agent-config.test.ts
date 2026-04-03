import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from '../src/utils/config.js';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { insertAgent } from '../src/db/agent-queries.js';
import { CortexApp } from '../src/app.js';
import { registerAllRoutes } from '../src/api/router.js';

describe('Agent config + LLM runtime overrides', () => {
  let app: FastifyInstance;
  let cortex: CortexApp;

  beforeAll(async () => {
    const config = loadConfig({
      storage: { dbPath: ':memory:', walMode: false },
      llm: {
        extraction: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'global-primary-key',
          baseUrl: 'https://global.example/v1',
          timeoutMs: 1200,
          fallback: {
            provider: 'openrouter',
            model: 'anthropic/claude-haiku-4-5',
            apiKey: 'global-fallback-key',
            baseUrl: 'https://global-fallback.example/v1',
            timeoutMs: 2400,
          },
          retry: {
            maxRetries: 2,
            baseDelayMs: 200,
          },
        },
        lifecycle: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'global-lifecycle-key',
          baseUrl: 'https://global-lifecycle.example/v1',
          timeoutMs: 900,
          retry: {
            maxRetries: 2,
            baseDelayMs: 200,
          },
        },
      },
      embedding: { provider: 'none', dimensions: 4 },
      vectorBackend: { provider: 'sqlite-vec' },
      markdownExport: { enabled: false, exportMemoryMd: false, debounceMs: 999999 },
    });

    initDatabase(':memory:');
    cortex = new CortexApp(config);
    await cortex.initialize();
    cortex.embeddingProvider = {
      name: 'mock-embedding',
      dimensions: 4,
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3, 0.4]]),
    } as any;

    insertAgent({
      id: 'agent-override',
      name: 'Agent Override',
      config_override: {
        llm: {
          extraction: {
            baseUrl: 'https://override.example/v1',
            timeoutMs: 1500,
            fallback: {
              provider: 'anthropic',
              model: 'claude-haiku-4-5',
              apiKey: 'agent-fallback-key',
              baseUrl: 'https://anthropic.example',
              timeoutMs: 1800,
            },
            retry: {
              maxRetries: 1,
              baseDelayMs: 50,
            },
          },
        },
      },
    });

    app = Fastify();
    await app.register(cors, { origin: true });
    registerAllRoutes(app, cortex);
    await app.ready();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
    await cortex.shutdown();
    closeDatabase();
  });

  it('returns masked fallback + retry fields from /api/v1/config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.llm.extraction.provider).toBe('openai');
    expect(body.llm.extraction.timeoutMs).toBe(1200);
    expect(body.llm.extraction.hasApiKey).toBe(true);
    expect(body.llm.extraction.fallback.provider).toBe('openrouter');
    expect(body.llm.extraction.fallback.hasApiKey).toBe(true);
    expect(body.llm.extraction.retry).toEqual({ maxRetries: 2, baseDelayMs: 200 });
  });

  it('merges and masks nested agent override LLM config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/agents/agent-override/config' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.config.llm.extraction.provider).toBe('openai');
    expect(body.config.llm.extraction.baseUrl).toBe('https://override.example/v1');
    expect(body.config.llm.extraction.timeoutMs).toBe(1500);
    expect(body.config.llm.extraction.hasApiKey).toBe(true);
    expect(body.config.llm.extraction.fallback.provider).toBe('anthropic');
    expect(body.config.llm.extraction.fallback.baseUrl).toBe('https://anthropic.example');
    expect(body.config.llm.extraction.fallback.timeoutMs).toBe(1800);
    expect(body.config.llm.extraction.fallback.hasApiKey).toBe(true);
    expect(body.config.llm.extraction.retry).toEqual({ maxRetries: 1, baseDelayMs: 50 });
  });

  it('uses the agent LLM override on live ingest requests', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!String(url).startsWith('https://override.example/v1/chat/completions')) {
        throw new Error(`Unexpected URL: ${url}`);
      }

      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  memories: [
                    {
                      content: 'User lives in Tokyo',
                      category: 'fact',
                      importance: 0.8,
                      source: 'user_stated',
                      reasoning: 'Directly stated by the user',
                    },
                  ],
                  relations: [],
                  nothing_extracted: false,
                }),
              },
            },
          ],
        }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest',
      payload: {
        agent_id: 'agent-override',
        user_message: 'I live in Tokyo',
        assistant_message: 'Noted.',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.structured_extractions.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://override.example/v1/chat/completions');
  });
});
