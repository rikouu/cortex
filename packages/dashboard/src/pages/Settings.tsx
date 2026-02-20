import React, { useEffect, useState } from 'react';
import { getConfig, updateConfig, triggerExport, triggerReindex, triggerImport } from '../api/client.js';

type SectionKey = 'llm' | 'search' | 'lifecycle' | 'layers' | 'gate';

// ─── Provider & Model Presets ────────────────────────────────────────────────

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
    models: [
      'gpt-4o', 'gpt-4o-mini',
      'gpt-4-turbo', 'gpt-4',
      'o1', 'o1-mini', 'o1-pro',
      'o3', 'o3-mini', 'o4-mini',
    ],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    models: [
      'claude-opus-4-5', 'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest',
    ],
    envKey: 'ANTHROPIC_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      'gemini-2.5-pro', 'gemini-2.5-flash',
      'gemini-2.0-flash', 'gemini-2.0-flash-lite',
      'gemini-1.5-pro', 'gemini-1.5-flash',
    ],
    envKey: 'GOOGLE_API_KEY',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4-5',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-4o', 'openai/gpt-4o-mini',
      'google/gemini-2.5-pro',
      'google/gemini-2.0-flash',
      'deepseek/deepseek-chat-v3',
      'deepseek/deepseek-r1',
      'meta-llama/llama-4-maverick',
      'qwen/qwen3-235b-a22b',
    ],
    envKey: 'OPENROUTER_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      'qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5:14b',
      'llama3.2:3b', 'llama3.2:8b',
      'mistral:7b', 'mistral-nemo:12b',
      'deepseek-r1:7b', 'deepseek-r1:14b',
      'gemma2:9b', 'phi3:14b',
    ],
    envKey: '',
  },
  none: {
    label: 'Disabled',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
};

const EMBEDDING_PROVIDERS: Record<string, ProviderPreset> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      'text-embedding-3-small',
      'text-embedding-3-large',
      'text-embedding-ada-002',
    ],
    envKey: 'OPENAI_API_KEY',
  },
  google: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      'text-embedding-004',
      'embedding-001',
    ],
    envKey: 'GOOGLE_API_KEY',
  },
  voyage: {
    label: 'Voyage AI',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    models: [
      'voyage-3', 'voyage-3-lite',
      'voyage-code-3',
    ],
    envKey: 'VOYAGE_API_KEY',
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      'bge-m3', 'nomic-embed-text',
      'mxbai-embed-large', 'all-minilm',
    ],
    envKey: '',
  },
  none: {
    label: 'Disabled',
    defaultBaseUrl: '',
    models: [],
    envKey: '',
  },
};

const CUSTOM_MODEL = '__custom__';

