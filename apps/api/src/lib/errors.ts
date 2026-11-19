import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodType, type output } from 'zod';
import { logger } from './logger';

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: Record<string, string[]>) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in to continue') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError(403, 'forbidden', message);
/** Used for both "missing" and "not yours" so that resource existence never leaks across households. */
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new AppError(409, 'conflict', message, undefined, extra);

export function zodDetails(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Validate untrusted input against a schema; throws a 400 with per-field messages. */
export function parse<S extends ZodType>(schema: S, data: unknown): output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = zodDetails(r.error);
    const first = Object.values(details)[0]?.[0] ?? 'Invalid request';
    throw badRequest(first, details);
  }
  return r.data;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Endpoint'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), ...(err.extra ?? {}) },
    });
    return;
  }
  // body-parser / multer errors
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  const type = (err as { type?: string }).type;
  if (type === 'entity.too.large' || (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'The request is too large' } });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body' } });
    return;
  }
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: 'Invalid request' } });
    return;
  }
  // Never leak internals (stack traces, SQL) to the client.
  logger.error({ err: { message: (err as Error)?.message, stack: (err as Error)?.stack }, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
};
