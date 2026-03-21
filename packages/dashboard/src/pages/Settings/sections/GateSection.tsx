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
          {renderNumberField(`📌 ${t('settings.fixedBudget')}`, t('settings.fixedBudgetDesc'), 'fixedInjectionTokens', 50)}
          {renderNumberField(`💉 ${t('settings.memoryBudget')}`, t('settings.memoryBudgetDesc'), 'maxInjectionTokens', 100)}
          {renderNumberField(`🔗 ${t('settings.relationBudget')}`, t('settings.relationBudgetDesc'), 'relationBudget', 0)}
          {renderNumberField(`🔍 ${t('settings.searchCandidates')}`, t('settings.searchCandidatesDesc'), 'searchLimit', 5, 50)}
          {renderToggleField(t('settings.skipSmallTalk'), t('settings.skipSmallTalkDesc'), 'skipSmallTalk')}

          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 16, paddingTop: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>✂️ {t('settings.cliffFilter')}</label>
            {renderNumberField(t('settings.cliffAbsolute'), t('settings.cliffAbsoluteDesc'), 'cliffAbsolute', 0.1, 0.9)}
            {renderNumberField(t('settings.cliffGap'), t('settings.cliffGapDesc'), 'cliffGap', 0.1, 0.9)}
            {renderNumberField(t('settings.cliffFloor'), t('settings.cliffFloorDesc'), 'cliffFloor', 0, 0.5)}
          </div>

          {renderNumberField(`⏱️ ${t('settings.recallTimeout')}`, t('settings.recallTimeoutDesc'), 'recallTimeoutMs', 1000, 30000)}

          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 16, paddingTop: 12 }}>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>🔄 {t('settings.queryExpansion')}</label>
            {renderToggleField(t('settings.queryExpansion'), t('settings.queryExpansionDesc'), 'queryExpansion.enabled')}
            {draft?.queryExpansion?.enabled && (
              <div style={{ marginLeft: 16 }}>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>{t('settings.queryExpansionVariants')}</label>
                <input
                  type="number"
                  value={draft?.queryExpansion?.maxVariants ?? 3}
                  onChange={e => setDraft((d: any) => ({ ...d, queryExpansion: { ...d.queryExpansion, maxVariants: Number(e.target.value) } }))}
                  min={2} max={5} style={{ width: 80 }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow(`📌 ${t('settings.fixedBudget')}`, `${config.gate?.fixedInjectionTokens ?? 500} tokens`, t('settings.fixedBudgetDesc'))}
            {displayRow(`💉 ${t('settings.memoryBudget')}`, `${config.gate?.maxInjectionTokens ?? 1000} tokens`, t('settings.memoryBudgetDesc'))}
            {displayRow(`🔗 ${t('settings.relationBudget')}`, `${config.gate?.relationBudget ?? 100} tokens`, t('settings.relationBudgetDesc'))}
            {displayRow(`🔍 ${t('settings.searchCandidates')}`, config.gate?.searchLimit ?? 30, t('settings.searchCandidatesDesc'))}
            {displayRow(t('settings.skipSmallTalk'), config.gate?.skipSmallTalk ? t('common.on') : t('common.off'), t('settings.skipSmallTalkDesc'))}
            {displayRow(`✂️ ${t('settings.cliffFilter')}`, `${t('settings.cliffAbsolute')}: ${config.gate?.cliffAbsolute ?? 0.4} · ${t('settings.cliffGap')}: ${config.gate?.cliffGap ?? 0.6} · ${t('settings.cliffFloor')}: ${config.gate?.cliffFloor ?? 0.05}`)}
            {displayRow(`⏱️ ${t('settings.recallTimeout')}`, `${config.gate?.recallTimeoutMs ?? 5000} ms`, t('settings.recallTimeoutDesc'))}
            {displayRow(`🔄 ${t('settings.queryExpansion')}`, config.gate?.queryExpansion?.enabled ? `${t('common.on')} (${config.gate.queryExpansion.maxVariants} variants)` : t('common.off'), t('settings.queryExpansionDesc'))}
          </tbody>
        </table>
      )}
    </div>
  );
}
