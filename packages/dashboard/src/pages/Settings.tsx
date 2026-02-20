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

// ─── Schedule Presets ────────────────────────────────────────────────────────

interface SchedulePreset {
  value: string;
  labelKey: string;
}

const SCHEDULE_PRESETS: SchedulePreset[] = [
  { value: '', labelKey: 'settings.scheduleDisabled' },
  { value: '0 * * * *', labelKey: 'settings.scheduleEveryHour' },
  { value: '0 */6 * * *', labelKey: 'settings.scheduleEvery6Hours' },
  { value: '0 */12 * * *', labelKey: 'settings.scheduleEvery12Hours' },
  { value: '0 0 * * *', labelKey: 'settings.scheduleDailyMidnight' },
  { value: '0 3 * * *', labelKey: 'settings.scheduleDailyAt3' },
  { value: '0 6 * * *', labelKey: 'settings.scheduleDailyAt6' },
];

const SCHEDULE_CUSTOM = '__custom__';

// ─── Duration Helpers ────────────────────────────────────────────────────────

function parseDuration(s: string): { num: string; unit: string } {
  if (!s) return { num: '', unit: 'h' };
  const m = s.match(/^(\d+)\s*(m|h|d)$/i);
  if (m) return { num: m[1], unit: m[2].toLowerCase() };
  const numOnly = s.replace(/[^0-9]/g, '');
  return { num: numOnly || '', unit: 'h' };
}

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

  // ─── Display helpers ──────────────────────────────────────────────────────

  const humanizeDuration = (s: string): string => {
    const { num, unit } = parseDuration(s);
    if (!num) return s || '-';
    const labels: Record<string, string> = {
      m: t('settings.unitMinutes'),
      h: t('settings.unitHours'),
      d: t('settings.unitDays'),
    };
    return `${num} ${labels[unit] || unit}`;
  };

  const humanizeCron = (s: string): string => {
    for (const p of SCHEDULE_PRESETS) {
      if (p.value === s) return t(p.labelKey);
    }
    return s || '-';
  };

  const handleExport = async () => {
    try {
      await triggerExport();
      setToast({ message: t('settings.toastMarkdownExported'), type: 'success' });
    } catch (e: any) {
      setToast({ message: e.message, type: 'error' });
    }
  };

  // ─── Edit lifecycle ────────────────────────────────────────────────────────

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
        recencyBoostWindow: config.search?.recencyBoostWindow ?? '7d',
      }),
      lifecycle: () => {
        const schedule = config.lifecycle?.schedule ?? '0 3 * * *';
        return {
          schedule,
          customSchedule: !SCHEDULE_PRESETS.some(p => p.value === schedule),
          promotionThreshold: config.lifecycle?.promotionThreshold ?? 0.6,
          archiveThreshold: config.lifecycle?.archiveThreshold ?? 0.2,
          decayLambda: config.lifecycle?.decayLambda ?? 0.03,
        };
      },
      layers: () => ({
        working: { ttl: config.layers?.working?.ttl ?? '48h' },
        core: { maxEntries: config.layers?.core?.maxEntries ?? 1000 },
        archive: { ttl: config.layers?.archive?.ttl ?? '90d', compressBackToCore: config.layers?.archive?.compressBackToCore ?? false },
      }),
      gate: () => ({
        maxInjectionTokens: config.gate?.maxInjectionTokens ?? 2000,
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
    // ── Validation ──
    const errors: string[] = [];

    if (section === 'search') {
      const vw = Number(draft.vectorWeight);
      const tw = Number(draft.textWeight);
      if (isNaN(vw) || vw < 0 || vw > 1) errors.push(t('settings.validationWeightRange'));
      if (isNaN(tw) || tw < 0 || tw > 1) errors.push(t('settings.validationWeightRange'));
      const rw = draft.recencyBoostWindow;
      if (rw && !/^\d+[mhd]$/i.test(rw)) errors.push(t('settings.validationDurationFormat'));
    }

    if (section === 'lifecycle') {
      const pt = Number(draft.promotionThreshold);
      const at = Number(draft.archiveThreshold);
      const dl = Number(draft.decayLambda);
      if (isNaN(pt) || pt < 0 || pt > 1) errors.push(t('settings.validationThresholdRange'));
      if (isNaN(at) || at < 0 || at > 1) errors.push(t('settings.validationThresholdRange'));
      if (isNaN(dl) || dl <= 0 || dl > 0.5) errors.push(t('settings.validationDecayRange'));
      if (draft.customSchedule && draft.schedule && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(draft.schedule)) {
        errors.push(t('settings.validationCronFormat'));
      }
    }

    if (section === 'layers') {
      const me = Number(draft.core?.maxEntries);
      if (isNaN(me) || me < 1) errors.push(t('settings.validationPositiveNumber'));
      for (const ttl of [draft.working?.ttl, draft.archive?.ttl]) {
        if (ttl && !/^\d+[mhd]$/i.test(ttl)) errors.push(t('settings.validationDurationFormat'));
      }
    }

    if (section === 'gate') {
      const mit = Number(draft.maxInjectionTokens);
      if (isNaN(mit) || mit < 100 || mit > 50000) errors.push(t('settings.validationTokenRange'));
    }

    if (errors.length > 0) {
      setToast({ message: errors[0], type: 'error' });
      return;
    }

    // ── Build payload ──
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
          hybrid: draft.hybrid,
          vectorWeight: Number(draft.vectorWeight),
          textWeight: Number(draft.textWeight),
          recencyBoostWindow: draft.recencyBoostWindow,
        };
      } else if (section === 'lifecycle') {
        payload.lifecycle = {
          schedule: draft.schedule,
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

  // ─── Draft helpers ─────────────────────────────────────────────────────────

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

  const getDraftValue = (path: string): any => {
    const keys = path.split('.');
    let val: any = draft;
    for (const k of keys) val = val?.[k];
    return val;
  };

  const isEditing = (section: SectionKey) => editingSection === section;

  // ─── Shared UI helpers ─────────────────────────────────────────────────────

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

  const fieldDesc = (text: string) => (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{text}</div>
  );

  // ─── Enhanced render helpers ───────────────────────────────────────────────

  const renderSlider = (label: string, desc: string, path: string, min: number, max: number, step: number) => {
    const val = Number(getDraftValue(path)) || min;
    const decimals = step < 0.01 ? 3 : 2;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ fontWeight: 500 }}>{label}</label>
          <span style={{
            fontSize: 14, fontWeight: 600, fontFamily: 'monospace',
            background: 'var(--bg)', padding: '2px 10px', borderRadius: 4,
            border: '1px solid var(--border)',
          }}>{val.toFixed(decimals)}</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={val}
          onChange={e => updateDraft(path, parseFloat(e.target.value))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          <span>{min}</span>
          <span>{max}</span>
        </div>
        {fieldDesc(desc)}
      </div>
    );
  };

  const renderLinkedWeights = () => {
    const vw = Number(draft.vectorWeight) || 0;
    const tw = Number(draft.textWeight) || 0;
    const sumOk = Math.abs(vw + tw - 1.0) < 0.011;

    const handleChange = (field: 'vectorWeight' | 'textWeight', val: number) => {
      setDraft((prev: any) => ({
        ...prev,
        [field]: val,
        [field === 'vectorWeight' ? 'textWeight' : 'vectorWeight']:
          Math.round((1 - val) * 100) / 100,
      }));
    };

    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('settings.searchBalance')}</label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', background: 'var(--bg)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{t('settings.textWeight')}</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{tw.toFixed(2)}</div>
          </div>
          <input
            type="range" min={0} max={1} step={0.05} value={vw}
            onChange={e => handleChange('vectorWeight', parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <div style={{ textAlign: 'center', minWidth: 70 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{t('settings.vectorWeight')}</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{vw.toFixed(2)}</div>
          </div>
        </div>
        {!sumOk && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
            {t('settings.validationWeightsSum')}
          </div>
        )}
        {fieldDesc(t('settings.searchBalanceDesc'))}
      </div>
    );
  };

  const renderDuration = (label: string, desc: string, path: string) => {
    const raw = (getDraftValue(path) as string) || '';
    const { num, unit } = parseDuration(raw);
    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 500, marginBottom: 6, display: 'block' }}>{label}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number" min="1" value={num}
            onChange={e => updateDraft(path, `${e.target.value}${unit}`)}
            style={{ width: 100 }}
          />
          <select
            value={unit}
            onChange={e => updateDraft(path, `${num}${e.target.value}`)}
            style={{ width: 'auto' }}
          >
            <option value="m">{t('settings.unitMinutes')}</option>
            <option value="h">{t('settings.unitHours')}</option>
            <option value="d">{t('settings.unitDays')}</option>
          </select>
        </div>
        {fieldDesc(desc)}
      </div>
    );
  };

  const renderSchedule = () => {
    const schedule = draft.schedule || '';
    const isCustom = draft.customSchedule === true;
    const presetValue = isCustom ? SCHEDULE_CUSTOM : schedule;

    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 500, marginBottom: 6, display: 'block' }}>{t('settings.scheduleLabel')}</label>
        <select
          value={presetValue}
          onChange={e => {
            if (e.target.value === SCHEDULE_CUSTOM) {
              updateDraft('customSchedule', true);
            } else {
              setDraft((prev: any) => ({
                ...prev,
                schedule: e.target.value,
                customSchedule: false,
              }));
            }
          }}
        >
          {SCHEDULE_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{t(p.labelKey)}</option>
          ))}
          <option value={SCHEDULE_CUSTOM}>{t('settings.scheduleCustom')}</option>
        </select>
        {isCustom && (
          <input
            type="text" value={schedule} placeholder="0 3 * * *"
            onChange={e => updateDraft('schedule', e.target.value)}
            style={{ marginTop: 8, fontFamily: 'monospace' }}
          />
        )}
        {fieldDesc(t('settings.scheduleDesc'))}
      </div>
    );
  };

  const renderNumberField = (label: string, desc: string, path: string, min?: number, max?: number) => {
    const val = getDraftValue(path);
    return (
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontWeight: 500, marginBottom: 6, display: 'block' }}>{label}</label>
        <input
          type="number" value={val ?? ''} min={min} max={max}
          onChange={e => updateDraft(path, e.target.value)}
          style={{ width: 160 }}
        />
        {fieldDesc(desc)}
      </div>
    );
  };

  const renderToggleField = (label: string, desc: string, path: string) => {
    const val = getDraftValue(path);
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontWeight: 500 }}>{label}</label>
          <div
            onClick={() => updateDraft(path, !val)}
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
        </div>
        {fieldDesc(desc)}
      </div>
    );
  };

  // ─── LLM Provider Row (reusable for extraction, lifecycle, embedding) ──────

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

  // ─── Read-only display row ─────────────────────────────────────────────────

  const displayRow = (label: string, value: any, desc?: string) => (
    <tr>
      <td style={{ verticalAlign: 'top', width: '40%', paddingTop: 8, paddingBottom: 8 }}>
        <div>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
      </td>
      <td style={{ paddingTop: 8, paddingBottom: 8 }}>{value}</td>
    </tr>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

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
        {isEditing('search') ? (
          <div style={{ padding: '4px 0' }}>
            {renderToggleField(t('settings.hybridSearch'), t('settings.hybridSearchDesc'), 'hybrid')}
            {renderLinkedWeights()}
            {renderDuration(t('settings.recencyBoostWindow'), t('settings.recencyBoostWindowDesc'), 'recencyBoostWindow')}
          </div>
        ) : (
          <table>
            <tbody>
              {displayRow(t('settings.hybridSearch'), config.search?.hybrid ? t('common.on') : t('common.off'), t('settings.hybridSearchDesc'))}
              {displayRow(t('settings.vectorWeight'), config.search?.vectorWeight?.toFixed(2))}
              {displayRow(t('settings.textWeight'), config.search?.textWeight?.toFixed(2))}
              {displayRow(t('settings.recencyBoostWindow'), humanizeDuration(config.search?.recencyBoostWindow), t('settings.recencyBoostWindowDesc'))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Lifecycle ── */}
      <div className="card">
        {sectionHeader(t('settings.lifecycleTitle'), 'lifecycle')}
        {isEditing('lifecycle') ? (
          <div style={{ padding: '4px 0' }}>
            {renderSchedule()}
            {renderSlider(
              t('settings.promotionThreshold'),
              t('settings.promotionThresholdDesc'),
              'promotionThreshold', 0, 1, 0.05,
            )}
            {renderSlider(
              t('settings.archiveThreshold'),
              t('settings.archiveThresholdDesc'),
              'archiveThreshold', 0, 1, 0.05,
            )}
            {renderSlider(
              t('settings.decayLambda'),
              t('settings.decayLambdaDesc'),
              'decayLambda', 0.001, 0.2, 0.001,
            )}
          </div>
        ) : (
          <table>
            <tbody>
              {displayRow(t('settings.scheduleLabel'), humanizeCron(config.lifecycle?.schedule), t('settings.scheduleDesc'))}
              {displayRow(t('settings.promotionThreshold'), config.lifecycle?.promotionThreshold?.toFixed(2), t('settings.promotionThresholdDesc'))}
              {displayRow(t('settings.archiveThreshold'), config.lifecycle?.archiveThreshold?.toFixed(2), t('settings.archiveThresholdDesc'))}
              {displayRow(t('settings.decayLambda'), config.lifecycle?.decayLambda?.toFixed(3), t('settings.decayLambdaDesc'))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Layers ── */}
      <div className="card">
        {sectionHeader(t('settings.layersTitle'), 'layers')}
        {isEditing('layers') ? (
          <div style={{ padding: '4px 0' }}>
            {renderDuration(t('settings.workingTtl'), t('settings.workingTtlDesc'), 'working.ttl')}
            {renderNumberField(t('settings.coreMaxEntries'), t('settings.coreMaxEntriesDesc'), 'core.maxEntries', 1, 100000)}
            {renderDuration(t('settings.archiveTtl'), t('settings.archiveTtlDesc'), 'archive.ttl')}
            {renderToggleField(t('settings.archiveCompressBack'), t('settings.archiveCompressBackDesc'), 'archive.compressBackToCore')}
          </div>
        ) : (
          <table>
            <tbody>
              {displayRow(t('settings.workingTtl'), humanizeDuration(config.layers?.working?.ttl), t('settings.workingTtlDesc'))}
              {displayRow(t('settings.coreMaxEntries'), config.layers?.core?.maxEntries, t('settings.coreMaxEntriesDesc'))}
              {displayRow(t('settings.archiveTtl'), humanizeDuration(config.layers?.archive?.ttl), t('settings.archiveTtlDesc'))}
              {displayRow(t('settings.archiveCompressBack'), config.layers?.archive?.compressBackToCore ? t('common.on') : t('common.off'), t('settings.archiveCompressBackDesc'))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Gate ── */}
      <div className="card">
        {sectionHeader(t('settings.gateTitle'), 'gate')}
        {isEditing('gate') ? (
          <div style={{ padding: '4px 0' }}>
            {renderNumberField(t('settings.maxInjectionTokens'), t('settings.maxInjectionTokensDesc'), 'maxInjectionTokens', 100, 50000)}
            {renderToggleField(t('settings.skipSmallTalk'), t('settings.skipSmallTalkDesc'), 'skipSmallTalk')}
          </div>
        ) : (
          <table>
            <tbody>
              {displayRow(t('settings.maxInjectionTokens'), config.gate?.maxInjectionTokens, t('settings.maxInjectionTokensDesc'))}
              {displayRow(t('settings.skipSmallTalk'), config.gate?.skipSmallTalk ? t('common.on') : t('common.off'), t('settings.skipSmallTalkDesc'))}
            </tbody>
          </table>
        )}
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
                const data = await triggerExport('markdown');
                const blob = new Blob([data.content], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `cortex-export-${new Date().toISOString().slice(0, 10)}.md`; a.click();
                URL.revokeObjectURL(url);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3>{t('settings.fullConfig')}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e: any) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const parsed = JSON.parse(text);
                  // Strip read-only / sensitive fields that shouldn't be imported
                  delete parsed.port;
                  delete parsed.host;
                  delete parsed.storage;
                  delete parsed.auth;
                  delete parsed.cors;
                  delete parsed.rateLimit;
                  delete parsed.vectorBackend;
                  // Strip masked apiKey fields (hasApiKey: true but no real key)
                  for (const key of ['extraction', 'lifecycle']) {
                    if (parsed.llm?.[key]?.hasApiKey !== undefined) {
                      delete parsed.llm[key].hasApiKey;
                      if (!parsed.llm[key].apiKey) delete parsed.llm[key].apiKey;
                    }
                  }
                  if (parsed.embedding?.hasApiKey !== undefined) {
                    delete parsed.embedding.hasApiKey;
                    if (!parsed.embedding.apiKey) delete parsed.embedding.apiKey;
                  }
                  if (!confirm(t('settings.confirmImportConfig'))) return;
                  await updateConfig(parsed);
                  const refreshed = await getConfig();
                  setConfig(refreshed);
                  setToast({ message: t('settings.toastConfigImported'), type: 'success' });
                } catch (e: any) {
                  setToast({ message: t('settings.toastConfigImportFailed', { message: e.message }), type: 'error' });
                }
              };
              input.click();
            }}>{t('settings.importConfig')}</button>
            <button className="btn" onClick={() => {
              const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `cortex-config-${new Date().toISOString().slice(0, 10)}.json`; a.click();
              URL.revokeObjectURL(url);
              setToast({ message: t('settings.toastJsonExported'), type: 'success' });
            }}>{t('settings.exportJson')}</button>
          </div>
        </div>
        <pre className="json-debug">{JSON.stringify(config, null, 2)}</pre>
      </div>
    </div>
  );
}
