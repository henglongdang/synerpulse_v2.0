import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { deps } from './deps';

const passthrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMs: number, limit: number, message: string, keyByEmail = false): RequestHandler {
  let instance: RequestHandler | null = null;
  return (req, res, next) => {
    if (!deps().config.rateLimitEnabled) return passthrough(req, res, next);
    instance ??= rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Key on IP, plus the target email for credential endpoints, so one attacker cannot lock
      // out every user and one user cannot be brute-forced from many requests.
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
    return instance(req, res, next);
  };
}

export const loginLimiter = limiter(15 * 60_000, 10, 'Too many sign-in attempts. Please wait 15 minutes and try again.', true);
export const registerLimiter = limiter(60 * 60_000, 10, 'Too many accounts created from this network. Try again later.');
export const passwordResetLimiter = limiter(60 * 60_000, 5, 'Too many reset requests. Please try again later.', true);
export const apiLimiter = limiter(60_000, 300, 'You are making requests too quickly. Please slow down.');
export const uploadLimiter = limiter(60 * 60_000, 60, 'Upload limit reached. Please try again later.');
