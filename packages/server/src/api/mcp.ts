import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { MCPServer, type MCPServerDeps } from '../mcp/server.js';
import { insertMemory, updateMemory, deleteMemory, getMemoryById, getStats, ensureAgent, listRelations, type MemoryCategory } from '../db/index.js';
import { insertExtractionLog } from '../core/extraction-log.js';

const VALID_MCP_CATEGORIES = new Set<string>([
  'identity', 'preference', 'decision', 'fact', 'entity',
  'correction', 'todo', 'skill', 'relationship', 'goal',
  'insight', 'project_state',
  'constraint', 'policy',
  'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona',
]);

export function registerMCPRoutes(app: FastifyInstance, cortex: CortexApp): void {
  const deps: MCPServerDeps = {
    recall: async (query, agentId, maxResults) => {
      const result = await cortex.gate.recall({
        query,
        agent_id: agentId || 'mcp',
      });
      const memories = result.memories.slice(0, maxResults || 5);
      return { context: result.context, memories, meta: result.meta };
    },

    remember: async (content, category, importance, agentId) => {
      const start = Date.now();
      const validCategory = (category && VALID_MCP_CATEGORIES.has(category) ? category : 'fact') as MemoryCategory;
      const aid = agentId || 'mcp';
      ensureAgent(aid);

      let resultStatus = 'remembered';
      let deduped = 0;
      let resultMem: any;

      // Dedup: check for similar existing memories across ALL agents (cross-agent dedup)
      try {
        const embedding = await cortex.embeddingProvider.embed(content);
        if (embedding.length > 0) {
          const similar = await cortex.vectorBackend.search(embedding, 3, {});
          // Find first valid match (not superseded, not pinned)
          const { exactDupThreshold, similarityThreshold } = cortex.config.sieve;
          for (const hit of similar) {
            const existing = getMemoryById(hit.id);
            if (!existing || existing.superseded_by || existing.is_pinned) continue;

            if (hit.distance < exactDupThreshold) {
              // Exact duplicate — bump importance and return existing
              updateMemory(existing.id, {
                importance: Math.max(existing.importance, importance ?? 0.7),
                confidence: Math.min(existing.confidence + 0.05, 1.0),
              });
              deduped = 1;
              resultStatus = 'already_exists';
              resultMem = { id: existing.id, status: 'already_exists', memory: existing };
              break;
            } else if (hit.distance < similarityThreshold) {
              // Similar — supersede old, insert new (explicit user intent = always replace)
              const mem = insertMemory({
                layer: 'core',
                category: validCategory,
                content,
                importance: importance ?? 0.7,
                confidence: 0.9,
                agent_id: aid,
                source: 'mcp:remember',
                metadata: JSON.stringify({ supersedes: existing.id, smart_update_type: 'replace' }),
              });
              updateMemory(existing.id, { superseded_by: mem.id });
              await cortex.vectorBackend.upsert(mem.id, embedding);
              resultStatus = 'replaced';
              resultMem = { id: mem.id, status: 'remembered', memory: mem };
              break;
            }
            break; // Beyond similarity threshold, no need to check further
          }

          if (!resultMem) {
            // No similar memory found — normal insert
            const mem = insertMemory({
              layer: 'core',
              category: validCategory,
              content,
              importance: importance ?? 0.7,
              confidence: 0.9,
              agent_id: aid,
              source: 'mcp:remember',
            });
            await cortex.vectorBackend.upsert(mem.id, embedding);
            resultMem = { id: mem.id, status: 'remembered', memory: mem };
          }
        }
      } catch { /* best effort — fall through to simple insert */ }

      if (!resultMem) {
        // Fallback: simple insert without dedup (embedding failed)
        const mem = insertMemory({
          layer: 'core',
          category: validCategory,
          content,
          importance: importance ?? 0.7,
          confidence: 0.9,
          agent_id: aid,
          source: 'mcp:remember',
        });
        resultMem = { id: mem.id, status: 'remembered', memory: mem };
      }

      // Write extraction log for MCP remember
      if (cortex.config.sieve.extractionLogging) {
        insertExtractionLog(aid, undefined, {
          channel: 'mcp',
          exchange_preview: content.slice(0, 200),
          raw_output: JSON.stringify({ content, category: validCategory, importance: importance ?? 0.7, status: resultStatus }),
          parsed_memories: [{ content, category: validCategory, importance: importance ?? 0.7, source: 'user_stated' as const, reasoning: 'mcp:remember' }],
          memories_written: deduped > 0 ? 0 : 1,
          memories_deduped: deduped,
          memories_smart_updated: resultStatus === 'replaced' ? 1 : 0,
          latency_ms: Date.now() - start,
        });
      }

      return resultMem;
    },

    forget: async (memoryId, reason) => {
      const existing = getMemoryById(memoryId);
      if (!existing) return { status: 'not_found', id: memoryId };

      deleteMemory(memoryId);
      try { await cortex.vectorBackend.delete([memoryId]); } catch { /* best effort */ }

      return { status: 'forgotten', id: memoryId, reason };
    },

    search: async (query, debug) => {
      return cortex.searchEngine.search({ query, debug, limit: 10 });
    },

    stats: async () => {
      return getStats();
    },

    listRelations: async (subject, object, limit) => {
      return listRelations({ subject, object, limit: limit || 20, agent_id: 'mcp' });
    },
  };

  const mcpServer = new MCPServer(deps);

  // SSE endpoint for MCP over HTTP
  app.get('/mcp/sse', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send server info
    reply.raw.write(`data: ${JSON.stringify({ type: 'server_info', name: 'cortex', version: '0.1.0' })}\n\n`);

    // Send tools list
    reply.raw.write(`data: ${JSON.stringify({ type: 'tools', tools: mcpServer.getTools() })}\n\n`);

    // Keep alive
    const interval = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 15000);

    req.raw.on('close', () => clearInterval(interval));
  });

  // JSON-RPC endpoint for MCP tool calls
  app.post('/mcp/message', async (req) => {
    const msg = req.body as any;
    return mcpServer.handleMessage(msg);
  });

  // MCP tools list
  app.get('/mcp/tools', async () => {
    return { tools: mcpServer.getTools() };
  });
}
