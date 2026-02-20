import type { FastifyInstance } from 'fastify';
import type { CortexApp } from '../app.js';
import { MCPServer, type MCPServerDeps } from '../mcp/server.js';
import { insertMemory, deleteMemory, getMemoryById, getStats, type MemoryCategory } from '../db/index.js';

const VALID_MCP_CATEGORIES = new Set<string>([
  'identity', 'preference', 'decision', 'fact', 'entity',
  'correction', 'todo', 'skill', 'relationship', 'goal',
  'insight', 'project_state',
]);

export function registerMCPRoutes(app: FastifyInstance, cortex: CortexApp): void {
  const deps: MCPServerDeps = {
    recall: async (query, agentId, maxResults) => {
      const result = await cortex.gate.recall({
        query,
        agent_id: agentId || 'mcp',
        max_tokens: 2000,
      });
      const memories = result.memories.slice(0, maxResults || 5);
      return { context: result.context, memories, meta: result.meta };
    },

    remember: async (content, category, importance, agentId) => {
      const validCategory = (category && VALID_MCP_CATEGORIES.has(category) ? category : 'fact') as MemoryCategory;
      const mem = insertMemory({
        layer: 'core',
        category: validCategory,
        content,
        importance: importance ?? 0.7,
        confidence: 0.9,
        agent_id: agentId || 'mcp',
        source: 'mcp:remember',
      });

      // Index vector
      try {
        const embedding = await cortex.embeddingProvider.embed(content);
        if (embedding.length > 0) {
          await cortex.vectorBackend.upsert(mem.id, embedding);
        }
      } catch { /* best effort */ }

      return { id: mem.id, status: 'remembered', memory: mem };
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