// ─── Component ───────────────────────────────────────────────────────────────

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleExport = async () => {
    try {
      await triggerExport();
      setToast({ message: 'Markdown export completed!', type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  // ─── Edit lifecycle ──────────────────────────────────────────────────────

  const startEdit = (section: SectionKey) => {
    const sectionDrafts: Record<SectionKey, () => any> = {
      llm: () => ({
        extraction: {
          provider: config.llm?.extraction?.provider ?? 'openai',
          model: config.llm?.extraction?.model ?? '',
          customModel: '',
          useCustomModel: false,
          apiKey: '',
          baseUrl: config.llm?.extraction?.baseUrl ?? '',
          hasApiKey: config.llm?.extraction?.hasApiKey ?? false,
        },
        lifecycle: {
          provider: config.llm?.lifecycle?.provider ?? 'openai',
          model: config.llm?.lifecycle?.model ?? '',
          customModel: '',
          useCustomModel: false,
          apiKey: '',
          baseUrl: config.llm?.lifecycle?.baseUrl ?? '',
          hasApiKey: config.llm?.lifecycle?.hasApiKey ?? false,
        },
        embedding: {
          provider: config.embedding?.provider ?? 'openai',
          model: config.embedding?.model ?? '',
          customModel: '',
          useCustomModel: false,
          dimensions: config.embedding?.dimensions ?? 1536,
          apiKey: '',
          baseUrl: config.embedding?.baseUrl ?? '',
          hasApiKey: config.embedding?.hasApiKey ?? false,
        },
      }),
      search: () => ({
        hybrid: config.search?.hybrid ?? false,
        vectorWeight: config.search?.vectorWeight ?? 0.7,
        textWeight: config.search?.textWeight ?? 0.3,
        recencyBoostWindow: config.search?.recencyBoostWindow ?? '',
      }),
      lifecycle: () => ({
        schedule: config.lifecycle?.schedule ?? '',
        promotionThreshold: config.lifecycle?.promotionThreshold ?? 0,
        archiveThreshold: config.lifecycle?.archiveThreshold ?? 0,
        decayLambda: config.lifecycle?.decayLambda ?? 0,
      }),
      layers: () => ({
        working: { ttl: config.layers?.working?.ttl ?? '' },
        core: { maxEntries: config.layers?.core?.maxEntries ?? 0 },
        archive: { ttl: config.layers?.archive?.ttl ?? '', compressBackToCore: config.layers?.archive?.compressBackToCore ?? false },
      }),
      gate: () => ({
        maxInjectionTokens: config.gate?.maxInjectionTokens ?? 0,
        skipSmallTalk: config.gate?.skipSmallTalk ?? false,
      }),
    };

    const d = sectionDrafts[section]();

    // For LLM section, check if current model is in presets
    if (section === 'llm') {
      for (const key of ['extraction', 'lifecycle'] as const) {
        const prov = d[key].provider;
        const presets = LLM_PROVIDERS[prov]?.models ?? [];
        if (d[key].model && !presets.includes(d[key].model)) {
          d[key].useCustomModel = true;
          d[key].customModel = d[key].model;
        }
      }
      const embProv = d.embedding.provider;
      const embPresets = EMBEDDING_PROVIDERS[embProv]?.models ?? [];
      if (d.embedding.model && !embPresets.includes(d.embedding.model)) {
        d.embedding.useCustomModel = true;
        d.embedding.customModel = d.embedding.model;
      }
    }

    setDraft(d);
    setEditingSection(section);
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setDraft({});
  };

  const saveSection = async (section: SectionKey) => {
    try {
      const payload: any = {};

      if (section === 'llm') {
        const buildProviderPayload = (d: any) => {
          const out: any = {
            provider: d.provider,
            model: d.useCustomModel ? d.customModel : d.model,
          };
          if (d.apiKey) out.apiKey = d.apiKey;
          if (d.baseUrl) out.baseUrl = d.baseUrl;
          return out;
        };

        payload.llm = {
          extraction: buildProviderPayload(draft.extraction),
          lifecycle: buildProviderPayload(draft.lifecycle),
        };

        const embOut: any = {
          provider: draft.embedding.provider,
          model: draft.embedding.useCustomModel ? draft.embedding.customModel : draft.embedding.model,
          dimensions: Number(draft.embedding.dimensions),
        };
        if (draft.embedding.apiKey) embOut.apiKey = draft.embedding.apiKey;
        if (draft.embedding.baseUrl) embOut.baseUrl = draft.embedding.baseUrl;
        payload.embedding = embOut;
      } else if (section === 'search') {
        payload.search = {
          ...draft,
          vectorWeight: Number(draft.vectorWeight),
          textWeight: Number(draft.textWeight),
        };
      } else if (section === 'lifecycle') {
        payload.lifecycle = {
          ...draft,
          promotionThreshold: Number(draft.promotionThreshold),
          archiveThreshold: Number(draft.archiveThreshold),
          decayLambda: Number(draft.decayLambda),
        };
      } else if (section === 'layers') {
        payload.layers = {
          working: { ttl: draft.working.ttl },
          core: { maxEntries: Number(draft.core.maxEntries) },
          archive: { ttl: draft.archive.ttl, compressBackToCore: draft.archive.compressBackToCore },
        };
      } else if (section === 'gate') {
        payload.gate = {
          maxInjectionTokens: Number(draft.maxInjectionTokens),
          skipSmallTalk: draft.skipSmallTalk,
        };
      }

      await updateConfig(payload);
      const refreshed = await getConfig();
      setConfig(refreshed);
      setEditingSection(null);
      setDraft({});
      setToast({ message: 'Configuration saved successfully', type: 'success' });
    } catch (e: any) {
      setToast({ message: `Save failed: ${e.message}`, type: 'error' });
    }
  };

  // ─── Draft helpers ───────────────────────────────────────────────────────

  const updateDraft = (path: string, value: any) => {
    setDraft((prev: any) => {
      const keys = path.split('.');
      const next = JSON.parse(JSON.stringify(prev));
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const isEditing = (section: SectionKey) => editingSection === section;

  // ─── Shared UI helpers ───────────────────────────────────────────────────

  const sectionHeader = (title: string, section: SectionKey) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h3>{title}</h3>
      {isEditing(section) ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={cancelEdit}>Cancel</button>
          <button className="btn primary" onClick={() => saveSection(section)}>Save</button>
        </div>
      ) : (
        <button className="btn" onClick={() => startEdit(section)} disabled={editingSection !== null && editingSection !== section}>
          Edit
        </button>
      )}
    </div>
  );

  const renderToggle = (label: string, draftPath: string) => {
    const keys = draftPath.split('.');
    let val: any = draft;
    for (const k of keys) val = val?.[k];
    return (
      <tr>
        <td style={{ verticalAlign: 'middle', width: '40%' }}>{label}</td>
        <td>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <div
              onClick={() => updateDraft(draftPath, !val)}
              style={{
                width: 40, height: 22, borderRadius: 11,
                background: val ? 'var(--primary)' : 'var(--border)',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', position: 'absolute', top: 2,
                left: val ? 20 : 2, transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{val ? 'On' : 'Off'}</span>
          </label>
        </td>
      </tr>
    );
  };

  const renderInput = (label: string, draftPath: string, type: 'text' | 'number' = 'text') => {
    const keys = draftPath.split('.');
    let val: any = draft;
    for (const k of keys) val = val?.[k];
    return (
      <tr>
        <td style={{ verticalAlign: 'middle', width: '40%' }}>{label}</td>
        <td>
          <input
            type={type}
            value={val ?? ''}
            step={type === 'number' ? 'any' : undefined}
            onChange={e => updateDraft(draftPath, e.target.value)}
          />
        </td>
      </tr>
    );
  };

  // ─── LLM Provider Row (reusable for extraction, lifecycle, embedding) ──

  const renderProviderBlock = (
    title: string,
    prefix: string,
    providerMap: Record<string, ProviderPreset>,
  ) => {
    const keys = prefix.split('.');
    let d: any = draft;
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
      const firstModel = newPreset?.models?.[0] ?? '';
      updateDraft(`${prefix}.model`, firstModel);
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

        {/* Provider */}
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
            {/* Model */}
            <div className="form-group">
              <label>Model</label>
              {models.length > 0 ? (
                <>
                  <select
                    value={isCustomModel ? CUSTOM_MODEL : (d.model ?? '')}
                    onChange={e => handleModelSelectChange(e.target.value)}
                  >
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
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

            {/* Dimensions (embedding only) */}
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

            {/* API Key */}
            {preset?.envKey && (
              <div className="form-group">
                <label>
                  API Key
                  {d.hasApiKey && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--success)' }}>configured</span>
                  )}
                  {!d.hasApiKey && preset.envKey && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>env: {preset.envKey}</span>
                  )}
                </label>
                <input
                  type="password"
                  value={d.apiKey ?? ''}
                  placeholder={d.hasApiKey ? 'Leave empty to keep current key' : `Enter ${preset.envKey} or leave empty to use env`}
                  onChange={e => updateDraft(`${prefix}.apiKey`, e.target.value)}
                />
              </div>
            )}

            {/* Base URL */}
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

  // ─── Render ────────────────────────────────────────────────────────────

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>;
  if (!config) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h1 className="page-title">Settings</h1>

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

      {/* ── Server (read-only) ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3>Server Configuration</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Read-only (requires restart)</span>
        </div>
        <table>
          <tbody>
            <tr><td>Port</td><td>{config.port}</td></tr>
            <tr><td>Host</td><td>{config.host}</td></tr>
            <tr><td>DB Path</td><td>{config.storage?.dbPath}</td></tr>
            <tr><td>WAL Mode</td><td>{config.storage?.walMode ? 'On' : 'Off'}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── LLM & Embedding ── */}
      <div className="card">
        {sectionHeader('LLM & Embedding', 'llm')}
        {isEditing('llm') ? (
          <>
            {renderProviderBlock('Extraction LLM', 'extraction', LLM_PROVIDERS)}
            {renderProviderBlock('Lifecycle LLM', 'lifecycle', LLM_PROVIDERS)}
            {renderProviderBlock('Embedding', 'embedding', EMBEDDING_PROVIDERS)}
          </>
        ) : (
          <table>
            <tbody>
              <tr><td>Extraction LLM</td><td>{config.llm?.extraction?.provider} / {config.llm?.extraction?.model}</td></tr>
              <tr><td>Lifecycle LLM</td><td>{config.llm?.lifecycle?.provider} / {config.llm?.lifecycle?.model}</td></tr>
              <tr><td>Embedding</td><td>{config.embedding?.provider} / {config.embedding?.model}</td></tr>
              <tr><td>Embedding Dimensions</td><td>{config.embedding?.dimensions}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Search ── */}
      <div className="card">
        {sectionHeader('Search', 'search')}
        <table>
          <tbody>
            {isEditing('search') ? (
              <>
                {renderToggle('Hybrid Search', 'hybrid')}
                {renderInput('Vector Weight', 'vectorWeight', 'number')}
                {renderInput('Text Weight', 'textWeight', 'number')}
                {renderInput('Recency Boost Window', 'recencyBoostWindow')}
              </>
            ) : (
              <>
                <tr><td>Hybrid Search</td><td>{config.search?.hybrid ? 'On' : 'Off'}</td></tr>
                <tr><td>Vector Weight</td><td>{config.search?.vectorWeight}</td></tr>
                <tr><td>Text Weight</td><td>{config.search?.textWeight}</td></tr>
                <tr><td>Recency Boost Window</td><td>{config.search?.recencyBoostWindow}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Lifecycle ── */}
      <div className="card">
        {sectionHeader('Lifecycle', 'lifecycle')}
        <table>
          <tbody>
            {isEditing('lifecycle') ? (
              <>
                {renderInput('Schedule', 'schedule')}
                {renderInput('Promotion Threshold', 'promotionThreshold', 'number')}
                {renderInput('Archive Threshold', 'archiveThreshold', 'number')}
                {renderInput('Decay Lambda', 'decayLambda', 'number')}
              </>
            ) : (
              <>
                <tr><td>Schedule</td><td>{config.lifecycle?.schedule}</td></tr>
                <tr><td>Promotion Threshold</td><td>{config.lifecycle?.promotionThreshold}</td></tr>
                <tr><td>Archive Threshold</td><td>{config.lifecycle?.archiveThreshold}</td></tr>
                <tr><td>Decay Lambda</td><td>{config.lifecycle?.decayLambda}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Layers ── */}
      <div className="card">
        {sectionHeader('Layers', 'layers')}
        <table>
          <tbody>
            {isEditing('layers') ? (
              <>
                {renderInput('Working TTL', 'working.ttl')}
                {renderInput('Core Max Entries', 'core.maxEntries', 'number')}
                {renderInput('Archive TTL', 'archive.ttl')}
                {renderToggle('Archive Compress Back', 'archive.compressBackToCore')}
              </>
            ) : (
              <>
                <tr><td>Working TTL</td><td>{config.layers?.working?.ttl}</td></tr>
                <tr><td>Core Max Entries</td><td>{config.layers?.core?.maxEntries}</td></tr>
                <tr><td>Archive TTL</td><td>{config.layers?.archive?.ttl}</td></tr>
                <tr><td>Archive Compress Back</td><td>{config.layers?.archive?.compressBackToCore ? 'On' : 'Off'}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Gate ── */}
      <div className="card">
        {sectionHeader('Gate', 'gate')}
        <table>
          <tbody>
            {isEditing('gate') ? (
              <>
                {renderInput('Max Injection Tokens', 'maxInjectionTokens', 'number')}
                {renderToggle('Skip Small Talk', 'skipSmallTalk')}
              </>
            ) : (
              <>
                <tr><td>Max Injection Tokens</td><td>{config.gate?.maxInjectionTokens}</td></tr>
                <tr><td>Skip Small Talk</td><td>{config.gate?.skipSmallTalk ? 'On' : 'Off'}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Data Management ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Data Management</h3>

        {/* Export */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Export</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => {
              try {
                const data = await triggerExport('json');
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `cortex-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
                URL.revokeObjectURL(url);
                setToast({ message: 'JSON exported', type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>Export JSON</button>
            <button className="btn" onClick={async () => {
              try {
                await triggerExport('markdown');
                setToast({ message: 'Markdown export completed', type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>Export Markdown</button>
          </div>
        </div>

        {/* Reindex */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Maintenance</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={async () => {
              if (!confirm('Rebuild all vector embeddings? This may take a while for large databases.')) return;
              try {
                setToast({ message: 'Reindex started...', type: 'success' });
                const result = await triggerReindex();
                setToast({ message: `Reindex complete: ${result.indexed}/${result.total} indexed (${result.errors} errors)`, type: result.errors > 0 ? 'error' : 'success' });
              } catch (e: any) { setToast({ message: `Reindex failed: ${e.message}`, type: 'error' }); }
            }}>Rebuild Vector Index</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Rebuilds all embedding vectors. Use after changing embedding model.</span>
          </div>
        </div>
      </div>

      {/* ── Full Config JSON ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Full Config (JSON)</h3>
        <pre className="json-debug">{JSON.stringify(config, null, 2)}</pre>
      </div>
    </div>
  );
}
