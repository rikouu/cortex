/**
 * Convert a UTC ISO timestamp string to local time display.
 * Falls back to raw string if parsing fails.
 */
export function toLocal(utc: string | undefined | null, style: 'full' | 'short' | 'date' = 'full'): string {
  if (!utc) return '—';
  try {
    const d = new Date(utc.endsWith('Z') ? utc : utc + 'Z');
    if (isNaN(d.getTime())) return utc;

    if (style === 'date') {
      return d.toLocaleDateString();
    }
    if (style === 'short') {
      // MM-DD HH:mm
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}-${dd} ${hh}:${mi}`;
    }
    // full: YYYY-MM-DD HH:mm:ss
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  } catch {
    return utc;
  }
}
