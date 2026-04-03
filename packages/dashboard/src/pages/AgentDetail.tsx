import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAgent, updateAgent, deleteAgent, getAgentConfig, checkAuth } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { LLM_PROVIDERS, EMBEDDING_PROVIDERS, CUSTOM_MODEL, type ProviderPreset } from './Settings/types.js';

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

const RETRY_FIELD_PATHS = [
  'maxRetries',
  'retries',
  'retryCount',
  'retryAttempts',
  'retry.maxRetries',
  'retry.maxAttempts',
  'retry.count',
  'retry.attempts',
];

const RETRY_DELAY_FIELD_PATHS = [
  'baseDelayMs',
  'retry.baseDelayMs',
  'retry.delayMs',
];

function getValueAtPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function setValueAtPath(obj: any, path: string, value: any) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]!] = value;
}

function getNumericConfig(raw: any, paths: string[], fallbackPath: string, fallbackValue = 0): { value: number; path: string } {
  for (const path of paths) {
    const candidate = getValueAtPath(raw, path);
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      const parsed = Number(candidate);
      return { value: Number.isFinite(parsed) ? parsed : fallbackValue, path };
    }
  }
  return { value: fallbackValue, path: fallbackPath };
}

function buildProviderDraft(raw: any, providerMap: Record<string, ProviderPreset>, defaultProvider: string) {
  const provider = raw?.provider ?? defaultProvider;
  const model = raw?.model ?? '';
  const isCustom = !!model && !(providerMap[provider]?.models ?? []).includes(model);

  return {
    provider,
    model,
    customModel: isCustom ? model : '',
    useCustomModel: isCustom,
    apiKey: '',
    baseUrl: raw?.baseUrl ?? '',
    timeoutMs: raw?.timeoutMs ?? '',
    hasApiKey: raw?.hasApiKey ?? !!raw?.apiKey,
    defaultProvider,
  };
}

function buildLlmTargetDraft(raw: any) {
  const usesPrimaryObject = !!raw?.primary;
  const primary = usesPrimaryObject ? raw.primary : raw;
  const retry = getNumericConfig(raw, RETRY_FIELD_PATHS, 'retry.maxRetries', 0);
  const retryDelay = getNumericConfig(raw, RETRY_DELAY_FIELD_PATHS, 'retry.baseDelayMs', 200);

  return {
    ...buildProviderDraft(primary, LLM_PROVIDERS, 'openai'),
    fallback: buildProviderDraft(raw?.fallback, LLM_PROVIDERS, 'none'),
    maxRetries: retry.value,
    baseDelayMs: retryDelay.value,
    _retryPath: retry.path,
    _retryDelayPath: retryDelay.path,
    _usesPrimaryObject: usesPrimaryObject,
  };
}

function buildProviderPayload(draftValue: any) {
  const model = draftValue?.useCustomModel ? draftValue?.customModel : draftValue?.model;
  const payload: any = {
    provider: draftValue?.provider ?? draftValue?.defaultProvider ?? 'none',
    model: model ?? '',
  };
  if (draftValue?.baseUrl) payload.baseUrl = draftValue.baseUrl;
  if (draftValue?.timeoutMs !== '' && draftValue?.timeoutMs !== undefined && draftValue?.timeoutMs !== null) {
    payload.timeoutMs = Number(draftValue.timeoutMs);
  }
  if (draftValue?.apiKey) payload.apiKey = draftValue.apiKey;
  return payload;
}

function buildLlmTargetPayload(draftValue: any) {
  const primaryPayload = buildProviderPayload(draftValue);
  const payload: any = draftValue?._usesPrimaryObject ? { primary: primaryPayload } : { ...primaryPayload };
  payload.fallback = buildProviderPayload(draftValue?.fallback);
  setValueAtPath(payload, 'retry.maxRetries', Number(draftValue?.maxRetries ?? 0));
  setValueAtPath(payload, 'retry.baseDelayMs', Number(draftValue?.baseDelayMs ?? 200));
  return payload;
}

type TabKey = 'overview' | 'config' | 'integration';

// ─── CodeSnippet ─────────────────────────────────────────────────────────────

function CodeSnippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = () => {
    copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <button className="btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={handleCopy}>
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      <pre className="json-debug" style={{ margin: 0 }}>{code}</pre>
    </div>
  );
}

// ─── StepBlock ───────────────────────────────────────────────────────────────

