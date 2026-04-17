import pino from 'pino';
import { Transform } from 'node:stream';

// Ring buffer for in-memory log viewing (O(1) insert)
const LOG_BUFFER_SIZE = 500;
type LogEntry = { level: string; time: number; module?: string; msg: string };
const _ringBuf: LogEntry[] = new Array(LOG_BUFFER_SIZE);
let _ringHead = 0;
let _ringCount = 0;

function ringPush(entry: LogEntry): void {
  _ringBuf[_ringHead] = entry;
  _ringHead = (_ringHead + 1) % LOG_BUFFER_SIZE;
  if (_ringCount < LOG_BUFFER_SIZE) _ringCount++;
}

// Tee stream: captures JSON lines into ring buffer, passes through to stdout
const tee = new Transform({
  transform(chunk, _enc, cb) {
    try {
      const line = chunk.toString().trim();
      if (line.startsWith('{')) {
        const parsed = JSON.parse(line);
        ringPush({
          level: pino.levels.labels[parsed.level] || 'info',
          time: parsed.time || Date.now(),
          module: parsed.module,
          msg: parsed.msg || '',
        });
      }
    } catch {}
    cb(null, chunk);
  },
});
tee.pipe(process.stdout);

// Use pino-pretty in dev, raw JSON otherwise
const usePretty = process.env.NODE_ENV !== 'production';

export const logger = usePretty
  ? pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: { target: 'pino-pretty', options: { colorize: true } },
    })
  : pino({ level: process.env.LOG_LEVEL || 'info' }, tee);

// For pino-pretty (dev), we can't intercept the stream easily,
// so also hook via a custom onChild approach — but simpler: just
// always use the tee approach and skip pino-pretty in container.
// Since this runs in Docker (production), tee works.
// In dev, buffer won't fill — acceptable tradeoff.

export function createLogger(name: string) {
  return logger.child({ module: name });
}

export function setLogLevel(level: string) {
  logger.level = level;
}

export function getLogLevel(): string {
  return logger.level;
}

export function getLogBuffer(limit = 100, level?: string): LogEntry[] {
  // Read from ring buffer in insertion order (oldest first)
  const result: LogEntry[] = [];
  const start = _ringCount < LOG_BUFFER_SIZE ? 0 : _ringHead;
  for (let i = 0; i < _ringCount; i++) {
    const entry = _ringBuf[(start + i) % LOG_BUFFER_SIZE]!;
    if (!level || entry.level === level) result.push(entry);
  }
  // Return newest first, capped at limit
  return result.reverse().slice(0, Math.min(limit, LOG_BUFFER_SIZE));
}
