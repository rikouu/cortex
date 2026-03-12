import React from 'react';
import { SectionKey } from '../types.js';

interface SearchSectionProps {
  config: any;
  editing: boolean;
  draft: any;
  setDraft: React.Dispatch<React.SetStateAction<any>>;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  renderLinkedWeights: () => React.ReactNode;
  renderDuration: (label: string, desc: string, path: string) => React.ReactNode;
  humanizeDuration: (s: string) => string;
  t: (key: string, params?: any) => string;
}

export default function SearchSection({
  config, editing, draft, setDraft, sectionHeader, displayRow,
  renderToggleField, renderLinkedWeights, renderDuration, humanizeDuration, t,
}: SearchSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.searchTitle'), 'search')}
      {editing ? (
        <div style={{ padding: '4px 0' }}>
          {renderToggleField(t('settings.hybridSearch'), t('settings.hybridSearchDesc'), 'hybrid')}
          {renderLinkedWeights()}
          {renderDuration(t('settings.recencyBoostWindow'), t('settings.recencyBoostWindowDesc'), 'recencyBoostWindow')}

          {/* Min Similarity Threshold */}
          <div style={{ margin: '12px 0' }}>
            <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
              🎚️ {t('settings.minSimilarity')} — {((draft?.minSimilarity ?? 0.2) * 100).toFixed(0)}%
            </label>
            <input
              type="range" min="0" max="0.8" step="0.05"
              value={draft?.minSimilarity ?? 0.2}
              onChange={e => setDraft((d: any) => ({ ...d, minSimilarity: Number(e.target.value) }))}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('settings.minSimilarityDesc')}</div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>🔍 {t('settings.searchEnhancement')}</label>

            {renderToggleField(`🎯 ${t('settings.rerankerTitle')}`, t('settings.rerankerDesc'), 'reranker.enabled')}

            {draft?.reranker?.enabled && (
              <div style={{ marginLeft: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  💡 {t('settings.rerankerConfigHint')}
                </div>

                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>{t('settings.rerankerTopN')}</label>
                <input
                  type="number"
                  value={draft?.reranker?.topN ?? 10}
                  onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, topN: Number(e.target.value) } }))}
                  min={3} max={20} style={{ width: 80 }}
                />

                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                    {t('settings.rerankerScoreFusion')} — {t('settings.rerankerTitle')} : Original = {((draft?.reranker?.weight ?? 0.5) * 100).toFixed(0)}% : {((1 - (draft?.reranker?.weight ?? 0.5)) * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    value={draft?.reranker?.weight ?? 0.5}
                    onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, weight: Number(e.target.value) } }))}
                    min={0} max={1} step={0.05} style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>{t('settings.rerankerTrustOriginal')}</span>
                    <span>{t('settings.rerankerTrustReranker')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow(t('settings.hybridSearch'), config.search?.hybrid ? t('common.on') : t('common.off'), t('settings.hybridSearchDesc'))}
            {displayRow(t('settings.vectorWeight'), config.search?.vectorWeight?.toFixed(2))}
            {displayRow(t('settings.textWeight'), config.search?.textWeight?.toFixed(2))}
            {displayRow(t('settings.recencyBoostWindow'), humanizeDuration(config.search?.recencyBoostWindow), t('settings.recencyBoostWindowDesc'))}
            {displayRow(`🎚️ ${t('settings.minSimilarity')}`, `${((config.search?.minSimilarity ?? 0.2) * 100).toFixed(0)}%`, t('settings.minSimilarityDesc'))}
            {displayRow(t('settings.rerankerTitle'), config.search?.reranker?.enabled ? `On (top ${config.search.reranker.topN}, weight ${((config.search.reranker.weight ?? 0.5) * 100).toFixed(0)}%)` : 'Off')}
          </tbody>
        </table>
      )}
    </div>
  );
}
