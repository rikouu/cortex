import React from 'react';
import { SectionKey, LLM_PROVIDERS, EMBEDDING_PROVIDERS, ProviderPreset } from '../types.js';

interface LlmSectionProps {
  config: any;
  editing: boolean;
  sectionHeader: (title: string, section: SectionKey) => React.ReactNode;
  renderProviderBlock: (title: string, prefix: string, providerMap: Record<string, ProviderPreset>) => React.ReactNode;
  testState: Record<string, { status: 'idle' | 'testing' | 'success' | 'error'; message?: string; latency?: number }>;
  handleTestLLM: (target: 'extraction' | 'lifecycle') => void;
  handleTestEmbedding: () => void;
  t: (key: string, params?: any) => string;
}

export default function LlmSection({
  config, editing, sectionHeader, renderProviderBlock, testState, handleTestLLM, handleTestEmbedding, t,
}: LlmSectionProps) {
  return (
    <div className="card">
      {sectionHeader(t('settings.llmEmbedding'), 'llm')}
      {editing ? (
        <>
          {renderProviderBlock(t('settings.extractionLlm'), 'extraction', LLM_PROVIDERS)}
          {renderProviderBlock(t('settings.lifecycleLlm'), 'lifecycle', LLM_PROVIDERS)}
          {renderProviderBlock(t('settings.embedding'), 'embedding', EMBEDDING_PROVIDERS)}
        </>
      ) : (
        <table>
          <tbody>
            <tr>
              <td>{t('settings.extractionLlm')}</td>
              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{config.llm?.extraction?.provider} / {config.llm?.extraction?.model}</span>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  disabled={testState['llm.extraction']?.status === 'testing'}
                  onClick={() => handleTestLLM('extraction')}
                >
                  {testState['llm.extraction']?.status === 'testing' ? t('settings.testing') : t('settings.testConnection')}
                </button>
                {testState['llm.extraction']?.status === 'success' && (
                  <span style={{ fontSize: 11, color: 'var(--success)' }}>{t('settings.testSuccess', { latency: testState['llm.extraction'].latency ?? 0 })}</span>
                )}
                {testState['llm.extraction']?.status === 'error' && (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>{t('settings.testFailed', { message: testState['llm.extraction'].message ?? '' })}</span>
                )}
              </td>
            </tr>
            <tr>
              <td>{t('settings.lifecycleLlm')}</td>
              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{config.llm?.lifecycle?.provider} / {config.llm?.lifecycle?.model}</span>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  disabled={testState['llm.lifecycle']?.status === 'testing'}
                  onClick={() => handleTestLLM('lifecycle')}
                >
                  {testState['llm.lifecycle']?.status === 'testing' ? t('settings.testing') : t('settings.testConnection')}
                </button>
                {testState['llm.lifecycle']?.status === 'success' && (
                  <span style={{ fontSize: 11, color: 'var(--success)' }}>{t('settings.testSuccess', { latency: testState['llm.lifecycle'].latency ?? 0 })}</span>
                )}
                {testState['llm.lifecycle']?.status === 'error' && (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>{t('settings.testFailed', { message: testState['llm.lifecycle'].message ?? '' })}</span>
                )}
              </td>
            </tr>
            <tr>
              <td>{t('settings.embedding')}</td>
              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{config.embedding?.provider} / {config.embedding?.model}</span>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  disabled={testState['embedding']?.status === 'testing'}
                  onClick={() => handleTestEmbedding()}
                >
                  {testState['embedding']?.status === 'testing' ? t('settings.testing') : t('settings.testConnection')}
                </button>
                {testState['embedding']?.status === 'success' && (
                  <span style={{ fontSize: 11, color: 'var(--success)' }}>{t('settings.testSuccess', { latency: testState['embedding'].latency ?? 0 })}</span>
                )}
                {testState['embedding']?.status === 'error' && (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>{t('settings.testFailed', { message: testState['embedding'].message ?? '' })}</span>
                )}
              </td>
            </tr>
            <tr><td>{t('settings.embeddingDimensions')}</td><td>{config.embedding?.dimensions}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
