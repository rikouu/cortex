import type { FastifyInstance } from 'fastify';
import { listAgents, getAgentById, getAgentStats, insertAgent, updateAgent, deleteAgent } from '../db/agent-queries.js';
import { mergeLLMConfig, preserveLLMApiKeys, sanitizeLLMConfig } from '../llm/config-utils.js';
import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agents');

function deepMerge<T>(target: T, source: any): T {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return (source === undefined ? target : source) as T;
  }

  const result: any = Array.isArray(target) ? [...target] : { ...(target as any) };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = (target as any)?.[key];
    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

export function registerAgentRoutes(app: FastifyInstance): void {
  // List all agents
  app.get('/api/v1/agents', async () => {
    const agents = listAgents();
    return {
      agents: agents.map(a => ({
        ...a,
        config_override: a.config_override ? maskConfigKeys(JSON.parse(a.config_override)) : null,
      })),
    };
  });

  // Get agent by ID
  app.get('/api/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = getAgentById(id);
    if (!agent) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    const stats = getAgentStats(id);
    return {
      ...agent,
      config_override: agent.config_override ? maskConfigKeys(JSON.parse(agent.config_override)) : null,
      stats,
    };
  });

  // Create agent
  app.post('/api/v1/agents', async (req, reply) => {
    const body = req.body as any;
    if (!body.id || !body.name) {
      reply.code(400);
      return { error: 'id and name are required' };
    }

    try {
      const agent = insertAgent({
        id: body.id,
        name: body.name,
        description: body.description,
        config_override: body.config_override,
      });
      reply.code(201);
      return {
        ...agent,
        config_override: agent.config_override ? maskConfigKeys(JSON.parse(agent.config_override)) : null,
      };
    } catch (e: any) {
      const isDuplicate = e.message?.includes('UNIQUE constraint') || e.message?.includes('PRIMARY KEY');
      reply.code(isDuplicate ? 409 : 400);
      return { error: e.message };
    }
  });

  // Update agent
  app.patch('/api/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    // Handle apiKey preservation logic
    if (body.config_override) {
      const existing = getAgentById(id);
      if (existing?.config_override) {
        const existingConfig = JSON.parse(existing.config_override);
        preserveApiKeys(body.config_override, existingConfig);
      }
    }

    const agent = updateAgent(id, body);
    if (!agent) {
      reply.code(404);
      return { error: 'Agent not found' };
    }
    return {
      ...agent,
      config_override: agent.config_override ? maskConfigKeys(JSON.parse(agent.config_override)) : null,
    };
  });

  // Delete agent
  app.delete('/api/v1/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = deleteAgent(id);
      if (!result.deleted) {
        reply.code(404);
        return { error: 'Agent not found' };
      }
      return { ok: true, orphaned_memories: result.orphaned_memories };
    } catch (e: any) {
      reply.code(403);
      return { error: e.message };
    }
  });

  // Get merged effective config for agent
  app.get('/api/v1/agents/:id/config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = getAgentById(id);
    if (!agent) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    const globalConfig = getConfig();
    const override = agent.config_override ? JSON.parse(agent.config_override) : {};
    const effective = deepMerge(globalConfig, override);

    const merged = {
      llm: {
        extraction: sanitizeLLMConfig(mergeLLMConfig(globalConfig.llm.extraction, override.llm?.extraction)),
        lifecycle: sanitizeLLMConfig(mergeLLMConfig(globalConfig.llm.lifecycle, override.llm?.lifecycle)),
      },
      embedding: {
        provider: effective.embedding?.provider,
        model: effective.embedding?.model,
        dimensions: effective.embedding?.dimensions,
        baseUrl: effective.embedding?.baseUrl,
        hasApiKey: !!effective.embedding?.apiKey,
      },
    };

    return { config: merged, has_override: !!agent.config_override };
  });
}

// Mask apiKey fields: replace with hasApiKey boolean
function maskConfigKeys(config: any): any {
  if (!config || typeof config !== 'object') return config;
  const result = { ...config };

  for (const section of ['llm', 'embedding']) {
    if (!result[section]) continue;
    if (section === 'llm') {
      for (const sub of ['extraction', 'lifecycle']) {
        if (result.llm[sub]) {
          result.llm[sub] = sanitizeLLMConfig(result.llm[sub]);
        }
      }
    } else {
      if (result.embedding?.apiKey !== undefined) {
        result.embedding = { ...result.embedding, hasApiKey: !!result.embedding.apiKey };
        delete result.embedding.apiKey;
      }
    }
  }

  return result;
}

// Preserve existing apiKeys when empty string or undefined is sent
function preserveApiKeys(incoming: any, existing: any): void {
  if (!incoming || !existing) return;

  const paths = [
    ['llm', 'extraction'],
    ['llm', 'lifecycle'],
    ['embedding'],
  ];

  for (const path of paths) {
    let inRef = incoming;
    let exRef = existing;
    for (const key of path) {
      if (!inRef?.[key] || !exRef?.[key]) { inRef = null; exRef = null; break; }
      inRef = inRef[key];
      exRef = exRef[key];
    }
    if (inRef && exRef) {
      if (path[0] === 'llm') {
        preserveLLMApiKeys(inRef, exRef);
      } else if (inRef.apiKey === undefined && exRef.apiKey) {
        inRef.apiKey = exRef.apiKey;
      }
    }
  }
}
