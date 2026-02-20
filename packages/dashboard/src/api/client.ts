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
export const getHealth = () => request('/health');

// Stats
export const getStats = (agentId?: string) =>
  request(`/stats${agentId ? `?agent_id=${agentId}` : ''}`);

// Memories
export const listMemories = (params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request(`/memories${qs}`);
};

export const getMemory = (id: string) => request(`/memories/${id}`);

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
export const runLifecycle = (dryRun = false) =>
  request('/lifecycle/run', { method: 'POST', body: JSON.stringify({ dry_run: dryRun }) });

export const previewLifecycle = () => request('/lifecycle/preview');

export const getLifecycleLogs = (limit = 50) =>
  request(`/lifecycle/log?limit=${limit}`);

// Config
export const getConfig = () => request('/config');

export const updateConfig = (data: any) =>
  request('/config', { method: 'PATCH', body: JSON.stringify(data) });

// Export
export const triggerExport = (format: string = 'json') =>
  request('/export', { method: 'POST', body: JSON.stringify({ format }) });

// Import
export const triggerImport = (data: any) =>
  request('/import', { method: 'POST', body: JSON.stringify(data) });

// Reindex
export const triggerReindex = () =>
  request('/reindex', { method: 'POST' });

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
export const getExtractionLogs = (agentId: string, opts?: { limit?: number; channel?: string }) => {
  const params = new URLSearchParams({ agent_id: agentId });
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.channel) params.set('channel', opts.channel);
  return request(`/extraction-logs?${params}`);
};
