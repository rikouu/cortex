import React, { useEffect, useState } from 'react';
import { getConfig, updateConfig, testLLM, testEmbedding } from '../../api/client.js';
import { useI18n } from '../../i18n/index.js';
import {
  SectionKey,
  LLM_PROVIDERS,
  EMBEDDING_PROVIDERS,
  EMBEDDING_DIMENSIONS,
  CUSTOM_MODEL,
  SCHEDULE_PRESETS,
  SCHEDULE_CUSTOM,
  ProviderPreset,
  parseDuration,
} from './types.js';
import LlmSection from './sections/LlmSection.js';
import SearchSection from './sections/SearchSection.js';
import LifecycleSection from './sections/LifecycleSection.js';
import LayersSection from './sections/LayersSection.js';
import GateSection from './sections/GateSection.js';
import SieveSection from './sections/SieveSection.js';
import DataManagement from './sections/DataManagement.js';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [testState, setTestState] = useState<Record<string, { status: 'idle' | 'testing' | 'success' | 'error'; message?: string; latency?: number }>>({});
  const { t } = useI18n();

  useEffect(() => {
    getConfig().then(setConfig).catch((e: any) => setError(e.message));
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
        reranker: {
          enabled: config.search?.reranker?.enabled ?? false,
          provider: config.search?.reranker?.provider ?? 'none',
          apiKey: config.search?.reranker?.apiKey ?? '',
          topN: config.search?.reranker?.topN ?? 10,
          weight: config.search?.reranker?.weight ?? 0.5,
        },
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
        maxInjectionTokens: config.gate?.maxInjectionTokens ?? 4000,
        skipSmallTalk: config.gate?.skipSmallTalk ?? false,
        searchLimit: config.gate?.searchLimit ?? 30,
        queryExpansion: {
          enabled: config.gate?.queryExpansion?.enabled ?? false,
          maxVariants: config.gate?.queryExpansion?.maxVariants ?? 3,
        },
      }),
      sieve: () => ({
        fastChannelEnabled: config.sieve?.fastChannelEnabled ?? true,
        contextMessages: config.sieve?.contextMessages ?? 4,
        maxConversationChars: config.sieve?.maxConversationChars ?? 6000,
        smartUpdate: config.sieve?.smartUpdate ?? true,
        similarityThreshold: config.sieve?.similarityThreshold ?? 0.35,
        exactDupThreshold: config.sieve?.exactDupThreshold ?? 0.08,
        relationExtraction: config.sieve?.relationExtraction ?? true,
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

    if (section === 'sieve') {
      const cm = Number(draft.contextMessages);
      if (isNaN(cm) || cm < 2 || cm > 20) errors.push(t('settings.validationPositiveNumber'));
      const st = Number(draft.similarityThreshold);
      if (isNaN(st) || st < 0.1 || st > 0.8) errors.push(t('settings.validationThresholdRange'));
      const edt = Number(draft.exactDupThreshold);
      if (isNaN(edt) || edt < 0.01 || edt > 0.2) errors.push(t('settings.validationThresholdRange'));
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
            baseUrl: d.baseUrl || '',
          };
          if (d.apiKey) out.apiKey = d.apiKey;
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
          baseUrl: draft.embedding.baseUrl || '',
        };
        if (draft.embedding.apiKey) embOut.apiKey = draft.embedding.apiKey;
        payload.embedding = embOut;
      } else if (section === 'search') {
        payload.search = {
          hybrid: draft.hybrid,
          vectorWeight: Number(draft.vectorWeight),
          textWeight: Number(draft.textWeight),
          recencyBoostWindow: draft.recencyBoostWindow,
          reranker: {
            enabled: draft.reranker?.enabled ?? false,
            provider: draft.reranker?.provider ?? 'none',
            ...(draft.reranker?.apiKey ? { apiKey: draft.reranker.apiKey } : {}),
            topN: Number(draft.reranker?.topN ?? 10),
            weight: Number(draft.reranker?.weight ?? 0.5),
          },
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
          searchLimit: Number(draft.searchLimit),
          queryExpansion: {
            enabled: draft.queryExpansion?.enabled ?? false,
            maxVariants: Number(draft.queryExpansion?.maxVariants ?? 3),
          },
        };
      } else if (section === 'sieve') {
        payload.sieve = {
          fastChannelEnabled: draft.fastChannelEnabled,
          contextMessages: Number(draft.contextMessages),
          maxConversationChars: Number(draft.maxConversationChars),
          smartUpdate: draft.smartUpdate,
          similarityThreshold: Number(draft.similarityThreshold),
          exactDupThreshold: Number(draft.exactDupThreshold),
          relationExtraction: draft.relationExtraction,
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

  // ─── Test connection handlers ─────────────────────────────────────────────

  const handleTestLLM = async (target: 'extraction' | 'lifecycle') => {
    const key = `llm.${target}`;
    setTestState(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      const res = await testLLM(target);
      if (res.ok) {
        setTestState(prev => ({ ...prev, [key]: { status: 'success', latency: res.latency_ms } }));
      } else {
        setTestState(prev => ({ ...prev, [key]: { status: 'error', message: res.error || 'Unknown error' } }));
      }
    } catch (e: any) {
      setTestState(prev => ({ ...prev, [key]: { status: 'error', message: e.message } }));
    }
  };

  const handleTestEmbedding = async () => {
    const key = 'embedding';
    setTestState(prev => ({ ...prev, [key]: { status: 'testing' } }));
    try {
      const res = await testEmbedding();
      if (res.ok) {
        setTestState(prev => ({ ...prev, [key]: { status: 'success', latency: res.latency_ms } }));
      } else {
        setTestState(prev => ({ ...prev, [key]: { status: 'error', message: res.error || 'Unknown error' } }));
      }
    } catch (e: any) {
      setTestState(prev => ({ ...prev, [key]: { status: 'error', message: e.message } }));
    }
  };

  // ─── LLM Provider Block ───────────────────────────────────────────────────

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
      // Auto-update dimensions for embedding models
      if (d.dimensions !== undefined && firstModel && EMBEDDING_DIMENSIONS[firstModel]) {
        updateDraft(`${prefix}.dimensions`, EMBEDDING_DIMENSIONS[firstModel]);
      }
    };

    const handleModelSelectChange = (val: string) => {
      if (val === CUSTOM_MODEL) {
        updateDraft(`${prefix}.useCustomModel`, true);
        updateDraft(`${prefix}.customModel`, d.model ?? '');
      } else {
        updateDraft(`${prefix}.useCustomModel`, false);
        updateDraft(`${prefix}.model`, val);
        // Auto-update dimensions for embedding models
        if (d.dimensions !== undefined && EMBEDDING_DIMENSIONS[val]) {
          updateDraft(`${prefix}.dimensions`, EMBEDDING_DIMENSIONS[val]);
        }
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
            {d.dimensions !== undefined && (() => {
              const currentModel = isCustomModel ? (d.customModel ?? '') : (d.model ?? '');
              const recommended = EMBEDDING_DIMENSIONS[currentModel];
              const currentDim = Number(d.dimensions);
              const mismatch = recommended && currentDim !== recommended;
              return (
                <div className="form-group">
                  <label>
                    {t('settings.dimensions')}
                    {recommended && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                        {t('settings.dimensionRecommended', { value: recommended })}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={d.dimensions ?? ''}
                    onChange={e => updateDraft(`${prefix}.dimensions`, e.target.value)}
                  />
                  {mismatch && (
                    <div style={{
                      marginTop: 8, padding: '8px 12px',
                      background: 'rgba(255,170,0,0.1)', border: '1px solid rgba(255,170,0,0.3)',
                      borderRadius: 4, fontSize: 12, color: '#b8860b', lineHeight: 1.5
                    }}>
                      {t('settings.dimensionMismatch', { model: currentModel, recommended })}
                    </div>
                  )}
                  <div style={{
                    marginTop: 8, padding: '8px 12px',
                    background: 'rgba(255,170,0,0.1)', border: '1px solid rgba(255,170,0,0.3)',
                    borderRadius: 4, fontSize: 12, color: '#b8860b', lineHeight: 1.5
                  }}>
                    {t('settings.dimensionWarning')}
                  </div>
                </div>
              );
            })()}

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

      <LlmSection
        config={config}
        editing={isEditing('llm')}
        sectionHeader={sectionHeader}
        renderProviderBlock={renderProviderBlock}
        testState={testState}
        handleTestLLM={handleTestLLM}
        handleTestEmbedding={handleTestEmbedding}
        t={t}
      />

      <SearchSection
        config={config}
        editing={isEditing('search')}
        draft={draft}
        setDraft={setDraft}
        sectionHeader={sectionHeader}
        displayRow={displayRow}
        renderToggleField={renderToggleField}
        renderLinkedWeights={renderLinkedWeights}
        renderDuration={renderDuration}
        humanizeDuration={humanizeDuration}
        t={t}
      />

      <LifecycleSection
        config={config}
        editing={isEditing('lifecycle')}
        sectionHeader={sectionHeader}
        displayRow={displayRow}
        renderSchedule={renderSchedule}
        renderSlider={renderSlider}
        humanizeCron={humanizeCron}
        t={t}
      />

      <LayersSection
        config={config}
        editing={isEditing('layers')}
        sectionHeader={sectionHeader}
        displayRow={displayRow}
        renderDuration={renderDuration}
        renderNumberField={renderNumberField}
        renderToggleField={renderToggleField}
        humanizeDuration={humanizeDuration}
        t={t}
      />

      <GateSection
        config={config}
        editing={isEditing('gate')}
        draft={draft}
        setDraft={setDraft}
        sectionHeader={sectionHeader}
        displayRow={displayRow}
        renderNumberField={renderNumberField}
        renderToggleField={renderToggleField}
        t={t}
      />

      <SieveSection
        config={config}
        editing={isEditing('sieve')}
        sectionHeader={sectionHeader}
        displayRow={displayRow}
        renderToggleField={renderToggleField}
        renderNumberField={renderNumberField}
        renderSlider={renderSlider}
        t={t}
      />

      <DataManagement
        config={config}
        setConfig={setConfig}
        setToast={setToast}
        t={t}
      />
    </div>
  );
}
