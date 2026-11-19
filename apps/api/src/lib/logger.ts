import pino from 'pino';

const level = process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info');
const pretty = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

/**
 * Structured logger. Sensitive values are redacted at the logger level as a safety net;
 * request bodies (which may contain financial data or passwords) are never logged at all.
 */
export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.token',
      '*.tokenHash',
      '*.passwordHash',
      '*.email',
    ],
    censor: '[redacted]',
  },
  ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
});
