import type { Config } from '../config';
import type { DB } from '../db/client';
import type { EmailService } from '../services/email';
import type { StorageService } from '../services/storage';

/**
 * Runtime dependencies, initialised once at startup (or per test file).
 * Kept deliberately small: database handle, configuration and external-service adapters.
 */
export interface Deps {
  db: DB;
  config: Config;
  email: EmailService;
  storage: StorageService;
}

let current: Deps | null = null;

export function setDeps(d: Deps): void {
  current = d;
}

export function deps(): Deps {
  if (!current) throw new Error('Dependencies not initialised');
  return current;
}

export const db = (): DB => deps().db;
