import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { deps } from './deps';

/**
 * Limiters are created once at module load (express-rate-limit requires this) and consult the
 * runtime configuration on every request via `skip`, so tests can disable them.
 */
function limiter(windowMs: number, limit: number, message: string, keyByEmail = false): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !deps().config.rateLimitEnabled,
    // Key on IP, plus the target email for credential endpoints, so one attacker cannot lock
    // out every user and one account cannot be brute-forced from many requests.
    keyGenerator: (r) => {
      const ip = r.ip ?? 'unknown';
      const email = keyByEmail && typeof r.body?.email === 'string' ? r.body.email.toLowerCase().slice(0, 254) : '';
      return `${ip}|${email}`;
    },
    validate: { keyGeneratorIpFallback: false },
    handler: (_r, response) => {
      response.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });
}

export const loginLimiter = limiter(15 * 60_000, 10, 'Too many sign-in attempts. Please wait 15 minutes and try again.', true);
export const registerLimiter = limiter(60 * 60_000, 10, 'Too many accounts created from this network. Try again later.');
export const passwordResetLimiter = limiter(60 * 60_000, 5, 'Too many reset requests. Please try again later.', true);
export const apiLimiter = limiter(60_000, 300, 'You are making requests too quickly. Please slow down.');
export const uploadLimiter = limiter(60 * 60_000, 60, 'Upload limit reached. Please try again later.');
