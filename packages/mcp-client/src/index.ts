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
 *       "args": ["cortex-mcp", "--server-url", "http://localhost:21100"]
 *     }
 *   }
 * }
 */

const CORTEX_URL = process.argv.includes('--server-url')
  ? process.argv[process.argv.indexOf('--server-url') + 1] || 'http://localhost:21100'
  : process.env.CORTEX_URL || 'http://localhost:21100';

async function forwardToServer(msg: any): Promise<any> {
  try {
    const res = await fetch(`${CORTEX_URL}/mcp/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
