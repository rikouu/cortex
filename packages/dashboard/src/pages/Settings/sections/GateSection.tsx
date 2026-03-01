import React from 'react';
import { SectionKey } from '../types.js';

interface GateSectionProps {
  config: any;
  editing: boolean;
  draft: any;
  setDraft: React.Dispatch<React.SetStateAction<any>>;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderNumberField: (label: string, desc: string, path: string, min?: number, max?: number) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  t: (key: string, params?: any) => string;
}

export default function GateSection({
  config, editing, draft, setDraft, sectionHeader, displayRow, renderNumberField, renderToggleField, t,
}: GateSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.gateTitle'), 'gate')}
      {editing ? (
        <div style={{ padding: '4px 0' }}>
          {renderNumberField('💉 Injection Budget (tokens)', 'Max tokens injected into AI context. Determines how many memories the AI can see. Recommended: 3000-5000. Too low = AI forgets, too high = wastes context window.', 'maxInjectionTokens', 500, 50000)}
          {renderNumberField('🔍 Search Candidates', 'How many memories to retrieve per search query before reranking. Should be > Reranker Top N to give reranker room to filter. Recommended: 20-30.', 'searchLimit', 5, 50)}
          {renderToggleField(t('settings.skipSmallTalk'), t('settings.skipSmallTalkDesc'), 'skipSmallTalk')}

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>🔄 Query Expansion</label>
            {renderToggleField('Query Expansion', 'LLM generates 2-3 variant queries (synonyms, rephrasings) to expand the candidate pool. Adds ~2s latency but significantly improves recall for vague queries. Uses 1 LLM call.', 'queryExpansion.enabled')}
            {draft?.queryExpansion?.enabled && (
              <div style={{ marginLeft: 16 }}>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Max Variants</label>
                <input
                  type="number"
                  value={draft?.queryExpansion?.maxVariants ?? 3}
                  onChange={e => setDraft((d: any) => ({ ...d, queryExpansion: { ...d.queryExpansion, maxVariants: Number(e.target.value) } }))}
                  min={2} max={5} style={{ width: 80 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>Including original query</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow('💉 Injection Budget', `${config.gate?.maxInjectionTokens} tokens`, 'Max tokens injected into AI context')}
            {displayRow('🔍 Search Candidates', config.gate?.searchLimit ?? 30, 'Memories retrieved per query')}
            {displayRow(t('settings.skipSmallTalk'), config.gate?.skipSmallTalk ? t('common.on') : t('common.off'), t('settings.skipSmallTalkDesc'))}
            {displayRow('Query Expansion', config.gate?.queryExpansion?.enabled ? `On (${config.gate.queryExpansion.maxVariants} variants)` : 'Off')}
          </tbody>
        </table>
      )}
    </div>
  );
}
