import React, { useEffect, useState } from 'react';
import { getConfig, updateConfig, triggerExport, triggerReindex, triggerImport } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

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
  const { t } = useI18n();

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
      setToast({ message: t('settings.toastMarkdownExported'), type: 'success' });
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
      setToast({ message: t('settings.toastConfigSaved'), type: 'success' });
    } catch (e: any) {
      setToast({ message: t('settings.toastSaveFailed', { message: e.message }), type: 'error' });
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
          <button className="btn" onClick={cancelEdit}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => saveSection(section)}>{t('common.save')}</button>
        </div>
      ) : (
        <button className="btn" onClick={() => startEdit(section)} disabled={editingSection !== null && editingSection !== section}>
          {t('common.edit')}
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
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{val ? t('common.on') : t('common.off')}</span>
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
          <label>{t('settings.provider')}</label>
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
              <label>{t('settings.model')}</label>
              {models.length > 0 ? (
                <>
                  <select
                    value={isCustomModel ? CUSTOM_MODEL : (d.model ?? '')}
                    onChange={e => handleModelSelectChange(e.target.value)}
                  >
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                    <option value={CUSTOM_MODEL}>{t('settings.customModel')}</option>
                  </select>
                  {isCustomModel && (
                    <input
                      type="text"
                      value={d.customModel ?? ''}
                      placeholder={t('settings.enterCustomModel')}
                      style={{ marginTop: 8 }}
                      onChange={e => updateDraft(`${prefix}.customModel`, e.target.value)}
                    />
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={d.customModel ?? d.model ?? ''}
                  placeholder={t('settings.enterModel')}
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
                <label>{t('settings.dimensions')}</label>
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
                  {t('settings.apiKey')}
                  {d.hasApiKey && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--success)' }}>{t('common.configured')}</span>
                  )}
                  {!d.hasApiKey && preset.envKey && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>env: {preset.envKey}</span>
                  )}
                </label>
                <input
                  type="password"
                  value={d.apiKey ?? ''}
                  placeholder={d.hasApiKey ? t('settings.keepCurrentKey') : t('settings.enterKeyOrEnv', { envKey: preset.envKey })}
                  onChange={e => updateDraft(`${prefix}.apiKey`, e.target.value)}
                />
              </div>
            )}

            {/* Base URL */}
            <div className="form-group">
              <label>
                {t('settings.baseUrl')}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{t('common.optional')}</span>
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

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>{t('common.errorPrefix', { message: error })}</div>;
  if (!config) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <h1 className="page-title">{t('settings.title')}</h1>

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
          <h3>{t('settings.serverConfig')}</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.readOnly')}</span>
        </div>
        <table>
          <tbody>
            <tr><td>{t('settings.port')}</td><td>{config.port}</td></tr>
            <tr><td>{t('settings.host')}</td><td>{config.host}</td></tr>
            <tr><td>{t('settings.dbPath')}</td><td>{config.storage?.dbPath}</td></tr>
            <tr><td>{t('settings.walMode')}</td><td>{config.storage?.walMode ? t('common.on') : t('common.off')}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── LLM & Embedding ── */}
      <div className="card">
        {sectionHeader(t('settings.llmEmbedding'), 'llm')}
        {isEditing('llm') ? (
          <>
            {renderProviderBlock(t('settings.extractionLlm'), 'extraction', LLM_PROVIDERS)}
            {renderProviderBlock(t('settings.lifecycleLlm'), 'lifecycle', LLM_PROVIDERS)}
            {renderProviderBlock(t('settings.embedding'), 'embedding', EMBEDDING_PROVIDERS)}
          </>
        ) : (
          <table>
            <tbody>
              <tr><td>{t('settings.extractionLlm')}</td><td>{config.llm?.extraction?.provider} / {config.llm?.extraction?.model}</td></tr>
              <tr><td>{t('settings.lifecycleLlm')}</td><td>{config.llm?.lifecycle?.provider} / {config.llm?.lifecycle?.model}</td></tr>
              <tr><td>{t('settings.embedding')}</td><td>{config.embedding?.provider} / {config.embedding?.model}</td></tr>
              <tr><td>{t('settings.embeddingDimensions')}</td><td>{config.embedding?.dimensions}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Search ── */}
      <div className="card">
        {sectionHeader(t('settings.searchTitle'), 'search')}
        <table>
          <tbody>
            {isEditing('search') ? (
              <>
                {renderToggle(t('settings.hybridSearch'), 'hybrid')}
                {renderInput(t('settings.vectorWeight'), 'vectorWeight', 'number')}
                {renderInput(t('settings.textWeight'), 'textWeight', 'number')}
                {renderInput(t('settings.recencyBoostWindow'), 'recencyBoostWindow')}
              </>
            ) : (
              <>
                <tr><td>{t('settings.hybridSearch')}</td><td>{config.search?.hybrid ? t('common.on') : t('common.off')}</td></tr>
                <tr><td>{t('settings.vectorWeight')}</td><td>{config.search?.vectorWeight}</td></tr>
                <tr><td>{t('settings.textWeight')}</td><td>{config.search?.textWeight}</td></tr>
                <tr><td>{t('settings.recencyBoostWindow')}</td><td>{config.search?.recencyBoostWindow}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Lifecycle ── */}
      <div className="card">
        {sectionHeader(t('settings.lifecycleTitle'), 'lifecycle')}
        <table>
          <tbody>
            {isEditing('lifecycle') ? (
              <>
                {renderInput(t('settings.scheduleLabel'), 'schedule')}
                {renderInput(t('settings.promotionThreshold'), 'promotionThreshold', 'number')}
                {renderInput(t('settings.archiveThreshold'), 'archiveThreshold', 'number')}
                {renderInput(t('settings.decayLambda'), 'decayLambda', 'number')}
              </>
            ) : (
              <>
                <tr><td>{t('settings.scheduleLabel')}</td><td>{config.lifecycle?.schedule}</td></tr>
                <tr><td>{t('settings.promotionThreshold')}</td><td>{config.lifecycle?.promotionThreshold}</td></tr>
                <tr><td>{t('settings.archiveThreshold')}</td><td>{config.lifecycle?.archiveThreshold}</td></tr>
                <tr><td>{t('settings.decayLambda')}</td><td>{config.lifecycle?.decayLambda}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Layers ── */}
      <div className="card">
        {sectionHeader(t('settings.layersTitle'), 'layers')}
        <table>
          <tbody>
            {isEditing('layers') ? (
              <>
                {renderInput(t('settings.workingTtl'), 'working.ttl')}
                {renderInput(t('settings.coreMaxEntries'), 'core.maxEntries', 'number')}
                {renderInput(t('settings.archiveTtl'), 'archive.ttl')}
                {renderToggle(t('settings.archiveCompressBack'), 'archive.compressBackToCore')}
              </>
            ) : (
              <>
                <tr><td>{t('settings.workingTtl')}</td><td>{config.layers?.working?.ttl}</td></tr>
                <tr><td>{t('settings.coreMaxEntries')}</td><td>{config.layers?.core?.maxEntries}</td></tr>
                <tr><td>{t('settings.archiveTtl')}</td><td>{config.layers?.archive?.ttl}</td></tr>
                <tr><td>{t('settings.archiveCompressBack')}</td><td>{config.layers?.archive?.compressBackToCore ? t('common.on') : t('common.off')}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Gate ── */}
      <div className="card">
        {sectionHeader(t('settings.gateTitle'), 'gate')}
        <table>
          <tbody>
            {isEditing('gate') ? (
              <>
                {renderInput(t('settings.maxInjectionTokens'), 'maxInjectionTokens', 'number')}
                {renderToggle(t('settings.skipSmallTalk'), 'skipSmallTalk')}
              </>
            ) : (
              <>
                <tr><td>{t('settings.maxInjectionTokens')}</td><td>{config.gate?.maxInjectionTokens}</td></tr>
                <tr><td>{t('settings.skipSmallTalk')}</td><td>{config.gate?.skipSmallTalk ? t('common.on') : t('common.off')}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Data Management ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>{t('settings.dataManagement')}</h3>

        {/* Export */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.exportLabel')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={async () => {
              try {
                const data = await triggerExport('json');
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `cortex-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
                URL.revokeObjectURL(url);
                setToast({ message: t('settings.toastJsonExported'), type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>{t('settings.exportJson')}</button>
            <button className="btn" onClick={async () => {
              try {
                await triggerExport('markdown');
                setToast({ message: t('settings.toastMarkdownExported'), type: 'success' });
              } catch (e: any) { setToast({ message: e.message, type: 'error' }); }
            }}>{t('settings.exportMarkdown')}</button>
          </div>
        </div>

        {/* Reindex */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('settings.maintenance')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={async () => {
              if (!confirm(t('settings.confirmReindex'))) return;
              try {
                setToast({ message: t('settings.toastReindexStarted'), type: 'success' });
                const result = await triggerReindex();
                setToast({ message: t('settings.toastReindexComplete', { indexed: result.indexed, total: result.total, errors: result.errors }), type: result.errors > 0 ? 'error' : 'success' });
              } catch (e: any) { setToast({ message: t('settings.toastReindexFailed', { message: e.message }), type: 'error' }); }
            }}>{t('settings.rebuildIndex')}</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.rebuildHint')}</span>
          </div>
        </div>
      </div>

      {/* ── Full Config JSON ── */}
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>{t('settings.fullConfig')}</h3>
        <pre className="json-debug">{JSON.stringify(config, null, 2)}</pre>
      </div>
    </div>
  );
}
