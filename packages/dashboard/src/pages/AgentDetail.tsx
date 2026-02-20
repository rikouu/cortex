import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAgent, updateAgent, deleteAgent, getAgentConfig } from '../api/client.js';
import { useI18n } from '../i18n/index.js';

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
  const { t } = useI18n();

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
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: isLast ? 0 : 24, position: 'relative' }}>
      {/* Left: step number + vertical line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--primary)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 600, flexShrink: 0,
        }}>
          {step}
        </div>
        {!isLast && (
          <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4 }} />
        )}
      </div>

      {/* Right: content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: description || code || children ? 8 : 0 }}>
          {title}
        </div>
        {description && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
            {description}
          </p>
        )}
        {code && (
          <div style={{ position: 'relative' }}>
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
  const [mcpClient, setMcpClient] = useState<'claude-desktop' | 'cursor' | 'claude-code'>('claude-desktop');
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
                  {d.hasApiKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--success)' }}>{t('common.configured')}</span>}
                  {!d.hasApiKey && preset.envKey && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>env: {preset.envKey}</span>}
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

  // ─── Integration sub-tabs ──────────────────────────────────────────────────

  const renderIntegration = () => {
    const cortexUrl = window.location.origin;
    const agentId = id!;

    const subTabs: { key: IntegrationTabKey; label: string }[] = [
      { key: 'api', label: t('agentDetail.integrationApi') },
      { key: 'mcp', label: t('agentDetail.integrationMcp') },
      { key: 'openclaw', label: t('agentDetail.integrationOpenclaw') },
    ];

    const renderApiTab = () => (
      <div>
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
          code={`curl -X POST ${cortexUrl}/api/v1/ingest \\
  -H "Content-Type: application/json" \\
  -d '{"user_message":"...","assistant_message":"...","agent_id":"${agentId}"}'`}
        />
        <StepBlock
          step={3}
          title={t('agentDetail.apiStep3Title')}
          description={t('agentDetail.apiStep3Desc')}
          code={`curl -X POST ${cortexUrl}/api/v1/recall \\
  -H "Content-Type: application/json" \\
  -d '{"query":"What are the user preferences?","agent_id":"${agentId}"}'`}
        />
        <StepBlock
          step={4}
          title={t('agentDetail.apiStep4Title')}
          description={t('agentDetail.apiStep4Desc')}
          code={`curl -X POST ${cortexUrl}/api/v1/memories \\
  -H "Content-Type: application/json" \\
  -d '{"layer":"core","category":"fact","content":"...","agent_id":"${agentId}","importance":0.8}'`}
        />
        <StepBlock
          step={5}
          title={t('agentDetail.apiStep5Title')}
          description={t('agentDetail.apiStep5Desc')}
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
        <StepBlock
          step={6}
          title={t('agentDetail.apiStep6Title')}
          description={t('agentDetail.apiStep6Desc')}
          code={`import requests
CORTEX_URL = "${cortexUrl}"
AGENT_ID = "${agentId}"

def recall(query: str):
    return requests.post(f"{CORTEX_URL}/api/v1/recall",
        json={"query": query, "agent_id": AGENT_ID}).json()

def ingest(user_msg: str, assistant_msg: str):
    return requests.post(f"{CORTEX_URL}/api/v1/ingest",
        json={"user_message": user_msg, "assistant_message": assistant_msg, "agent_id": AGENT_ID}).json()`}
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
              args: ['cortex-mcp', '--server-url', cortexUrl],
              env: { CORTEX_AGENT_ID: agentId },
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
              args: ['cortex-mcp'],
              env: { CORTEX_URL: cortexUrl, CORTEX_AGENT_ID: agentId },
            },
          },
        }, null, 2),
        pasteDesc: t('agentDetail.mcpStep2CursorDesc'),
      },
      'claude-code': {
        code: `claude mcp add cortex -- npx cortex-mcp --server-url ${cortexUrl}`,
        pasteDesc: t('agentDetail.mcpStep2ClaudeCodeDesc'),
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
            ] as const).map(([key, label]) => (
              <button
                key={key}
                className="btn"
                style={{
                  padding: '6px 16px', fontSize: 13,
                  background: mcpClient === key ? 'var(--primary)' : 'var(--bg)',
                  color: mcpClient === key ? '#fff' : 'var(--text)',
                  border: mcpClient === key ? '1px solid var(--primary)' : '1px solid var(--border)',
                }}
                onClick={() => setMcpClient(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </StepBlock>
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
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>Tool</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>Description</th>
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
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{tool}</td>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StepBlock>
      </div>
    );

    const renderOpenclawTab = () => (
      <div>
        <StepBlock
          step={1}
          title={t('agentDetail.openclawStep1Title')}
          description={t('agentDetail.openclawStep1Desc')}
          code="openclaw plugins install @cortexmem/bridge-openclaw"
        />
        <StepBlock
          step={2}
          title={t('agentDetail.openclawStep2Title')}
          description={t('agentDetail.openclawStep2Desc')}
          code={`CORTEX_URL=${cortexUrl}`}
        />
        <StepBlock
          step={3}
          title={t('agentDetail.openclawStep3Title')}
          description={t('agentDetail.openclawStep3Desc')}
        >
          <ul style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0 0', paddingLeft: 20, lineHeight: 2 }}>
            <li>{t('agentDetail.openclawHookBefore')}</li>
            <li>{t('agentDetail.openclawHookAfter')}</li>
            <li>{t('agentDetail.openclawHookCompaction')}</li>
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

  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>{t('common.errorPrefix', { message: error })}</div>;
  if (loading) return <div className="loading">{t('common.loading')}</div>;
  if (!agent) return <div className="card" style={{ color: 'var(--danger)' }}>{t('agentDetail.notFound')}</div>;

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
          &larr; {t('agentDetail.backToAgents')}
        </button>
        <h1 className="page-title" style={{ margin: 0 }}>{agent.name}</h1>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)' }}>{agent.id}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {(['overview', 'config', 'integration'] as TabKey[]).map(tb => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            style={{
              padding: '10px 20px', fontSize: 14, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: tab === tb ? '2px solid var(--primary)' : '2px solid transparent',
              color: tab === tb ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: tab === tb ? 600 : 400,
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
                  <tr><td style={{ width: '30%' }}>{t('agentDetail.name')}</td><td>{agent.name}</td></tr>
                  <tr><td>{t('agentDetail.description')}</td><td>{agent.description || <span style={{ color: 'var(--text-muted)' }}>{t('agentDetail.noDescription')}</span>}</td></tr>
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
              {stats.total} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>{t('agentDetail.totalMemories')}</span>
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
              <h3 style={{ marginBottom: 12 }}>{t('agentDetail.activeConfig')}</h3>
              {mergedConfig?.has_override && (
                <div style={{ marginBottom: 12 }}>
                  <span className="badge" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc' }}>{t('agentDetail.customConfigActive')}</span>
                </div>
              )}
              <table>
                <tbody>
                  <tr><td style={{ width: '30%' }}>{t('agentDetail.extractionLlm')}</td><td>{mc.llm?.extraction?.provider} / {mc.llm?.extraction?.model}</td></tr>
                  <tr><td>{t('agentDetail.lifecycleLlm')}</td><td>{mc.llm?.lifecycle?.provider} / {mc.llm?.lifecycle?.model}</td></tr>
                  <tr><td>{t('agentDetail.embedding')}</td><td>{mc.embedding?.provider} / {mc.embedding?.model}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Delete */}
          {!isBuiltIn && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <h3 style={{ marginBottom: 8, color: 'var(--danger)' }}>{t('agentDetail.dangerZone')}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('agentDetail.deleteWarning')}
              </p>
              <button className="btn" style={{ background: 'var(--danger)', color: '#fff', border: 'none' }} onClick={handleDelete}>
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

            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              {t('agentDetail.configOverrideDesc')}
            </p>

            {editingConfig ? (
              <>
                {renderProviderBlock(t('agentDetail.extractionLlm'), 'extraction', LLM_PROVIDERS)}
                {renderProviderBlock(t('agentDetail.lifecycleLlm'), 'lifecycle', LLM_PROVIDERS)}
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
                          {mc.llm?.extraction?.provider} / {mc.llm?.extraction?.model}
                          {mergedConfig?.has_override && agent.config_override?.llm?.extraction && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: '#c084fc' }}>{t('agentDetail.overridden')}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>{t('agentDetail.lifecycleLlm')}</td>
                        <td>
                          {mc.llm?.lifecycle?.provider} / {mc.llm?.lifecycle?.model}
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
                  <div style={{ color: 'var(--text-muted)' }}>{t('agentDetail.loadingConfig')}</div>
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
