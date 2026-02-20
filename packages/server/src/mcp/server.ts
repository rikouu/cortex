/**
 * Cortex MCP Server — exposes memory tools via Model Context Protocol.
 * Can run as stdio transport (Claude Desktop) or SSE transport (remote).
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('mcp');

// MCP protocol types (simplified inline to avoid dependency)
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface MCPToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface MCPServerDeps {
  recall: (query: string, agentId?: string, maxResults?: number) => Promise<any>;
  remember: (content: string, category?: string, importance?: number, agentId?: string) => Promise<any>;
  forget: (memoryId: string, reason?: string) => Promise<any>;
  search: (query: string, debug?: boolean) => Promise<any>;
  stats: () => Promise<any>;
}

const TOOLS: MCPTool[] = [
  {
    name: 'cortex_recall',
    description: 'Search memory for relevant context including user facts, preferences, constraints, agent observations, and persona. Results are priority-ranked: constraints and agent persona are injected first.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        max_results: { type: 'number', description: 'Maximum results to return', default: 5 },
        agent_id: { type: 'string', description: 'Agent identifier', default: 'mcp' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_remember',
    description: 'Store a memory: user facts/preferences, constraints (hard rules), policies (strategies), or agent self-observations (improvement, user habits, relationship, persona)',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember' },
        category: {
          type: 'string',
          enum: [
            'identity', 'preference', 'decision', 'fact', 'entity',
            'correction', 'todo', 'skill', 'relationship', 'goal',
            'insight', 'project_state',
            'constraint', 'policy',
            'agent_self_improvement', 'agent_user_habit', 'agent_relationship', 'agent_persona',
          ],
          description: 'Memory category',
          default: 'fact',
        },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'How important (0-1)', default: 0.7 },
        agent_id: { type: 'string', default: 'mcp' },
      },
      required: ['content'],
    },
  },
  {
    name: 'cortex_forget',
    description: 'Remove or correct a memory',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'ID of the memory to remove' },
        reason: { type: 'string', description: 'Why this memory should be removed' },
      },
      required: ['memory_id'],
    },
  },
  {
    name: 'cortex_search_debug',
    description: 'Debug search results with full scoring details',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_stats',
    description: 'Get memory statistics (total count, layer distribution, etc)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export class MCPServer {
  private deps: MCPServerDeps;

  constructor(deps: MCPServerDeps) {
    this.deps = deps;
  }

  getTools(): MCPTool[] {
    return TOOLS;
  }

  async handleToolCall(call: MCPToolCall): Promise<MCPToolResult> {
    try {
      switch (call.name) {
        case 'cortex_recall': {
          const result = await this.deps.recall(
            call.arguments.query,
            call.arguments.agent_id,
            call.arguments.max_results,
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'cortex_remember': {
          const result = await this.deps.remember(
            call.arguments.content,
            call.arguments.category,
            call.arguments.importance,
            call.arguments.agent_id,
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'cortex_forget': {
          const result = await this.deps.forget(call.arguments.memory_id, call.arguments.reason);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'cortex_search_debug': {
          const result = await this.deps.search(call.arguments.query, true);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'cortex_stats': {
          const result = await this.deps.stats();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${call.name}` }], isError: true };
      }
    } catch (e: any) {
      log.error({ tool: call.name, error: e.message }, 'MCP tool call failed');
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }

  /**
   * Handle JSON-RPC messages (for stdio transport).
   */
  async handleMessage(msg: any): Promise<any> {
    switch (msg.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'cortex', version: '0.1.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: { tools: this.getTools() },
        };

      case 'tools/call':
        const result = await this.handleToolCall({
          name: msg.params.name,
          arguments: msg.params.arguments || {},
        });
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result,
        };

      case 'notifications/initialized':
        return null; // No response needed

      default:
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        };
    }
  }

  /**
   * Run as stdio transport (for Claude Desktop / Cursor).
   */
  async runStdio(): Promise<void> {
    log.info('MCP Server running on stdio');

    let buffer = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;

      // Parse JSON-RPC messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg = JSON.parse(trimmed);
          const response = await this.handleMessage(msg);
          if (response) {
            process.stdout.write(JSON.stringify(response) + '\n');
          }
        } catch (e: any) {
          log.error({ error: e.message }, 'Failed to parse MCP message');
        }
      }
    });
  }
}
