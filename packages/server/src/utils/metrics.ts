/**
 * Simple in-memory metrics collector.
 * Exposes counters and histograms via /api/v1/metrics (Prometheus text format).
 */
import { createLogger } from './logger.js';

const log = createLogger('metrics');

interface HistogramData {
  values: number[];
  sum: number;
  count: number;
}

class Metrics {
  private counters = new Map<string, Map<string, number>>(); // name -> labels_key -> count
  private histograms = new Map<string, HistogramData>();

  /** Increment a counter */
  inc(name: string, labels?: Record<string, string>, amount = 1): void {
    const key = labels ? Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(',') : '';
    if (!this.counters.has(name)) this.counters.set(name, new Map());
    const counter = this.counters.get(name)!;
    counter.set(key, (counter.get(key) || 0) + amount);
  }

  /** Record a histogram observation */
  observe(name: string, value: number): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { values: [], sum: 0, count: 0 });
    }
    const h = this.histograms.get(name)!;
    h.values.push(value);
    h.sum += value;
    h.count++;
    // Keep only last 1000 values to bound memory
    if (h.values.length > 1000) h.values = h.values.slice(-1000);
  }

  /** Get current value of a counter */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = labels ? Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(',') : '';
    return this.counters.get(name)?.get(key) || 0;
  }

  /** Get histogram stats */
  getHistogram(name: string): { p50: number; p95: number; p99: number; avg: number; count: number } | null {
    const h = this.histograms.get(name);
    if (!h || h.count === 0) return null;
    const sorted = [...h.values].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      avg: h.sum / h.count,
      count: h.count,
    };
  }

  /** Export as Prometheus text format */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const [name, labelMap] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, value] of labelMap) {
        const suffix = labels ? `{${labels}}` : '';
        lines.push(`${name}${suffix} ${value}`);
      }
    }

    for (const [name, data] of this.histograms) {
      lines.push(`# TYPE ${name} summary`);
      if (data.count > 0) {
        const sorted = [...data.values].sort((a, b) => a - b);
        lines.push(`${name}{quantile="0.5"} ${sorted[Math.floor(sorted.length * 0.5)] || 0}`);
        lines.push(`${name}{quantile="0.95"} ${sorted[Math.floor(sorted.length * 0.95)] || 0}`);
        lines.push(`${name}{quantile="0.99"} ${sorted[Math.floor(sorted.length * 0.99)] || 0}`);
        lines.push(`${name}_sum ${data.sum}`);
        lines.push(`${name}_count ${data.count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /** Export as JSON (for Dashboard) */
  toJSON(): Record<string, any> {
    const result: Record<string, any> = { counters: {}, histograms: {} };

    for (const [name, labelMap] of this.counters) {
      result.counters[name] = Object.fromEntries(labelMap);
    }

    for (const [name, data] of this.histograms) {
      if (data.count > 0) {
        const sorted = [...data.values].sort((a, b) => a - b);
        result.histograms[name] = {
          p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
          p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
          avg: +(data.sum / data.count).toFixed(2),
          count: data.count,
        };
      }
    }

    return result;
  }
}

export const metrics = new Metrics();
