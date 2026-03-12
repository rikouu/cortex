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
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>🔍 Search Enhancement</label>

            {renderToggleField('🎯 Reranker', 'After search, LLM re-scores all results for query-specific relevance. Final score = reranker × weight + original × (1-weight). Adds ~2-3s latency, 1 LLM call.', 'reranker.enabled')}

            {draft?.reranker?.enabled && (
              <div style={{ marginLeft: 16 }}>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Provider</label>
                <select
                  value={draft?.reranker?.provider ?? 'none'}
                  onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, provider: e.target.value } }))}
                  style={{ width: '100%', marginBottom: 8 }}
                >
                  <option value="llm">LLM (uses extraction model)</option>
                  <option value="cohere">Cohere (rerank-v3.5)</option>
                  <option value="voyage">Voyage AI (rerank-2.5) — 200M free tokens</option>
                  <option value="jina">Jina AI (multilingual) — 1M free tokens</option>
                  <option value="siliconflow">SiliconFlow (开源模型)</option>
                  <option value="none">Disabled</option>
                </select>

                {['cohere', 'voyage', 'jina', 'siliconflow'].includes(draft?.reranker?.provider) && (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                        {draft?.reranker?.provider === 'cohere' ? 'Cohere' :
                         draft?.reranker?.provider === 'voyage' ? 'Voyage AI' :
                         draft?.reranker?.provider === 'jina' ? 'Jina AI' : 'SiliconFlow'} API Key
                      </label>
                      <input
                        type="password"
                        value={draft?.reranker?.apiKey ?? ''}
                        onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, apiKey: e.target.value } }))}
                        placeholder={`Enter ${draft?.reranker?.provider} API key`}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Model</label>
                      <select
                        value={draft?.reranker?.model ?? ''}
                        onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, model: e.target.value } }))}
                        style={{ width: '100%' }}
                      >
                        {draft?.reranker?.provider === 'cohere' && (
                          <>
                            <option value="rerank-v3.5">rerank-v3.5</option>
                            <option value="rerank-v3.0">rerank-v3.0</option>
                          </>
                        )}
                        {draft?.reranker?.provider === 'voyage' && (
                          <>
                            <option value="rerank-2.5">rerank-2.5</option>
                            <option value="rerank-2.5-lite">rerank-2.5-lite (faster)</option>
                            <option value="rerank-2">rerank-2</option>
                          </>
                        )}
                        {draft?.reranker?.provider === 'jina' && (
                          <>
                            <option value="jina-reranker-v2-base-multilingual">jina-reranker-v2-base-multilingual</option>
                            <option value="jina-reranker-v1-base-en">jina-reranker-v1-base-en</option>
                          </>
                        )}
                        {draft?.reranker?.provider === 'siliconflow' && (
                          <>
                            <option value="BAAI/bge-reranker-v2-m3">BAAI/bge-reranker-v2-m3</option>
                            <option value="BAAI/bge-reranker-large">BAAI/bge-reranker-large</option>
                          </>
                        )}
                      </select>
                    </div>
                  </>
                )}

                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Top N results</label>
                <input
                  type="number"
                  value={draft?.reranker?.topN ?? 10}
                  onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, topN: Number(e.target.value) } }))}
                  min={3} max={20} style={{ width: 80 }}
                />

                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
                    Score Fusion — Reranker : Original = {((draft?.reranker?.weight ?? 0.5) * 100).toFixed(0)}% : {((1 - (draft?.reranker?.weight ?? 0.5)) * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    value={draft?.reranker?.weight ?? 0.5}
                    onChange={e => setDraft((d: any) => ({ ...d, reranker: { ...d.reranker, weight: Number(e.target.value) } }))}
                    min={0} max={1} step={0.05} style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>← 信任原始分数</span>
                    <span>信任 Reranker →</span>
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
            {displayRow('Reranker', config.search?.reranker?.enabled ? `${config.search.reranker.provider} (top ${config.search.reranker.topN}, weight ${((config.search.reranker.weight ?? 0.5) * 100).toFixed(0)}%)` : 'Off')}
          </tbody>
        </table>
      )}
    </div>
  );
}