function StepBlock({ step, title, description, code, children, isLast }: {
  step: number;
  title: string;
  description?: string;
  code?: string;
  children?: React.ReactNode;
  isLast?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const handleCopy = () => {
    if (!code) return;
    copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: isLast ? 0 : 24, position: 'relative' }}>
      {/* Left: step number + vertical line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--color-primary)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 600, flexShrink: 0,
        }}>
          {step}
        </div>
        {!isLast && (
          <div style={{ width: 2, flex: 1, background: 'var(--color-border)', marginTop: 4 }} />
        )}
      </div>

      {/* Right: content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: description || code || children ? 8 : 0 }}>
          {title}
        </div>
        {description && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
            {description}
          </p>
        )}
        {code && (
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <button
              className="btn"
              style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, padding: '3px 10px', zIndex: 1 }}
              onClick={handleCopy}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
            <pre className="json-debug" style={{ margin: 0 }}>{code}</pre>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

type IntegrationTabKey = 'api' | 'mcp' | 'openclaw';

// ─── Main Component ──────────────────────────────────────────────────────────

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [agent, setAgent] = useState<any>(null);
  const [mergedConfig, setMergedConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('overview');
  const [integrationTab, setIntegrationTab] = useState<IntegrationTabKey>('api');
  const [mcpClient, setMcpClient] = useState<'claude-desktop' | 'cursor' | 'claude-code' | 'other'>('claude-desktop');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Overview editing
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ name: '', description: '' });

  // Config editing
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<any>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({});
  const [authEnabled, setAuthEnabled] = useState(false);

  useEffect(() => {
    checkAuth().then(({ authRequired }) => setAuthEnabled(authRequired));
  }, []);

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
      setToast({ message: t('agentDetail.toastUpdated'), type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('agentDetail.confirmDelete', { name: agent.name }))) return;
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

    const buildEmbeddingDraft = (effective: any, agentOverride: any) => {
      const provider = agentOverride?.provider ?? effective?.provider ?? 'openai';
      const model = agentOverride?.model ?? effective?.model ?? '';
      const preset = EMBEDDING_PROVIDERS[provider];
      const isCustom = model && !(preset?.models ?? []).includes(model);

      return {
        provider,
        model,
        customModel: isCustom ? model : '',
        useCustomModel: isCustom,
        apiKey: '',
        baseUrl: agentOverride?.baseUrl ?? '',
        hasApiKey: effective?.hasApiKey ?? !!agentOverride?.apiKey,
        isOverridden: !!agentOverride,
        dimensions: agentOverride?.dimensions ?? effective?.dimensions ?? 1536,
        defaultProvider: 'openai',
      };
    };

    const nextDraft = {
      extraction: buildLlmTargetDraft(override.llm?.extraction ? {
        ...mc.llm?.extraction,
        ...override.llm.extraction,
        fallback: override.llm.extraction.fallback ?? mc.llm?.extraction?.fallback,
        primary: override.llm.extraction.primary ?? mc.llm?.extraction?.primary,
      } : mc.llm?.extraction),
      lifecycle: buildLlmTargetDraft(override.llm?.lifecycle ? {
        ...mc.llm?.lifecycle,
        ...override.llm.lifecycle,
        fallback: override.llm.lifecycle.fallback ?? mc.llm?.lifecycle?.fallback,
        primary: override.llm.lifecycle.primary ?? mc.llm?.lifecycle?.primary,
      } : mc.llm?.lifecycle),
      embedding: buildEmbeddingDraft(mc.embedding, override.embedding),
    };

    setSavedKeys(prev => {
      const next = { ...prev };
      for (const [prefix, sub] of [
        ['extraction', nextDraft.extraction],
        ['extraction.fallback', nextDraft.extraction?.fallback],
        ['lifecycle', nextDraft.lifecycle],
        ['lifecycle.fallback', nextDraft.lifecycle?.fallback],
        ['embedding', nextDraft.embedding],
      ] as const) {
        if (sub?.hasApiKey && !next[`${prefix}::${sub.provider}`]) {
          next[`${prefix}::${sub.provider}`] = '__CONFIGURED__';
        }
      }
      return next;
    });

    setConfigDraft(nextDraft);
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
      for (const key of ['extraction', 'lifecycle'] as const) {
        const retryCount = Number(configDraft[key]?.maxRetries ?? 0);
        if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 10) {
          setToast({ message: t('agentDetail.validationRetryRange'), type: 'error' });
          return;
        }
        const retryDelay = Number(configDraft[key]?.baseDelayMs ?? 200);
        if (!Number.isInteger(retryDelay) || retryDelay < 0 || retryDelay > 5000) {
          setToast({ message: t('agentDetail.validationRetryDelayRange'), type: 'error' });
          return;
        }
        for (const branch of [configDraft[key], configDraft[key]?.fallback]) {
          const timeoutRaw = branch?.timeoutMs;
          if (timeoutRaw === '' || timeoutRaw === undefined || timeoutRaw === null) continue;
          const timeoutMs = Number(timeoutRaw);
          if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) {
            setToast({ message: t('agentDetail.validationTimeoutRange'), type: 'error' });
            return;
          }
        }
      }

      const config_override: any = {
        llm: {
          extraction: buildLlmTargetPayload(configDraft.extraction),
          lifecycle: buildLlmTargetPayload(configDraft.lifecycle),
        },
        embedding: {
          ...buildProviderPayload(configDraft.embedding),
          dimensions: Number(configDraft.embedding.dimensions),
        },
      };

      const updated = await updateAgent(id!, { config_override });
      setAgent((prev: any) => ({ ...prev, ...updated }));
      const configData = await getAgentConfig(id!);
      setMergedConfig(configData);
      setEditingConfig(false);
      setToast({ message: t('agentDetail.toastConfigSaved'), type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  const resetConfig = async () => {
    if (!confirm(t('agentDetail.confirmReset'))) return;
    try {
      const updated = await updateAgent(id!, { config_override: null });
      setAgent((prev: any) => ({ ...prev, ...updated }));
      const configData = await getAgentConfig(id!);
      setMergedConfig(configData);
      setEditingConfig(false);
      setToast({ message: t('agentDetail.toastConfigReset'), type: 'success' });
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

    const provider = d.provider ?? d.defaultProvider ?? 'openai';
    const preset = providerMap[provider];
    const models = preset?.models ?? [];
    const isCustomModel = d.useCustomModel;
    const isDisabled = provider === 'none';

    const handleProviderChange = (newProvider: string) => {
      const currentKey = d.apiKey;
      if (currentKey) {
        setSavedKeys(prev => ({ ...prev, [`${prefix}::${provider}`]: currentKey }));
      } else if (d.hasApiKey) {
        setSavedKeys(prev => ({ ...prev, [`${prefix}::${provider}`]: prev[`${prefix}::${provider}`] || '__CONFIGURED__' }));
      }
      updateDraft(`${prefix}.provider`, newProvider);
      const newPreset = providerMap[newProvider];
      updateDraft(`${prefix}.model`, newPreset?.models?.[0] ?? '');
      updateDraft(`${prefix}.useCustomModel`, false);
      updateDraft(`${prefix}.customModel`, '');
      updateDraft(`${prefix}.baseUrl`, '');
      const restoredKey = savedKeys[`${prefix}::${newProvider}`] ?? '';
      if (restoredKey === '__CONFIGURED__') {
        updateDraft(`${prefix}.apiKey`, '');
        updateDraft(`${prefix}.hasApiKey`, true);
      } else {
        updateDraft(`${prefix}.apiKey`, restoredKey);
        updateDraft(`${prefix}.hasApiKey`, !!restoredKey);
      }
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
      <div style={{ marginBottom: 20, padding: 16, background: 'var(--color-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          {title}
        </div>

        <div className="form-group">
          <label>{t('agentDetail.provider')}</label>
          <select value={provider} onChange={e => handleProviderChange(e.target.value)}>
            {Object.entries(providerMap).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>

        {!isDisabled && (
          <>
            <div className="form-group">
              <label>{t('agentDetail.model')}</label>
              {models.length > 0 ? (
                <>
                  <select
                    value={isCustomModel ? CUSTOM_MODEL : (d.model ?? '')}
                    onChange={e => handleModelSelectChange(e.target.value)}
                  >
                    {models.map((m: string) => <option key={m} value={m}>{m}</option>)}
                    <option value={CUSTOM_MODEL}>{t('agentDetail.customModel')}</option>
                  </select>
                  {isCustomModel && (
                    <input
                      type="text"
                      value={d.customModel ?? ''}
                      placeholder={t('agentDetail.enterCustomModel')}
                      style={{ marginTop: 8 }}
                      onChange={e => updateDraft(`${prefix}.customModel`, e.target.value)}
                    />
                  )}
                </>
              ) : (
                <input
                  type="text"
                  value={d.customModel ?? d.model ?? ''}
                  placeholder={t('agentDetail.enterModel')}
                  onChange={e => {
                    updateDraft(`${prefix}.model`, e.target.value);
                    updateDraft(`${prefix}.customModel`, e.target.value);
                  }}
                />
              )}
            </div>

            {d.dimensions !== undefined && (
              <div className="form-group">
                <label>{t('agentDetail.dimensions')}</label>
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
                  {t('agentDetail.apiKey')}
                  {d.hasApiKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-success)' }}>{t('common.configured')}</span>}
                  {!d.hasApiKey && preset.envKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>env: {preset.envKey}</span>}
                </label>
                <input
                  type="password"
                  value={d.apiKey ?? ''}
                  placeholder={d.hasApiKey ? t('agentDetail.keepCurrentKey') : t('agentDetail.enterKeyOrEnv', { envKey: preset.envKey })}
                  onChange={e => updateDraft(`${prefix}.apiKey`, e.target.value)}
                />
              </div>
            )}

            <div className="form-group">
              <label>
                {t('agentDetail.baseUrl')}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('common.optional')}</span>
              </label>
              <input
                type="text"
                value={d.baseUrl ?? ''}
                placeholder={preset?.defaultBaseUrl || 'Default'}
                onChange={e => updateDraft(`${prefix}.baseUrl`, e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>
                {t('agentDetail.timeoutMs')}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('common.optional')}</span>
              </label>
              <input
                type="number"
                min={100}
                max={300000}
                value={d.timeoutMs ?? ''}
                placeholder={provider === 'ollama' ? '60000' : '30000'}
                onChange={e => updateDraft(`${prefix}.timeoutMs`, e.target.value)}
              />
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
                {t('agentDetail.timeoutMsDesc')}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderLlmStrategyBlock = (title: string, prefix: 'extraction' | 'lifecycle') => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {renderProviderBlock(t('agentDetail.primaryProvider'), prefix, LLM_PROVIDERS)}
      <div className="form-group" style={{ marginBottom: 20 }}>
        <label>{t('agentDetail.retryAttempts')}</label>
        <input
          type="number"
          min={0}
          max={10}
          value={configDraft?.[prefix]?.maxRetries ?? 0}
          onChange={e => updateDraft(`${prefix}.maxRetries`, e.target.value)}
          style={{ width: 160 }}
        />
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
          {t('agentDetail.retryAttemptsDesc')}
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 20 }}>
        <label>{t('agentDetail.retryDelayMs')}</label>
        <input
          type="number"
          min={0}
          max={5000}
          value={configDraft?.[prefix]?.baseDelayMs ?? 200}
          onChange={e => updateDraft(`${prefix}.baseDelayMs`, e.target.value)}
          style={{ width: 160 }}
        />
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
          {t('agentDetail.retryDelayMsDesc')}
        </div>
      </div>
      {renderProviderBlock(t('agentDetail.fallbackProvider'), `${prefix}.fallback`, LLM_PROVIDERS)}
    </div>
  );

  const getRetryCount = (llmConfig: any) => getNumericConfig(llmConfig, RETRY_FIELD_PATHS, 'retry.maxRetries', 0).value;
  const getRetryDelay = (llmConfig: any) => getNumericConfig(llmConfig, RETRY_DELAY_FIELD_PATHS, 'retry.baseDelayMs', 200).value;

  const formatProviderSummary = (providerConfig: any) => {
    if (!providerConfig?.provider || providerConfig.provider === 'none') return t('agentDetail.fallbackDisabled');
    return `${providerConfig.provider}${providerConfig.model ? ` / ${providerConfig.model}` : ''}`;
  };

  const renderLlmSummary = (llmConfig: any) => {
    const primary = llmConfig?.primary ?? llmConfig;
    const fallback = llmConfig?.fallback;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>{formatProviderSummary(primary)}</span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t('agentDetail.fallbackSummary', { value: formatProviderSummary(fallback) })}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t('agentDetail.retryAttemptsSummary', { count: getRetryCount(llmConfig) })} · {t('agentDetail.retryDelaySummary', { value: getRetryDelay(llmConfig) })}
        </span>
      </div>
    );
  };

  // ─── Integration sub-tabs ──────────────────────────────────────────────────

  const renderIntegration = () => {
    const cortexUrl = window.location.origin;
    const agentId = id!;
    const authHeaderLine = authEnabled ? `\n  -H "Authorization: Bearer YOUR_TOKEN" \\\\` : '';

    const subTabs: { key: IntegrationTabKey; label: string }[] = [
      { key: 'api', label: t('agentDetail.integrationApi') },
      { key: 'mcp', label: t('agentDetail.integrationMcp') },
      { key: 'openclaw', label: t('agentDetail.integrationOpenclaw') },
    ];

    const authNotice = (
      authEnabled ? (
        <div style={{ margin: '8px 0', padding: '10px 14px', background: 'var(--color-hover)', borderRadius: 8, fontSize: 13, lineHeight: 1.6, border: '1px solid var(--color-border)' }}>
          <span style={{ fontWeight: 600 }}>🔐 {t('agentDetail.tokenNoticeTitle')}</span>
          <br />
          {t('agentDetail.tokenNoticeDesc')}
        </div>
      ) : (
        <div style={{ margin: '8px 0', padding: '10px 14px', background: 'var(--color-hover)', borderRadius: 8, fontSize: 13, lineHeight: 1.6, border: '1px solid var(--color-border)' }}>
          <span style={{ fontWeight: 600 }}>ℹ️ {t('agentDetail.noTokenNoticeTitle')}</span>
          <br />
          {t('agentDetail.noTokenNoticeDesc')}
        </div>
      )
    );

    const renderApiTab = () => (
      <div>
        {authNotice}
        <StepBlock
          step={1}
          title={t('agentDetail.apiStep1Title')}
          description={t('agentDetail.apiStep1Desc')}
          code={`curl ${cortexUrl}/api/v1/health`}
        />
        <StepBlock
          step={2}
          title={t('agentDetail.apiStep2Title')}
          description={t('agentDetail.apiStep2Desc')}
          code={`curl -X POST ${cortexUrl}/api/v1/ingest \\\n  -H "Content-Type: application/json" \\${authHeaderLine}\n  -d '{\n    "user_message": "...",\n    "assistant_message": "...",\n    "agent_id": "${agentId}"\n  }'`}
        />
        <StepBlock
          step={3}
          title={t('agentDetail.apiStep3Title')}
          description={t('agentDetail.apiStep3Desc')}
          code={`curl -X POST ${cortexUrl}/api/v1/recall \\\n  -H "Content-Type: application/json" \\${authHeaderLine}\n  -d '{\n    "query": "What are the user preferences?",\n    "agent_id": "${agentId}"\n  }'`}
        />
        <StepBlock
          step={4}
          title={t('agentDetail.apiStep4Title')}
          description={t('agentDetail.apiStep4Desc')}
          code={`curl -X POST ${cortexUrl}/api/v1/memories \\\n  -H "Content-Type: application/json" \\${authHeaderLine}\n  -d '{\n    "layer": "core",\n    "category": "fact",\n    "content": "...",\n    "agent_id": "${agentId}",\n    "importance": 0.8\n  }'`}
        />
        <StepBlock
          step={5}
          title={t('agentDetail.apiStep5Title')}
          description={t('agentDetail.apiStep5Desc')}
          code={`const CORTEX_URL = '${cortexUrl}';
const AGENT_ID = '${agentId}';${authEnabled ? `\nconst AUTH_TOKEN = 'YOUR_TOKEN';` : ''}

async function recall(query: string) {
  const res = await fetch(\`\${CORTEX_URL}/api/v1/recall\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',${authEnabled ? `\n      'Authorization': \`Bearer \${AUTH_TOKEN}\`,` : ''}
    },
    body: JSON.stringify({ query, agent_id: AGENT_ID }),
  });
  return res.json();
}

async function ingest(userMessage: string, assistantMessage: string) {
  const res = await fetch(\`\${CORTEX_URL}/api/v1/ingest\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',${authEnabled ? `\n      'Authorization': \`Bearer \${AUTH_TOKEN}\`,` : ''}
    },
    body: JSON.stringify({
      user_message: userMessage,
      assistant_message: assistantMessage,
      agent_id: AGENT_ID,
    }),
  });
  return res.json();
}`}
        />
        <StepBlock
          step={6}
          title={t('agentDetail.apiStep6Title')}
          description={t('agentDetail.apiStep6Desc')}
          code={`import requests

CORTEX_URL = "${cortexUrl}"
AGENT_ID = "${agentId}"${authEnabled ? `\nAUTH_TOKEN = "YOUR_TOKEN"` : ''}
HEADERS = {
    "Content-Type": "application/json",${authEnabled ? `\n    "Authorization": f"Bearer {AUTH_TOKEN}",` : ''}
}

def recall(query: str):
    return requests.post(
        f"{CORTEX_URL}/api/v1/recall",
        headers=HEADERS,
        json={"query": query, "agent_id": AGENT_ID},
    ).json()

def ingest(user_msg: str, assistant_msg: str):
    return requests.post(
        f"{CORTEX_URL}/api/v1/ingest",
        headers=HEADERS,
        json={
            "user_message": user_msg,
            "assistant_message": assistant_msg,
            "agent_id": AGENT_ID,
        },
    ).json()`}
          isLast
        />
      </div>
    );

    const mcpConfigs: Record<string, { code: string; pasteDesc: string }> = {
      'claude-desktop': {
        code: JSON.stringify({
          mcpServers: {
            cortex: {
              command: 'npx',
              args: ['@cortexmem/mcp', '--server-url', cortexUrl],
              env: {
                ...(authEnabled ? { CORTEX_AUTH_TOKEN: 'YOUR_TOKEN' } : {}),
                CORTEX_AGENT_ID: agentId,
              },
            },
          },
        }, null, 2),
        pasteDesc: t('agentDetail.mcpStep2ClaudeDesc'),
      },
      'cursor': {
        code: JSON.stringify({
          mcpServers: {
            cortex: {
              command: 'npx',
              args: ['@cortexmem/mcp'],
              env: {
                CORTEX_URL: cortexUrl,
                ...(authEnabled ? { CORTEX_AUTH_TOKEN: 'YOUR_TOKEN' } : {}),
                CORTEX_AGENT_ID: agentId,
              },
            },
          },
        }, null, 2),
        pasteDesc: t('agentDetail.mcpStep2CursorDesc'),
      },
      'claude-code': {
        code: authEnabled
          ? `claude mcp add cortex -e CORTEX_AUTH_TOKEN=YOUR_TOKEN -e CORTEX_AGENT_ID=${agentId} -- npx @cortexmem/mcp --server-url ${cortexUrl}`
          : `claude mcp add cortex -e CORTEX_AGENT_ID=${agentId} -- npx @cortexmem/mcp --server-url ${cortexUrl}`,
        pasteDesc: t('agentDetail.mcpStep2ClaudeCodeDesc'),
      },
      'other': {
        code: JSON.stringify({
          mcpServers: {
            cortex: {
              command: 'npx',
              args: ['@cortexmem/mcp', '--server-url', cortexUrl],
              env: {
                ...(authEnabled ? { CORTEX_AUTH_TOKEN: 'YOUR_TOKEN' } : {}),
                CORTEX_AGENT_ID: agentId,
              },
            },
          },
        }, null, 2),
        pasteDesc: t('agentDetail.mcpStep2OtherDesc'),
      },
    };

    const currentMcp = mcpConfigs[mcpClient]!;

    const renderMcpTab = () => (
      <div>
        <StepBlock
          step={1}
          title={t('agentDetail.mcpStep1Title')}
          description={t('agentDetail.mcpStep1Desc')}
        >
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {([
              ['claude-desktop', t('agentDetail.mcpClaudeDesktop')],
              ['cursor', t('agentDetail.mcpCursor')],
              ['claude-code', t('agentDetail.mcpClaudeCode')],
              ['other', t('agentDetail.mcpOther')],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className="btn"
                style={{
                  padding: '6px 16px', fontSize: 13,
                  background: mcpClient === key ? 'var(--color-primary)' : 'var(--color-base)',
                  color: mcpClient === key ? '#fff' : 'var(--color-text-primary)',
                  border: mcpClient === key ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setMcpClient(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </StepBlock>
        {authNotice}
        <StepBlock
          step={2}
          title={t('agentDetail.mcpStep2Title')}
          description={currentMcp.pasteDesc}
          code={currentMcp.code}
        />
        <StepBlock
          step={3}
          title={t('agentDetail.mcpStep3Title')}
          description={t('agentDetail.mcpStep3Desc')}
        />
        <StepBlock
          step={4}
          title={t('agentDetail.mcpStep4Title')}
          description={t('agentDetail.mcpStep4Desc')}
          isLast
        >
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Tool</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['cortex_recall', t('agentDetail.mcpToolRecall')],
                ['cortex_remember', t('agentDetail.mcpToolRemember')],
                ['cortex_forget', t('agentDetail.mcpToolForget')],
                ['cortex_search_debug', t('agentDetail.mcpToolSearchDebug')],
                ['cortex_stats', t('agentDetail.mcpToolStats')],
              ] as const).map(([tool, desc]) => (
                <tr key={tool}>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{tool}</td>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StepBlock>
      </div>
    );

    const renderOpenclawTab = () => (
      <div>
        {authNotice}
        <StepBlock
          step={1}
          title={t('agentDetail.openclawStep1Title')}
          description={t('agentDetail.openclawStep1Desc')}
          code="openclaw plugins install @cortexmem/cortex-bridge"
        />
        <StepBlock
          step={2}
          title={t('agentDetail.openclawStep2Title')}
          description={t('agentDetail.openclawStep2Desc')}
        >
          {/* Method A: openclaw.json (recommended) */}
          <div style={{ marginBottom: 16, padding: 14, background: 'var(--color-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('agentDetail.openclawJsonMethod')}</div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px 0' }}>{t('agentDetail.openclawJsonMethodDesc')}</p>
            <CodeSnippet title="openclaw.json" code={`{
  "plugins": {
    "cortex-bridge": {
      "enabled": true,
      "config": {
        "cortexUrl": "${cortexUrl}",${authEnabled ? `\n        "authToken": "YOUR_TOKEN",` : ''}
        "agentId": "${agentId}"
      }
    }
  }
}`} />
          </div>
          {/* Method B: .env */}
          <div style={{ padding: 14, background: 'var(--color-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('agentDetail.openclawEnvMethod')}</div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px 0' }}>{t('agentDetail.openclawEnvMethodDesc')}</p>
            <CodeSnippet title=".env" code={`CORTEX_URL=${cortexUrl}${authEnabled ? `\nCORTEX_AUTH_TOKEN=YOUR_TOKEN` : ''}\nCORTEX_AGENT_ID=${agentId}`} />
          </div>
          {/* Method C: shell profile */}
          <div style={{ marginTop: 16, padding: 14, background: 'var(--color-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('agentDetail.openclawShellMethod')}</div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px 0' }}>{t('agentDetail.openclawShellMethodDesc')}</p>
            <CodeSnippet title="~/.zshrc / ~/.bashrc" code={`echo 'export CORTEX_URL=${cortexUrl}' >> ~/.zshrc${authEnabled ? `\necho 'export CORTEX_AUTH_TOKEN=YOUR_TOKEN' >> ~/.zshrc` : ''}\necho 'export CORTEX_AGENT_ID=${agentId}' >> ~/.zshrc`} />
          </div>
        </StepBlock>
        <StepBlock
          step={3}
          title={t('agentDetail.openclawStep3Title')}
          description={t('agentDetail.openclawStep3Desc')}
        >
          <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0 0', paddingLeft: 20, lineHeight: 2 }}>
            <li>{t('agentDetail.openclawHookBefore')}</li>
            <li>{t('agentDetail.openclawHookAfter')}</li>
            <li>{t('agentDetail.openclawHookCompaction')}</li>
            <li>{t('agentDetail.openclawToolRecall')}</li>
            <li>{t('agentDetail.openclawToolRemember')}</li>
            <li>{t('agentDetail.openclawCommand')}</li>
            <li>{t('agentDetail.openclawCommandSearch')}</li>
            <li>{t('agentDetail.openclawCommandRemember')}</li>
            <li>{t('agentDetail.openclawCommandRecent')}</li>
          </ul>
        </StepBlock>
        <StepBlock
          step={4}
          title={t('agentDetail.openclawStep4Title')}
          description={t('agentDetail.openclawStep4Desc')}
          isLast
        />
      </div>
    );

    return (
      <div>
        {/* Sub-tabs */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          {subTabs.map(st => (
            <button
              key={st.key}
              className={`tab${integrationTab === st.key ? ' active' : ''}`}
              onClick={() => setIntegrationTab(st.key)}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {integrationTab === 'api' && renderApiTab()}
        {integrationTab === 'mcp' && renderMcpTab()}
        {integrationTab === 'openclaw' && renderOpenclawTab()}
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (error) return <div className="card" style={{ color: 'var(--color-danger)' }}>{t('common.errorPrefix', { message: error })}</div>;
  if (loading) return <div className="loading">{t('common.loading')}</div>;
  if (!agent) return <div className="card" style={{ color: 'var(--color-danger)' }}>{t('agentDetail.notFound')}</div>;

  const isBuiltIn = agent.id === 'default' || agent.id === 'mcp';
  const stats = agent.stats || { layers: {}, total: 0 };
  const mc = mergedConfig?.config;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 200,
          padding: '12px 20px', borderRadius: 'var(--radius-md)',
          background: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
          color: '#fff', fontSize: 14, fontWeight: 500,
          boxShadow: 'var(--shadow-lg)',
        }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="btn" onClick={() => navigate('/agents')} style={{ padding: '4px 10px', fontSize: 13 }}>
          &larr; {t('agentDetail.backToAgents')}
        </button>
        <h1 className="page-title" style={{ margin: 0 }}>{agent.name}</h1>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-text-secondary)' }}>{agent.id}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
        {(['overview', 'config', 'integration'] as TabKey[]).map(tb => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            style={{
              padding: '10px 20px', fontSize: 14, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: tab === tb ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: tab === tb ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              fontWeight: tab === tb ? 600 : 400,
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            {tb === 'overview' ? t('agentDetail.overview') : tb === 'config' ? t('agentDetail.configuration') : t('agentDetail.integration')}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{t('agentDetail.basicInfo')}</h3>
              {editingInfo ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setEditingInfo(false)}>{t('common.cancel')}</button>
                  <button className="btn primary" onClick={saveInfo}>{t('common.save')}</button>
                </div>
              ) : (
                <button className="btn" onClick={startEditInfo}>{t('common.edit')}</button>
              )}
            </div>

            {editingInfo ? (
              <>
                <div className="form-group">
                  <label>{t('agentDetail.name')}</label>
                  <input type="text" value={infoDraft.name} onChange={e => setInfoDraft(d => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>{t('agentDetail.description')}</label>
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
                  <tr><td style={{ width: '30%' }}>Agent ID</td><td><code style={{ fontSize: 13, padding: '2px 8px', background: 'var(--color-base)', borderRadius: 4 }}>{agent.id}</code></td></tr>
                  <tr><td>{t('agentDetail.name')}</td><td>{agent.name}</td></tr>
                  <tr><td>{t('agentDetail.description')}</td><td>{agent.description || <span style={{ color: 'var(--color-text-secondary)' }}>{t('agentDetail.noDescription')}</span>}</td></tr>
                  <tr><td>{t('agentDetail.created')}</td><td>{new Date(agent.created_at).toLocaleString()}</td></tr>
                  <tr><td>{t('agentDetail.updated')}</td><td>{new Date(agent.updated_at).toLocaleString()}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Memory Stats */}
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>{t('agentDetail.memoryStats')}</h3>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
              {stats.total} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-secondary)' }}>{t('agentDetail.totalMemories')}</span>
            </div>

            {stats.total > 0 && (
              <>
                {/* Layer bar */}
                <div style={{ display: 'flex', height: 24, borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 12 }}>
                  {(['working', 'core', 'archive'] as const).map(layer => {
                    const count = stats.layers[layer] || 0;
                    const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                    if (pct === 0) return null;
                    const colors: Record<string, string> = { working: 'var(--color-warning)', core: 'var(--color-info)', archive: '#6b7280' };
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
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: layer === 'working' ? 'var(--color-warning)' : layer === 'core' ? 'var(--color-info)' : '#6b7280' }} />
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
              <h3 style={{ marginBottom: 12 }}>{t('agentDetail.activeConfig')}</h3>
              {mergedConfig?.has_override && (
                <div style={{ marginBottom: 12 }}>
                  <span className="badge" style={{ background: 'rgba(168,85,247,0.12)', color: '#c084fc' }}>{t('agentDetail.customConfigActive')}</span>
                </div>
              )}
              <table>
                <tbody>
                  <tr><td style={{ width: '30%' }}>{t('agentDetail.extractionLlm')}</td><td>{renderLlmSummary(mc.llm?.extraction)}</td></tr>
                  <tr><td>{t('agentDetail.lifecycleLlm')}</td><td>{renderLlmSummary(mc.llm?.lifecycle)}</td></tr>
                  <tr><td>{t('agentDetail.embedding')}</td><td>{mc.embedding?.provider} / {mc.embedding?.model}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Cortex Hooks Toggle */}
          {!isBuiltIn && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{t('agentDetail.cortexHooks')}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!agent.metadata?.cortex_hooks_disabled}
                    onChange={async (e) => {
                      const disabled = !e.target.checked;
                      try {
                        const updated = await updateAgent(id!, {
                          metadata: { ...agent.metadata, cortex_hooks_disabled: disabled || undefined },
                        });
                        setAgent((prev: any) => ({ ...prev, ...updated }));
                        setToast({ message: disabled ? t('agentDetail.hooksDisabled') : t('agentDetail.hooksEnabled'), type: 'success' });
                      } catch (err: any) {
                        setToast({ message: err.message, type: 'error' });
                      }
                    }}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <span>{agent.metadata?.cortex_hooks_disabled ? t('agentDetail.hooksDisabledStatus') : t('agentDetail.hooksEnabledStatus')}</span>
                </label>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '8px 0 0 0' }}>
                {t('agentDetail.cortexHooksDesc')}
              </p>
            </div>
          )}

          {/* Delete */}
          {!isBuiltIn && (
            <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
              <h3 style={{ marginBottom: 8, color: 'var(--color-danger)' }}>{t('agentDetail.dangerZone')}</h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                {t('agentDetail.deleteWarning')}
              </p>
              <button className="btn" style={{ background: 'var(--color-danger)', color: '#fff', border: 'none' }} onClick={handleDelete}>
                {t('agentDetail.deleteAgent')}
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
              <h3 style={{ margin: 0 }}>{t('agentDetail.configOverride')}</h3>
              {editingConfig ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={resetConfig}>{t('agentDetail.resetToGlobal')}</button>
                  <button className="btn" onClick={() => setEditingConfig(false)}>{t('common.cancel')}</button>
                  <button className="btn primary" onClick={saveConfig}>{t('common.save')}</button>
                </div>
              ) : (
                <button className="btn" onClick={startEditConfig}>{t('common.edit')}</button>
              )}
            </div>

            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
              {t('agentDetail.configOverrideDesc')}
            </p>

            {editingConfig ? (
              <>
                {renderLlmStrategyBlock(t('agentDetail.extractionLlm'), 'extraction')}
                {renderLlmStrategyBlock(t('agentDetail.lifecycleLlm'), 'lifecycle')}
                {renderProviderBlock(t('agentDetail.embedding'), 'embedding', EMBEDDING_PROVIDERS)}
              </>
            ) : (
              <>
                {mc ? (
                  <table>
                    <tbody>
                      <tr>
                        <td style={{ width: '30%' }}>{t('agentDetail.extractionLlm')}</td>
                        <td>
                          {renderLlmSummary(mc.llm?.extraction)}
                          {mergedConfig?.has_override && agent.config_override?.llm?.extraction && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>{t('agentDetail.overridden')}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{t('agentDetail.lifecycleLlm')}</td>
                        <td>
                          {renderLlmSummary(mc.llm?.lifecycle)}
                          {mergedConfig?.has_override && agent.config_override?.llm?.lifecycle && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>{t('agentDetail.overridden')}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{t('agentDetail.embedding')}</td>
                        <td>
                          {mc.embedding?.provider} / {mc.embedding?.model}
                          {mergedConfig?.has_override && agent.config_override?.embedding && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>{t('agentDetail.overridden')}</span>
                          )}
                        </td>
                      </tr>
                      <tr><td>{t('agentDetail.embeddingDimensions')}</td><td>{mc.embedding?.dimensions}</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: 'var(--color-text-secondary)' }}>{t('agentDetail.loadingConfig')}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab: Integration */}
      {tab === 'integration' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>{t('agentDetail.integrationGuide')}</h3>
          {renderIntegration()}
        </div>
      )}
    </div>
  );
}
