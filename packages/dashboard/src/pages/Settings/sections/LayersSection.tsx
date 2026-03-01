import React from 'react';
import { SectionKey } from '../types.js';

interface LayersSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  displayRow: (label: string, value: any, desc?: string) => React.ReactNode;
  renderDuration: (label: string, desc: string, path: string) => React.ReactNode;
  renderNumberField: (label: string, desc: string, path: string, min?: number, max?: number) => React.ReactNode;
  renderToggleField: (label: string, desc: string, path: string) => React.ReactNode;
  humanizeDuration: (s: string) => string;
  t: (key: string, params?: any) => string;
}

export default function LayersSection({
  config, editing, sectionHeader, displayRow, renderDuration, renderNumberField, renderToggleField, humanizeDuration, t,
}: LayersSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.layersTitle'), 'layers')}
      {editing ? (
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
  );
}
