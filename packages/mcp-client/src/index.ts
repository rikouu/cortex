#!/usr/bin/env node
/**
 * Cortex MCP Client — stdio adapter for Claude Desktop / Cursor.
 * Bridges stdio JSON-RPC to Cortex Server HTTP API.
 *
 * Usage in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "cortex": {
 *       "command": "npx",
 *       "args": ["@cortexmem/mcp", "--server-url", "http://localhost:21100"],
 *       "env": { "CORTEX_AGENT_ID": "your-agent-id" }
 *     }
 *   }
 * }
 *
 * CLI flags: --server-url <url>  --agent-id <id>  --auth-token <token>
 * Env vars:  CORTEX_URL          CORTEX_AGENT_ID   CORTEX_AUTH_TOKEN
 */

const CORTEX_URL = process.argv.includes('--server-url')
  ? process.argv[process.argv.indexOf('--server-url') + 1] || 'http://localhost:21100'
  : process.env.CORTEX_URL || 'http://localhost:21100';

// Agent ID: CLI flag is static, but env var is re-read per request
// to support dynamic agent switching (e.g. multi-agent orchestrators)
const CORTEX_AGENT_ID_FLAG = process.argv.includes('--agent-id')
  ? process.argv[process.argv.indexOf('--agent-id') + 1]
  : '';
function getAgentId(): string {
  return CORTEX_AGENT_ID_FLAG || process.env.CORTEX_AGENT_ID || '';
}

const CORTEX_AUTH_TOKEN = process.argv.includes('--auth-token')
  ? process.argv[process.argv.indexOf('--auth-token') + 1]
  : process.env.CORTEX_AUTH_TOKEN || '';

async function forwardToServer(msg: any): Promise<any> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const agentId = getAgentId();
    if (agentId) headers['x-agent-id'] = agentId;
    if (CORTEX_AUTH_TOKEN) headers['Authorization'] = `Bearer ${CORTEX_AUTH_TOKEN}`;

    const res = await fetch(`${CORTEX_URL}/mcp/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: `Server error: ${res.status}` },
      };
    }

    return await res.json();
  } catch (e: any) {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: `Connection failed: ${e.message}` },
    };
  }
}

// stdio transport
let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', async (chunk: string) => {
  buffer += chunk;

  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed);
      const response = await forwardToServer(msg);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch {
      // Skip invalid JSON
    }
  }
});

process.stderr.write(`Cortex MCP Client connected to ${CORTEX_URL}\n`);
