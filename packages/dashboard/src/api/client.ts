const BASE = '/api/v1';

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
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
