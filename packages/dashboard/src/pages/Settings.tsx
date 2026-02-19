import React, { useEffect, useState } from 'react';
import { getConfig, updateConfig, triggerExport } from '../api/client.js';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConfig().then(setConfig).catch(e => setError(e.message));
  }, []);

  const handleExport = async () => {
    try {
      await triggerExport();
      alert('Markdown export completed!');
    } catch (e: any) {
      alert(e.message);
    }
  };

  if (error) return <div className="card" style={{color: 'var(--danger)'}}>Error: {error}</div>;
  if (!config) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h1 className="page-title">Settings</h1>

      <div className="card" style={{marginBottom: 16}}>
        <h3 style={{marginBottom: 12}}>Server Configuration</h3>
        <table>
          <tbody>
            <tr><td>Port</td><td>{config.port}</td></tr>
            <tr><td>Host</td><td>{config.host}</td></tr>
            <tr><td>DB Path</td><td>{config.storage?.dbPath}</td></tr>
            <tr><td>WAL Mode</td><td>{config.storage?.walMode ? '✅' : '❌'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{marginBottom: 16}}>
        <h3 style={{marginBottom: 12}}>LLM & Embedding</h3>
        <table>
          <tbody>
            <tr><td>Extraction LLM</td><td>{config.llm?.extraction?.provider} / {config.llm?.extraction?.model}</td></tr>
            <tr><td>Lifecycle LLM</td><td>{config.llm?.lifecycle?.provider} / {config.llm?.lifecycle?.model}</td></tr>
            <tr><td>Embedding</td><td>{config.embedding?.provider} / {config.embedding?.model}</td></tr>
            <tr><td>Embedding Dimensions</td><td>{config.embedding?.dimensions}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{marginBottom: 16}}>
        <h3 style={{marginBottom: 12}}>Search</h3>
        <table>
          <tbody>
            <tr><td>Hybrid Search</td><td>{config.search?.hybrid ? '✅' : '❌'}</td></tr>
            <tr><td>Vector Weight</td><td>{config.search?.vectorWeight}</td></tr>
            <tr><td>Text Weight</td><td>{config.search?.textWeight}</td></tr>
            <tr><td>Recency Boost Window</td><td>{config.search?.recencyBoostWindow}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{marginBottom: 16}}>
        <h3 style={{marginBottom: 12}}>Lifecycle</h3>
        <table>
          <tbody>
            <tr><td>Schedule</td><td>{config.lifecycle?.schedule}</td></tr>
            <tr><td>Promotion Threshold</td><td>{config.lifecycle?.promotionThreshold}</td></tr>
            <tr><td>Archive Threshold</td><td>{config.lifecycle?.archiveThreshold}</td></tr>
            <tr><td>Decay Lambda</td><td>{config.lifecycle?.decayLambda}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{marginBottom: 16}}>
        <h3 style={{marginBottom: 12}}>Layers</h3>
        <table>
          <tbody>
            <tr><td>Working TTL</td><td>{config.layers?.working?.ttl}</td></tr>
            <tr><td>Core Max Entries</td><td>{config.layers?.core?.maxEntries}</td></tr>
            <tr><td>Archive TTL</td><td>{config.layers?.archive?.ttl}</td></tr>
            <tr><td>Archive Compress Back</td><td>{config.layers?.archive?.compressBackToCore ? '✅' : '❌'}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{marginBottom: 12}}>Actions</h3>
        <div style={{display: 'flex', gap: 8}}>
          <button className="btn primary" onClick={handleExport}>📤 Export Markdown</button>
        </div>
      </div>

      <div className="card" style={{marginTop: 16}}>
        <h3 style={{marginBottom: 12}}>Full Config (JSON)</h3>
        <pre className="json-debug">{JSON.stringify(config, null, 2)}</pre>
      </div>
    </div>
  );
}
