import React from 'react';
import { SectionKey } from '../types.js';

interface SieveSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  renderNumberField: (label: string, desc: string, path: string, min?: number, max?: number) => React.ReactNode;
  renderSlider: (label: string, desc: string, path: string, min: number, max: number, step: number) => React.ReactNode;
  t: (key: string, params?: any) => string;
}

export default function SieveSection({
  config, editing, sectionHeader, displayRow, renderToggleField, renderNumberField, renderSlider, t,
}: SieveSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.contextMessages').replace(/ ?\(.*$/, '').split(' ').slice(0, 2).join(' ') || 'Sieve', 'sieve')}
      {editing ? (
        <div style={{ padding: '4px 0' }}>
          {renderToggleField(t('settings.fastChannelEnabled'), t('settings.fastChannelEnabledDesc'), 'fastChannelEnabled')}
          {renderNumberField(t('settings.contextMessages'), t('settings.contextMessagesDesc'), 'contextMessages', 2, 20)}
          {renderNumberField(t('settings.maxConversationChars'), t('settings.maxConversationCharsDesc'), 'maxConversationChars', 2000, 16000)}
          {renderToggleField(t('settings.smartUpdate'), t('settings.smartUpdateDesc'), 'smartUpdate')}
          {renderSlider(t('settings.similarityThreshold'), t('settings.similarityThresholdDesc'), 'similarityThreshold', 0.1, 0.8, 0.01)}
          {renderSlider(t('settings.exactDupThreshold'), t('settings.exactDupThresholdDesc'), 'exactDupThreshold', 0.01, 0.2, 0.01)}
          {renderToggleField(t('settings.relationExtraction'), t('settings.relationExtractionDesc'), 'relationExtraction')}
        </div>
      ) : (
        <table>
          <tbody>
            {displayRow(t('settings.fastChannelEnabled'), (config.sieve?.fastChannelEnabled ?? true) ? t('common.on') : t('common.off'), t('settings.fastChannelEnabledDesc'))}
            {displayRow(t('settings.contextMessages'), config.sieve?.contextMessages ?? 4, t('settings.contextMessagesDesc'))}
            {displayRow(t('settings.maxConversationChars'), config.sieve?.maxConversationChars ?? 4000, t('settings.maxConversationCharsDesc'))}
            {displayRow(t('settings.smartUpdate'), (config.sieve?.smartUpdate ?? true) ? t('common.on') : t('common.off'), t('settings.smartUpdateDesc'))}
            {displayRow(t('settings.similarityThreshold'), (config.sieve?.similarityThreshold ?? 0.35).toFixed(2), t('settings.similarityThresholdDesc'))}
            {displayRow(t('settings.exactDupThreshold'), (config.sieve?.exactDupThreshold ?? 0.08).toFixed(2), t('settings.exactDupThresholdDesc'))}
            {displayRow(t('settings.relationExtraction'), (config.sieve?.relationExtraction ?? true) ? t('common.on') : t('common.off'), t('settings.relationExtractionDesc'))}
          </tbody>
        </table>
      )}
    </div>
  );
}
