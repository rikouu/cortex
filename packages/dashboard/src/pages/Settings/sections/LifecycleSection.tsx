import React from 'react';
import { SectionKey } from '../types.js';

interface LifecycleSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderSchedule: () => React.ReactNode;
  renderSlider: (label: string, desc: string, path: string, min: number, max: number, step: number) => React.ReactNode;
  humanizeCron: (s: string) => string;
  t: (key: string, params?: any) => string;
}

export default function LifecycleSection({
  config, editing, sectionHeader, displayRow, renderSchedule, renderSlider, humanizeCron, t,
}: LifecycleSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.lifecycleTitle'), 'lifecycle')}
      {editing ? (
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
  );
}
