import React from 'react';
import { SectionKey } from '../types.js';

interface SelfImprovementSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  renderSlider: (label: string, desc: string, path: string, min: number, max: number, step: number) => React.ReactNode;
  renderNumberField: (label: string, desc: string, path: string, min?: number, max?: number) => React.ReactNode;
  t: (key: string, params?: any) => string;
}

export default function SelfImprovementSection({
  config, editing, sectionHeader, displayRow,
  renderToggleField, renderSlider, renderNumberField, t,
}: SelfImprovementSectionProps) {
  const si = config.selfImprovement ?? {};

  return (
    <div className="card">
      {sectionHeader(t('settings.selfImprovementTitle'), 'selfImprovement')}
      {editing ? (
        <div style={{ padding: '4px 0' }}>
          {renderToggleField(t('settings.selfImprovementEnabled'), t('settings.selfImprovementEnabledDesc'), 'enabled')}
          {renderNumberField(t('settings.selfImprovementWindowSize'), t('settings.selfImprovementWindowSizeDesc'), 'windowSize', 1, 90)}
          {renderNumberField(t('settings.selfImprovementMinFeedbacks'), t('settings.selfImprovementMinFeedbacksDesc'), 'minFeedbacks', 1, 50)}
          {renderSlider(t('settings.selfImprovementMaxDelta'), t('settings.selfImprovementMaxDeltaDesc'), 'maxDelta', 0.01, 0.5, 0.01)}
          {renderSlider(t('settings.selfImprovementImplicitWeight'), t('settings.selfImprovementImplicitWeightDesc'), 'implicitWeight', 0, 1, 0.05)}
          {renderSlider(t('settings.selfImprovementExplicitWeight'), t('settings.selfImprovementExplicitWeightDesc'), 'explicitWeight', 0, 1, 0.05)}
          {renderSlider(t('settings.selfImprovementMinDelta'), t('settings.selfImprovementMinDeltaDesc'), 'minDelta', 0.001, 0.1, 0.001)}
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow(t('settings.selfImprovementEnabled'), (si.enabled ?? true) ? t('common.on') : t('common.off'), t('settings.selfImprovementEnabledDesc'))}
            {displayRow(t('settings.selfImprovementWindowSize'), `${si.windowSize ?? 30} ${t('settings.unitDays')}`, t('settings.selfImprovementWindowSizeDesc'))}
            {displayRow(t('settings.selfImprovementMinFeedbacks'), si.minFeedbacks ?? 3, t('settings.selfImprovementMinFeedbacksDesc'))}
            {displayRow(t('settings.selfImprovementMaxDelta'), (si.maxDelta ?? 0.15).toFixed(2), t('settings.selfImprovementMaxDeltaDesc'))}
            {displayRow(t('settings.selfImprovementImplicitWeight'), (si.implicitWeight ?? 0.3).toFixed(2), t('settings.selfImprovementImplicitWeightDesc'))}
            {displayRow(t('settings.selfImprovementExplicitWeight'), (si.explicitWeight ?? 1.0).toFixed(2), t('settings.selfImprovementExplicitWeightDesc'))}
            {displayRow(t('settings.selfImprovementMinDelta'), (si.minDelta ?? 0.01).toFixed(3), t('settings.selfImprovementMinDeltaDesc'))}
          </tbody>
        </table>
      )}
    </div>
  );
}
