import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAgent, updateAgent, deleteAgent, getAgentConfig } from '../api/client.js';

// ─── Provider & Model Presets (shared with Settings) ─────────────────────────

interface ProviderPreset {
  label: string;
  defaultBaseUrl: string;
  models: string[];
  envKey: string;
}

const LLM_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'o1', 'o1-mini', 'o1-pro', 'o3', 'o3-mini', 'o4-mini'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    envKey: 'GOOGLE_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4-5', 'anthropic/claude-haiku-4-5', 'openai/gpt-4o', 'openai/gpt-4o-mini', 'google/gemini-2.5-pro', 'google/gemini-2.0-flash', 'deepseek/deepseek-chat-v3', 'deepseek/deepseek-r1', 'meta-llama/llama-4-maverick', 'qwen/qwen3-235b-a22b'],
    envKey: 'OPENROUTER_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: ['qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5:14b', 'llama3.2:3b', 'llama3.2:8b', 'mistral:7b', 'mistral-nemo:12b', 'deepseek-r1:7b', 'deepseek-r1:14b', 'gemma2:9b', 'phi3:14b'],
    envKey: '',
  },
  none: { label: 'Disabled', defaultBaseUrl: '', models: [], envKey: '' },
};

const EMBEDDING_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    envKey: 'OPENAI_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['text-embedding-004', 'embedding-001'],
    envKey: 'GOOGLE_API_KEY',
  },
  voyage: {
    label: 'Voyage AI',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    models: ['voyage-3', 'voyage-3-lite', 'voyage-code-3'],
    envKey: 'VOYAGE_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: ['bge-m3', 'nomic-embed-text', 'mxbai-embed-large', 'all-minilm'],
    envKey: '',
  },
  none: { label: 'Disabled', defaultBaseUrl: '', models: [], envKey: '' },
};

const CUSTOM_MODEL = '__custom__';

type TabKey = 'overview' | 'config' | 'integration';

// ─── CodeSnippet ─────────────────────────────────────────────────────────────

function CodeSnippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="json-debug" style={{ margin: 0 }}>{code}</pre>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<any>(null);
  const [mergedConfig, setMergedConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('overview');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Overview editing
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ name: '', description: '' });

  // Config editing
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<any>({});

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [agentData, configData] = await Promise.all([getAgent(id), getAgentConfig(id)]);
      setAgent(agentData);
      setMergedConfig(configData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // ─── Overview handlers ─────────────────────────────────────────────────────

  const startEditInfo = () => {
    setInfoDraft({ name: agent.name, description: agent.description || '' });
    setEditingInfo(true);
  };

  const saveInfo = async () => {
    try {
      const updated = await updateAgent(id!, { name: infoDraft.name, description: infoDraft.description || null });
      setAgent((prev: any) => ({ ...prev, ...updated }));
      setEditingInfo(false);
      setToast({ message: 'Agent updated', type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone. Memories created by this agent will become orphaned.`)) return;
    try {
      await deleteAgent(id!);
      navigate('/agents');
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  // ─── Config handlers ──────────────────────────────────────────────────────

  const startEditConfig = () => {
    const override = agent.config_override || {};
    const mc = mergedConfig?.config || {};

    const buildDraft = (section: string, mc: any, override: any, providerMap: Record<string, ProviderPreset>) => {
      const provider = override?.provider ?? mc?.provider ?? 'openai';
      const model = override?.model ?? mc?.model ?? '';
      const preset = providerMap[provider];
      const isCustom = model && !(preset?.models ?? []).includes(model);

      return {
        provider,
        model,
        customModel: isCustom ? model : '',
        useCustomModel: isCustom,
        apiKey: '',
        baseUrl: override?.baseUrl ?? '',
        hasApiKey: mc?.hasApiKey ?? false,
        isOverridden: !!override?.provider || !!override?.model,
        ...(section === 'embedding' ? { dimensions: override?.dimensions ?? mc?.dimensions ?? 1536 } : {}),
      };
    };

    setConfigDraft({
      extraction: buildDraft('extraction', mc.llm?.extraction, override.llm?.extraction, LLM_PROVIDERS),
      lifecycle: buildDraft('lifecycle', mc.llm?.lifecycle, override.llm?.lifecycle, LLM_PROVIDERS),
      embedding: buildDraft('embedding', mc.embedding, override.embedding, EMBEDDING_PROVIDERS),
    });
    setEditingConfig(true);
  };

  const updateDraft = (path: string, value: any) => {
    setConfigDraft((prev: any) => {
      const keys = path.split('.');
      const next = JSON.parse(JSON.stringify(prev));
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]!];
      obj[keys[keys.length - 1]!] = value;
      return next;
    });
  };

  const saveConfig = async () => {
    try {
      const buildPayload = (d: any) => {
        const out: any = { provider: d.provider, model: d.useCustomModel ? d.customModel : d.model };
        if (d.apiKey) out.apiKey = d.apiKey;
        if (d.baseUrl) out.baseUrl = d.baseUrl;
        return out;
      };

      const config_override: any = {
        llm: {
          extraction: buildPayload(configDraft.extraction),
          lifecycle: buildPayload(configDraft.lifecycle),
        },
        embedding: {
          ...buildPayload(configDraft.embedding),
          dimensions: Number(configDraft.embedding.dimensions),
        },
      };

      const updated = await updateAgent(id!, { config_override });
      setAgent((prev: any) => ({ ...prev, ...updated }));
      const configData = await getAgentConfig(id!);
      setMergedConfig(configData);
      setEditingConfig(false);
      setToast({ message: 'Configuration saved', type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const resetConfig = async () => {
    if (!confirm('Reset to global configuration? This will remove all config overrides for this agent.')) return;
    try {
      const updated = await updateAgent(id!, { config_override: null });
      setAgent((prev: any) => ({ ...prev, ...updated }));
      const configData = await getAgentConfig(id!);
      setMergedConfig(configData);
      setEditingConfig(false);
      setToast({ message: 'Configuration reset to global', type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  // ─── Provider block renderer ───────────────────────────────────────────────

  const renderProviderBlock = (title: string, prefix: string, providerMap: Record<string, ProviderPreset>) => {
    const keys = prefix.split('.');
    let d: any = configDraft;
    for (const k of keys) d = d?.[k];
    if (!d) return null;

    const provider = d.provider ?? 'openai';
    const preset = providerMap[provider];
    const models = preset?.models ?? [];
    const isCustomModel = d.useCustomModel;
    const isDisabled = provider === 'none';

    const handleProviderChange = (newProvider: string) => {
      updateDraft(`${prefix}.provider`, newProvider);
      const newPreset = providerMap[newProvider];
      updateDraft(`${prefix}.model`, newPreset?.models?.[0] ?? '');
      updateDraft(`${prefix}.useCustomModel`, false);
      updateDraft(`${prefix}.customModel`, '');
      updateDraft(`${prefix}.baseUrl`, '');
    };

    const handleModelSelectChange = (val: string) => {
      if (val === CUSTOM_MODEL) {
        updateDraft(`${prefix}.useCustomModel`, true);
        updateDraft(`${prefix}.customModel`, d.model ?? '');
      } else {
        updateDraft(`${prefix}.useCustomModel`, false);
        updateDraft(`${prefix}.model`, val);
      }
    };

    return (
      <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          {title}
        </div>

        <div className="form-group">
          <label>Provider</label>
          <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
            {Object.entries(providerMap).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>

        {!isDisabled && (
          <>
            <div className="form-group">
              <label>Model</label>
              {models.length > 0 ? (
                <>
                  <select
                    value={isCustomModel ? CUSTOM_MODEL : (d.model ?? '')}
                    onChange={e => handleModelSelectChange(e.target.value)}
                  >
                    {models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                    <option value={CUSTOM_MODEL}>Custom...</option>
                  </select>
                  {isCustomModel && (
                    <input
                      type="text"
                      value={d.customModel ?? ''}
                      placeholder="Enter custom model name"
                      style={{ marginTop: 8 }}
                      onChange={e => updateDraft(`${prefix}.customModel`, e.target.value)}
                    />
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={d.customModel ?? d.model ?? ''}
                  placeholder="Enter model name"
                  onChange={e => {
                    updateDraft(`${prefix}.model`, e.target.value);
                    updateDraft(`${prefix}.customModel`, e.target.value);
                  }}
                />
              )}
            </div>

            {d.dimensions !== undefined && (
              <div className="form-group">
                <label>Dimensions</label>
                <input
                  type="number"
                  value={d.dimensions ?? ''}
                  onChange={e => updateDraft(`${prefix}.dimensions`, e.target.value)}
                />
              </div>
            )}

            {preset?.envKey && (
              <div className="form-group">
                <label>
                  API Key
                  {d.hasApiKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--success)' }}>configured</span>}
                  {!d.hasApiKey && preset.envKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>env: {preset.envKey}</span>}
                </label>
                <input
                  type="password"
                  value={d.apiKey ?? ''}
                  placeholder={d.hasApiKey ? 'Leave empty to keep current key' : `Enter ${preset.envKey} or leave empty to use env`}
                  onChange={e => updateDraft(`${prefix}.apiKey`, e.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label>
                Base URL
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>optional</span>
              </label>
              <input
                type="text"
                value={d.baseUrl ?? ''}
                placeholder={preset?.defaultBaseUrl || 'Default'}
                onChange={e => updateDraft(`${prefix}.baseUrl`, e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  // ─── Integration code snippets ─────────────────────────────────────────────

  const renderIntegration = () => {
    const cortexUrl = window.location.origin;
    const agentId = id!;

    return (
      <div>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
          Use the code snippets below to integrate this agent with your applications.
          Variables <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>CORTEX_URL</code> and
          <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4, marginLeft: 4 }}>AGENT_ID</code> are pre-filled for this agent.
        </p>

        <CodeSnippet
          title="cURL — Ingest (Store Memory)"
          code={`curl -X POST ${cortexUrl}/api/v1/ingest \\
  -H "Content-Type: application/json" \\
  -d '{"user_message":"...","assistant_message":"...","agent_id":"${agentId}"}'`}
        />

        <CodeSnippet
          title="cURL — Recall (Retrieve Memory)"
          code={`curl -X POST ${cortexUrl}/api/v1/recall \\
  -H "Content-Type: application/json" \\
  -d '{"query":"What are the user preferences?","agent_id":"${agentId}"}'`}
        />

        <CodeSnippet
          title="JavaScript / TypeScript"
          code={`const CORTEX_URL = '${cortexUrl}';
const AGENT_ID = '${agentId}';

async function recall(query: string) {
  const res = await fetch(\`\${CORTEX_URL}/api/v1/recall\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, agent_id: AGENT_ID }),
  });
  return res.json();
}

async function ingest(userMessage: string, assistantMessage: string) {
  const res = await fetch(\`\${CORTEX_URL}/api/v1/ingest\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_message: userMessage, assistant_message: assistantMessage, agent_id: AGENT_ID }),
  });
  return res.json();
}`}
        />

        <CodeSnippet
          title="Python"
          code={`import requests
CORTEX_URL = "${cortexUrl}"
AGENT_ID = "${agentId}"

def recall(query: str):
    return requests.post(f"{CORTEX_URL}/api/v1/recall",
        json={"query": query, "agent_id": AGENT_ID}).json()

def ingest(user_msg: str, assistant_msg: str):
    return requests.post(f"{CORTEX_URL}/api/v1/ingest",
        json={"user_message": user_msg, "assistant_message": assistant_msg, "agent_id": AGENT_ID}).json()`}
        />

        <CodeSnippet
          title="MCP Configuration (Claude Desktop / Cursor)"
          code={JSON.stringify({
            mcpServers: {
              cortex: {
                command: 'npx',
                args: ['cortex-mcp'],
                env: {
                  CORTEX_URL: cortexUrl,
                  CORTEX_AGENT_ID: agentId,
                },
              },
            },
          }, null, 2)}
        />

        <CodeSnippet
          title="Direct Storage (REST API)"
          code={`curl -X POST ${cortexUrl}/api/v1/memories \\
  -H "Content-Type: application/json" \\
  -d '{"layer":"core","category":"fact","content":"...","agent_id":"${agentId}","importance":0.8}'`}
        />
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>;
  if (loading) return <div className="loading">Loading...</div>;
  if (!agent) return <div className="card" style={{ color: 'var(--danger)' }}>Agent not found</div>;

  const isBuiltIn = agent.id === 'default' || agent.id === 'mcp';
  const stats = agent.stats || { layers: {}, total: 0 };
  const mc = mergedConfig?.config;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 200,
          padding: '12px 20px', borderRadius: 'var(--radius)',
          background: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
          color: '#fff', fontSize: 14, fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="btn" onClick={() => navigate('/agents')} style={{ padding: '4px 10px', fontSize: 13 }}>
          &larr; Agents
        </button>
        <h1 className="page-title" style={{ margin: 0 }}>{agent.name}</h1>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{agent.id}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {(['overview', 'config', 'integration'] as TabKey[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', fontSize: 14, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
              color: tab === t ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === 'overview' ? 'Overview' : t === 'config' ? 'Configuration' : 'Integration'}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Basic Info</h3>
              {editingInfo ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setEditingInfo(false)}>Cancel</button>
                  <button className="btn primary" onClick={saveInfo}>Save</button>
                </div>
              ) : (
                <button className="btn" onClick={startEditInfo}>Edit</button>
              )}
            </div>

            {editingInfo ? (
              <>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={infoDraft.name} onChange={e => setInfoDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    value={infoDraft.description}
                    rows={3}
                    style={{ width: '100%', resize: 'vertical' }}
                    onChange={e => setInfoDraft(d => ({ ...d, description: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <table>
                <tbody>
                  <tr><td style={{ width: '30%' }}>Name</td><td>{agent.name}</td></tr>
                  <tr><td>Description</td><td>{agent.description || <span style={{ color: 'var(--text-muted)' }}>No description</span>}</td></tr>
                  <tr><td>Created</td><td>{new Date(agent.created_at).toLocaleString()}</td></tr>
                  <tr><td>Updated</td><td>{new Date(agent.updated_at).toLocaleString()}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Memory Stats */}
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Memory Statistics</h3>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
              {stats.total} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>total memories</span>
            </div>

            {stats.total > 0 && (
              <>
                {/* Layer bar */}
                <div style={{ display: 'flex', height: 24, borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 }}>
                  {(['working', 'core', 'archive'] as const).map(layer => {
                    const count = stats.layers[layer] || 0;
                    const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                    if (pct === 0) return null;
                    const colors: Record<string, string> = { working: '#f59e0b', core: '#3b82f6', archive: '#6b7280' };
                    return (
                      <div
                        key={layer}
                        title={`${layer}: ${count}`}
                        style={{ width: `${pct}%`, background: colors[layer], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 500 }}
                      >
                        {pct > 10 ? `${layer} (${count})` : ''}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                  {(['working', 'core', 'archive'] as const).map(layer => (
                    <div key={layer} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: layer === 'working' ? '#f59e0b' : layer === 'core' ? '#3b82f6' : '#6b7280' }} />
                      <span>{layer}: {stats.layers[layer] || 0}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Config summary */}
          {mc && (
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Active Configuration</h3>
              {mergedConfig?.has_override && (
                <div style={{ marginBottom: 12 }}>
                  <span className="badge" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc' }}>Custom Config Active</span>
                </div>
              )}
              <table>
                <tbody>
                  <tr><td style={{ width: '30%' }}>Extraction LLM</td><td>{mc.llm?.extraction?.provider} / {mc.llm?.extraction?.model}</td></tr>
                  <tr><td>Lifecycle LLM</td><td>{mc.llm?.lifecycle?.provider} / {mc.llm?.lifecycle?.model}</td></tr>
                  <tr><td>Embedding</td><td>{mc.embedding?.provider} / {mc.embedding?.model}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Delete */}
          {!isBuiltIn && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <h3 style={{ marginBottom: 8, color: 'var(--danger)' }}>Danger Zone</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Deleting this agent will remove its configuration. Memories created by this agent will not be deleted but will become orphaned.
              </p>
              <button className="btn" style={{ background: 'var(--danger)', color: '#fff', border: 'none' }} onClick={handleDelete}>
                Delete Agent
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Configuration */}
      {tab === 'config' && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Configuration Override</h3>
              {editingConfig ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={resetConfig}>Reset to Global</button>
                  <button className="btn" onClick={() => setEditingConfig(false)}>Cancel</button>
                  <button className="btn primary" onClick={saveConfig}>Save</button>
                </div>
              ) : (
                <button className="btn" onClick={startEditConfig}>Edit</button>
              )}
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Override global configuration for this agent. Fields not set will fall back to global settings.
            </p>

            {editingConfig ? (
              <>
                {renderProviderBlock('Extraction LLM', 'extraction', LLM_PROVIDERS)}
                {renderProviderBlock('Lifecycle LLM', 'lifecycle', LLM_PROVIDERS)}
                {renderProviderBlock('Embedding', 'embedding', EMBEDDING_PROVIDERS)}
              </>
            ) : (
              <>
                {mc ? (
                  <table>
                    <tbody>
                      <tr>
                        <td style={{ width: '30%' }}>Extraction LLM</td>
                        <td>
                          {mc.llm?.extraction?.provider} / {mc.llm?.extraction?.model}
                          {mergedConfig?.has_override && agent.config_override?.llm?.extraction && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>overridden</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Lifecycle LLM</td>
                        <td>
                          {mc.llm?.lifecycle?.provider} / {mc.llm?.lifecycle?.model}
                          {mergedConfig?.has_override && agent.config_override?.llm?.lifecycle && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>overridden</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>Embedding</td>
                        <td>
                          {mc.embedding?.provider} / {mc.embedding?.model}
                          {mergedConfig?.has_override && agent.config_override?.embedding && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>overridden</span>
                          )}
                        </td>
                      </tr>
                      <tr><td>Embedding Dimensions</td><td>{mc.embedding?.dimensions}</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: 'var(--text-muted)' }}>Loading configuration...</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab: Integration */}
      {tab === 'integration' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Integration Guide</h3>
          {renderIntegration()}
        </div>
      )}
    </div>
  );
}
