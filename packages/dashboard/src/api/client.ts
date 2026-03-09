const BASE = '/api/v1';
const TOKEN_KEY = 'cortex_auth_token';

// ============ Token Management ============

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ============ Auth API (public, no token needed) ============

export async function checkAuth(): Promise<{ authRequired: boolean }> {
  const res = await fetch(`${BASE}/auth/check`);
  if (!res.ok) return { authRequired: false };
  return res.json();
}

export async function verifyToken(token: string): Promise<{ valid: boolean }> {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) return { valid: false };
  return res.json();
}

// ============ Authenticated Request ============

async function request(path: string, opts?: RequestInit) {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...opts?.headers as Record<string, string>,
  };
  if (opts?.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401 || res.status === 403) {
    // Token invalid or expired — clear and trigger re-login
    clearStoredToken();
    window.dispatchEvent(new CustomEvent('cortex:auth-expired'));
    throw new Error(`API ${res.status}: Unauthorized`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

// Health
export const getHealth = (refresh = false) => request(`/health${refresh ? '?refresh=true' : ''}`);
export const getComponentHealth = () => request('/health/components');

// Stats
export const getStats = (agentId?: string) =>
  request(`/stats${agentId ? `?agent_id=${agentId}` : ''}`);

// Memories
export const listMemories = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request(`/memories${qs}`);
};

export const getMemory = (id: string) => request(`/memories/${id}`);

export const getMemoryChain = (id: string) => request(`/memories/${id}/chain`);
export const rollbackMemory = (id: string, targetId: string) =>
  request(`/memories/${id}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_id: targetId }) });

export const createMemory = (data: any) =>
  request('/memories', { method: 'POST', body: JSON.stringify(data) });

export const updateMemory = (id: string, data: any) =>
  request(`/memories/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteMemory = (id: string) =>
  request(`/memories/${id}`, { method: 'DELETE' });

// Search
export const search = (data: any) =>
  request('/search', { method: 'POST', body: JSON.stringify(data) });

// Recall
export const recall = (data: any) =>
  request('/recall', { method: 'POST', body: JSON.stringify(data) });

// Ingest
export const ingest = (data: any) =>
  request('/ingest', { method: 'POST', body: JSON.stringify(data) });

// Relations
export const listRelations = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request(`/relations${qs}`);
};

export const createRelation = (data: any) =>
  request('/relations', { method: 'POST', body: JSON.stringify(data) });

export const deleteRelation = (id: string) =>
  request(`/relations/${id}`, { method: 'DELETE' });

// Lifecycle
export const runLifecycle = (dryRun = false, agentId?: string) =>
  request('/lifecycle/run', { method: 'POST', body: JSON.stringify({ dry_run: dryRun, agent_id: agentId }) });

export const previewLifecycle = (agentId?: string) =>
  request(`/lifecycle/preview${agentId ? `?agent_id=${agentId}` : ''}`);

export const getLifecycleLogs = (limit = 50, agentId?: string, offset = 0) =>
  request(`/lifecycle/log?limit=${limit}&offset=${offset}${agentId ? `&agent_id=${agentId}` : ''}`);

// Config
export const getConfig = () => request('/config');

export const updateConfig = (data: any) =>
  request('/config', { method: 'PATCH', body: JSON.stringify(data) });

// Test connections
export const testLLM = (target: 'extraction' | 'lifecycle') =>
  request('/test-llm', { method: 'POST', body: JSON.stringify({ target }) });

export const testEmbedding = () =>
  request('/test-embedding', { method: 'POST' });

// Export
export const triggerExport = (format: string = 'json') =>
  request('/export', { method: 'POST', body: JSON.stringify({ format }) });

// Import
export const triggerImport = (data: any) =>
  request('/import', { method: 'POST', body: JSON.stringify(data) });

// Reindex
export const triggerReindex = () =>
  request('/reindex', { method: 'POST' });

// Self-update
export const triggerUpdate = () =>
  request('/update', { method: 'POST' });

// Agents
export const listAgents = () => request('/agents');

export const getAgent = (id: string) => request(`/agents/${id}`);

export const createAgent = (data: { id: string; name: string; description?: string; config_override?: any }) =>
  request('/agents', { method: 'POST', body: JSON.stringify(data) });

export const updateAgent = (id: string, data: any) =>
  request(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteAgent = (id: string) =>
  request(`/agents/${id}`, { method: 'DELETE' });

export const getAgentConfig = (id: string) => request(`/agents/${id}/config`);

// Extraction Logs
export const getExtractionLogs = (agentId?: string, opts?: { limit?: number; offset?: number; channel?: string; status?: string; from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (agentId) params.set('agent_id', agentId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  if (opts?.channel) params.set('channel', opts.channel);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  return request(`/extraction-logs?${params}`);
};

// Log Level
export const getLogLevel = () => request('/log-level');
export const setLogLevel = (level: string) =>
  request('/log-level', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level }) });
export const getSystemLogs = (limit = 100, level?: string) => {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (level) params.set('level', level);
  return request(`/logs?${params}`);
};

// Test connections
export const testConnections = () =>
  request('/health/test', { method: 'POST' });

// Search/Recall test
export const testRecall = (query: string, agentId?: string) =>
  request('/recall', { method: 'POST', body: JSON.stringify({ query, agent_id: agentId, limit: 10 }) });
