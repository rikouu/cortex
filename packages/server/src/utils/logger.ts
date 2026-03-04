import pino from 'pino';
import { Transform } from 'node:stream';

// Ring buffer for in-memory log viewing
const LOG_BUFFER_SIZE = 500;
const logBuffer: { level: string; time: number; module?: string; msg: string }[] = [];

// Tee stream: captures JSON lines into ring buffer, passes through to stdout
const tee = new Transform({
  transform(chunk, _enc, cb) {
    try {
      const line = chunk.toString().trim();
      if (line.startsWith('{')) {
        const parsed = JSON.parse(line);
        logBuffer.push({
          level: pino.levels.labels[parsed.level] || 'info',
          time: parsed.time || Date.now(),
          module: parsed.module,
          msg: parsed.msg || '',
        });
        if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
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

export function getLogBuffer(limit = 100, level?: string): typeof logBuffer {
  let logs = logBuffer.slice(-Math.min(limit, LOG_BUFFER_SIZE));
  if (level) {
    logs = logs.filter(l => l.level === level);
  }
  return logs.reverse(); // newest first
}
